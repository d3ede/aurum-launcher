//! Native OAuth authorization-code flow. Secrets stay in Rust, never in IPC events.
use crate::Task;
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::Url;
use sha2::{Digest, Sha256};
use std::{future::Future, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub const SCOPE: &str = "XboxLive.signin offline_access";
pub const TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

pub fn client_id() -> Result<&'static str> {
    let id = option_env!("AURUM_MICROSOFT_CLIENT_ID")
        .unwrap_or(include_str!("../../../config/microsoft-client-id.txt"))
        .trim();
    if uuid::Uuid::parse_str(id).is_err() {
        bail!("В этой сборке Aurum вход Microsoft ещё не подключён. Используйте сборку с поддержкой Microsoft-входа.")
    }
    Ok(id)
}

pub struct Login {
    listener: TcpListener,
    pub redirect_uri: String,
    pub authorize_uri: String,
    pub verifier: String,
    state: String,
}

fn authorize_uri(client: &str, redirect: &str, verifier: &str, state: &str) -> Url {
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url =
        Url::parse("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", client),
        ("response_type", "code"),
        ("redirect_uri", redirect),
        ("response_mode", "query"),
        ("scope", SCOPE),
        ("state", state),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    url
}

impl Login {
    pub async fn begin(client: &str) -> Result<Self> {
        // An ephemeral port avoids conflicts; Microsoft ignores localhost ports when matching redirects.
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .context("Не удалось подготовить возврат из Microsoft. Повторите вход")?;
        let redirect_uri = format!("http://localhost:{}", listener.local_addr()?.port());
        let verifier = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let state = uuid::Uuid::new_v4().simple().to_string();
        let authorize_uri = authorize_uri(client, &redirect_uri, &verifier, &state).into();
        Ok(Self {
            listener,
            redirect_uri,
            authorize_uri,
            verifier,
            state,
        })
    }

    pub async fn wait(&self, task: &Task) -> Result<String> {
        cancellable(task, Duration::from_secs(600), async {
            loop {
                let (mut stream, peer) = self.listener.accept().await?;
                if !peer.ip().is_loopback() { continue; }
                let request = tokio::time::timeout(Duration::from_secs(2), async {
                    let mut bytes = Vec::new();
                    loop {
                        let mut chunk = [0u8; 1024];
                        let count = stream.read(&mut chunk).await?;
                        if count == 0 { bail!("Неполный запрос") }
                        bytes.extend_from_slice(&chunk[..count]);
                        if bytes.len() > 16384 { bail!("Слишком большой запрос") }
                        if bytes.windows(4).any(|w| w == b"\r\n\r\n") { break; }
                    }
                    String::from_utf8(bytes).context("Неверный запрос")
                }).await;
                let callback = request.ok().and_then(Result::ok).and_then(|r| parse_callback(&r, &self.state));
                let (status, body) = if callback.is_some() {
                    ("200 OK", include_str!("microsoft_return.html"))
                } else {
                    ("400 Bad Request", "Откройте вход из Aurum. Эта ссылка не относится к текущему входу.")
                };
                let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}", body.len());
                // A closed browser tab must not discard a successfully received authorization.
                let _ = tokio::time::timeout(Duration::from_secs(2), stream.write_all(response.as_bytes())).await;
                if let Some(callback) = callback { return callback; }
            }
        }).await
    }
}

fn parse_callback(request: &str, expected_state: &str) -> Option<Result<String>> {
    let mut line = request.lines().next()?.split_whitespace();
    if line.next()? != "GET" {
        return None;
    }
    let target = line.next()?;
    if !target.starts_with("/?") || line.next()? != "HTTP/1.1" || line.next().is_some() {
        return None;
    }
    let url = Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != "/" || url.fragment().is_some() {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let value = |key: &str| {
        let mut values = pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_ref());
        let first = values.next()?;
        if values.next().is_some() {
            None
        } else {
            Some(first)
        }
    };
    if value("state")? != expected_state {
        return None;
    }
    let has_error = pairs.iter().any(|(k, _)| k == "error");
    let has_code = pairs.iter().any(|(k, _)| k == "code");
    if has_error == has_code {
        return None;
    }
    if has_error {
        return Some(Err(anyhow::anyhow!(match value("error")? {
            "access_denied" => "Вход отменён в Microsoft",
            "temporarily_unavailable" | "server_error" =>
                "Microsoft временно недоступен. Попробуйте позже",
            _ => "Microsoft не разрешил вход. Попробуйте снова или используйте другую сборку Aurum",
        })));
    }
    let code = value("code")?;
    if code.is_empty() {
        return None;
    }
    Some(Ok(code.to_owned()))
}

