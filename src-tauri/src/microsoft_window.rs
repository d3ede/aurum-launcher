use auren_core::Engine;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct PendingSignIn {
    operation_id: String,
    label: String,
    finished: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct MicrosoftWindow(Mutex<Option<PendingSignIn>>);

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

pub fn open(
    app: &AppHandle,
    engine: &Engine,
    operation_id: &str,
    authorize: &str,
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
    let parent = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow::anyhow!("Окно Aurum закрыто"))?;
    let label = format!("microsoft-signin-{operation_id}");
    let finished = Arc::new(AtomicBool::new(false));
    // A separate WebView profile keeps Microsoft cookies apart from the launcher UI.
    let folder = engine.root.join("cache").join("microsoft-webview");
    std::fs::create_dir_all(&folder)?;
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(authorize))
        .title("Microsoft — Вход в Aurum")
        .inner_size(520.0, 680.0)
        .min_inner_size(460.0, 580.0)
        .parent(&parent)?
        .center()
        .theme(parent.theme().ok())
        .devtools(false)
        .data_directory(folder)
        .on_navigation(move |url| allowed_navigation(url, &redirect))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .build()
        .map_err(|_| {
            anyhow::anyhow!(
                "Не удалось открыть окно Microsoft. Проверьте установку WebView2 и повторите вход"
            )
        })?;
    let cancellation = engine.clone();
    let id = operation_id.to_owned();
    let finish_flag = finished.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) && !finish_flag.load(Ordering::Relaxed)
        {
            let engine = cancellation.clone();
            let id = id.clone();
            tauri::async_runtime::spawn(async move {
                let _ = engine.cancel(&id).await;
            });
        }
    });
    *app.state::<MicrosoftWindow>()
        .0
        .lock()
        .map_err(|_| anyhow::anyhow!("Не удалось подготовить окно Microsoft"))? =
        Some(PendingSignIn {
            operation_id: operation_id.into(),
            label,
            finished,
        });
    window.set_focus()?;
    Ok(())
}

pub fn focus(app: &AppHandle, operation_id: &str) -> Result<(), String> {
    let label = app
        .state::<MicrosoftWindow>()
        .0
        .lock()
        .map_err(|_| "Не удалось показать окно Microsoft")?
        .as_ref()
        .filter(|pending| pending.operation_id == operation_id)
        .map(|pending| pending.label.clone())
        .ok_or("Этот вход уже завершён. Начните новый вход")?;
    let window = app
        .get_webview_window(&label)
        .ok_or("Окно Microsoft закрыто. Повторите вход")?;
    window
        .unminimize()
        .map_err(|_| "Не удалось показать окно Microsoft")?;
    window
        .set_focus()
        .map_err(|_| "Не удалось показать окно Microsoft".into())
}

/// Called only after a validated OAuth response, or when the operation has finished.
pub fn finish(app: &AppHandle, operation_id: &str) {
    let pending = {
        let state = app.state::<MicrosoftWindow>();
        let Ok(mut current) = state.0.lock() else {
            return;
        };
        if current
            .as_ref()
            .is_some_and(|p| p.operation_id == operation_id)
        {
            current.take()
        } else {
            None
        }
    };
    if let Some(pending) = pending {
        pending.finished.store(true, Ordering::Relaxed);
        if let Some(window) = app.get_webview_window(&pending.label) {
            let _ = window.close();
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
}
