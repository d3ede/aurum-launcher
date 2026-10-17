use auren_core::Engine;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const LABEL: &str = "microsoft-signin";

struct PendingSignIn {
    operation_id: String,
    redirect: Url,
}

#[derive(Default)]
pub struct MicrosoftWindow {
    pending: Mutex<Option<PendingSignIn>>,
    creation: Mutex<()>,
    shutting_down: AtomicBool,
}

fn allowed_navigation(url: &Url, redirect: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.scheme() == "http" {
        return url.host_str() == Some("localhost")
            && url.port_or_known_default() == redirect.port_or_known_default()
            && url.path() == "/";
    }
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "login.microsoftonline.com"
                    | "login.live.com"
                    | "account.live.com"
                    | "signup.live.com"
                    | "account.microsoft.com"
                    | "login.microsoft.com"
            )
        )
}

fn allowed_window_navigation(url: &Url, redirect: Option<&Url>) -> bool {
    match redirect {
        Some(redirect) => allowed_navigation(url, redirect),
        None => url.as_str() == "about:blank",
    }
}

fn prepare(app: &AppHandle, engine: &Engine) -> anyhow::Result<WebviewWindow> {
    let state = app.state::<MicrosoftWindow>();
    let _creation = state
        .creation
        .lock()
        .map_err(|_| anyhow::anyhow!("Не удалось подготовить окно Microsoft"))?;
    if state.shutting_down.load(Ordering::Relaxed) {
        anyhow::bail!("Окно Aurum закрыто")
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let parent = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow::anyhow!("Окно Aurum закрыто"))?;
    let folder = engine.root.join("cache").join("microsoft-webview");
    std::fs::create_dir_all(&folder)?;
    let navigation = app.clone();
    let window =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(Url::parse("about:blank")?))
            .title("Microsoft — Вход в Aurum")
            .inner_size(520.0, 680.0)
            .min_inner_size(460.0, 580.0)
            .parent(&parent)?
            .center()
            .theme(parent.theme().ok())
            .visible(false)
            .focused(false)
            .devtools(false)
            .data_directory(folder)
            .on_navigation(move |url| {
                let state = navigation.state::<MicrosoftWindow>();
                let Ok(pending) = state.pending.lock() else {
                    return false;
                };
                allowed_window_navigation(url, pending.as_ref().map(|pending| &pending.redirect))
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .build()
            .map_err(|_| {
                anyhow::anyhow!(
            "Не удалось открыть окно Microsoft. Проверьте установку WebView2 и повторите вход"
        )
            })?;
    let closing = app.clone();
    let cancellation = engine.clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
            WindowEvent::Destroyed => (),
            _ => return,
        }
        let id = closing
            .state::<MicrosoftWindow>()
            .pending
            .lock()
            .ok()
            .and_then(|pending| pending.as_ref().map(|pending| pending.operation_id.clone()));
        if let Some(id) = id {
            finish(&closing, &id);
            let engine = cancellation.clone();
            tauri::async_runtime::spawn(async move {
                let _ = engine.cancel(&id).await;
            });
        }
    });
    if state.shutting_down.load(Ordering::Relaxed) {
        let _ = window.destroy();
        anyhow::bail!("Окно Aurum закрыто")
    }
    Ok(window)
}

pub fn shutdown(app: &AppHandle) {
    app.state::<MicrosoftWindow>()
        .shutting_down
        .store(true, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

pub fn warm_up(app: &AppHandle, engine: &Engine) {
    let app = app.clone();
    let engine = engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = prepare(&app, &engine);
    });
}