pub async fn cancellable<T>(
    task: &Task,
    timeout: Duration,
    future: impl Future<Output = Result<T>>,
) -> Result<T> {
    task.check()?;
    tokio::select! {
        result = future => result,
        _ = tokio::time::sleep(timeout) => bail!("Время ожидания входа истекло. Попробуйте снова"),
        result = async {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Err(error) = task.check() { break error; }
            }
        } => Err(result),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authorization_uses_pkce_and_personal_accounts() {
        // RFC 7636's independent verifier/challenge example.
        let url = authorize_uri(
            "app",
            "http://localhost:1234",
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "session",
        );
        let p: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(
            p["code_challenge"],
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(p["code_challenge_method"], "S256");
        assert_eq!(p["response_type"], "code");
        assert_eq!(p["state"], "session");
        assert!(!p.contains_key("client_secret"));
    }
    #[test]
    fn callback_validates_state_path_and_ambiguous_parameters() {
        let parse =
            |target: &str| parse_callback(&format!("GET {target} HTTP/1.1\r\n\r\n"), "session");
        assert_eq!(parse("/?code=a%2Bb&state=session").unwrap().unwrap(), "a+b");
        for target in [
            "/?code=a",
            "/?code=a&state=wrong",
            "/other?code=a&state=session",
            "/?code=a&code=b&state=session",
            "/?code=a&state=session&state=session",
            "/?code=a&error=access_denied&state=session",
            "/?code=&state=session",
        ] {
            assert!(parse(target).is_none(), "{target}");
        }
        let denied = parse("/?error=access_denied&state=session&error_description=secret")
            .unwrap()
            .unwrap_err();
        assert_eq!(denied.to_string(), "Вход отменён в Microsoft");
    }

    #[tokio::test]
    async fn loopback_ignores_unrelated_requests_and_accepts_the_right_session() {
        let folder = tempfile::tempdir().unwrap();
        let engine = crate::Engine::new(folder.path().into(), |_| {})
            .await
            .unwrap();
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        let login = Login::begin("test-client").await.unwrap();
        let browser = async {
            let client = reqwest::Client::new();
            let bad = client
                .get(format!(
                    "{}/?code=wrong&state=another-session",
                    login.redirect_uri
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(bad.status(), 400);
            let good = client
                .get(format!(
                    "{}/?code=accepted&state={}",
                    login.redirect_uri, login.state
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(good.status(), 200);
            assert_eq!(good.headers()["cache-control"], "no-store");
            let body = good.text().await.unwrap();
            assert!(body.contains("Возвращайтесь в Aurum"));
            assert!(!body.contains("accepted"));
        };
        let (result, ()) = tokio::join!(login.wait(&task), browser);
        assert_eq!(result.unwrap(), "accepted");
        let address = login.listener.local_addr().unwrap();
        drop(login);
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
    }

    #[tokio::test]
    async fn cancellation_stops_waiting_and_timeout_stops_network_work() {
        let folder = tempfile::tempdir().unwrap();
        let engine = crate::Engine::new(folder.path().into(), |_| {})
            .await
            .unwrap();
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        let login = Login::begin("test-client").await.unwrap();
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            engine.cancel(&task.id).await.unwrap();
        };
        let (result, ()) = tokio::join!(login.wait(&task), cancel);
        assert_eq!(result.unwrap_err().to_string(), "Операция отменена");
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        let result =
            cancellable::<()>(&task, Duration::from_millis(10), std::future::pending()).await;
        assert!(result.unwrap_err().to_string().contains("Время ожидания"));
    }
}