pub fn open(
    app: &AppHandle,
    engine: &Engine,
    operation_id: &str,
    authorize: &str,
    cancelled: &AtomicBool,
) -> anyhow::Result<()> {
    let authorize = Url::parse(authorize)?;
    let redirect = authorize
        .query_pairs()
        .find(|(key, _)| key == "redirect_uri")
        .map(|(_, value)| Url::parse(&value))
        .transpose()?
        .ok_or_else(|| anyhow::anyhow!("Не удалось подготовить окно Microsoft"))?;
    if !allowed_navigation(&authorize, &redirect) {
        anyhow::bail!("Не удалось подготовить страницу Microsoft")
    }
    let window = prepare(app, engine)?;
    if cancelled.load(Ordering::Relaxed) {
        anyhow::bail!("Операция отменена")
    }
    *app.state::<MicrosoftWindow>()
        .pending
        .lock()
        .map_err(|_| anyhow::anyhow!("Не удалось подготовить окно Microsoft"))? =
        Some(PendingSignIn {
            operation_id: operation_id.into(),
            redirect,
        });
    if cancelled.load(Ordering::Relaxed) {
        finish(app, operation_id);
        anyhow::bail!("Операция отменена")
    }
    window.set_theme(
        app.get_webview_window("main")
            .and_then(|main| main.theme().ok()),
    )?;
    window.show()?;
    window.navigate(authorize)?;
    window.set_focus()?;
    Ok(())
}

pub fn focus(app: &AppHandle, operation_id: &str) -> Result<(), String> {
    let active = app
        .state::<MicrosoftWindow>()
        .pending
        .lock()
        .map_err(|_| "Не удалось показать окно Microsoft")?
        .as_ref()
        .is_some_and(|pending| pending.operation_id == operation_id);
    if !active {
        return Err("Этот вход уже завершён. Начните новый вход".into());
    }
    let window = app
        .get_webview_window(LABEL)
        .ok_or("Окно Microsoft закрыто. Повторите вход")?;
    window
        .unminimize()
        .map_err(|_| "Не удалось показать окно Microsoft")?;
    window
        .show()
        .map_err(|_| "Не удалось показать окно Microsoft")?;
    window
        .set_focus()
        .map_err(|_| "Не удалось показать окно Microsoft".into())
}

pub fn finish(app: &AppHandle, operation_id: &str) {
    let pending = {
        let state = app.state::<MicrosoftWindow>();
        let Ok(mut current) = state.pending.lock() else {
            return;
        };
        if current
            .as_ref()
            .is_some_and(|pending| pending.operation_id == operation_id)
        {
            current.take()
        } else {
            None
        }
    };
    if pending.is_some() {
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.hide();
            if let Ok(blank) = Url::parse("about:blank") {
                let _ = window.navigate(blank);
            }
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sign_in_window_only_navigates_to_microsoft_or_its_loopback_callback() {
        let callback = Url::parse("http://localhost:12345").unwrap();
        for uri in [
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
            "https://login.live.com/",
            "https://account.live.com/",
            "http://localhost:12345/?code=test&state=session",
        ] {
            assert!(
                allowed_navigation(&Url::parse(uri).unwrap(), &callback),
                "{uri}"
            );
        }
        for uri in [
            "https://login.live.com.evil.example/",
            "https://evil.example/",
            "https://login.live.com@evil.example/",
            "http://login.live.com/",
            "http://localhost:54321/",
            "http://localhost:12345/other",
            "http://127.0.0.1:12345/",
            "https://login.live.com:8443/",
            "file:///C:/Windows/win.ini",
            "tauri://localhost/",
            "javascript:alert(1)",
        ] {
            assert!(
                !allowed_navigation(&Url::parse(uri).unwrap(), &callback),
                "{uri}"
            );
        }
    }

    #[test]
    fn idle_window_cannot_browse_and_reused_sessions_only_accept_the_current_callback() {
        let blank = Url::parse("about:blank").unwrap();
        let microsoft = Url::parse("https://login.live.com/").unwrap();
        let previous = Url::parse("http://localhost:12345/").unwrap();
        let current = Url::parse("http://localhost:54321/").unwrap();
        assert!(allowed_window_navigation(&blank, None));
        assert!(!allowed_window_navigation(&microsoft, None));
        assert!(!allowed_window_navigation(&previous, None));
        assert!(!allowed_window_navigation(&blank, Some(&current)));
        assert!(!allowed_window_navigation(&previous, Some(&current)));
        assert!(allowed_window_navigation(&current, Some(&current)));
        assert!(allowed_window_navigation(&microsoft, Some(&current)));
    }
}
