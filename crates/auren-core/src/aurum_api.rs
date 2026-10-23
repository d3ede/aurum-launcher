use anyhow::{bail, Context, Result};
use reqwest::{Client, Url};
use serde::Deserialize;
use std::time::{Duration, Instant};

#[derive(Default)]
pub(crate) struct ApiStatus {
    checked: Option<(Instant, bool)>,
}

pub(crate) fn base_url() -> Result<Option<Url>> {
    let value = std::env::var("AURUM_API_URL").unwrap_or_else(|_| env!("AURUM_API_URL").to_owned());
    parse_base(&value)
}

fn parse_base(value: &str) -> Result<Option<Url>> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    let url = Url::parse(value.trim()).context("Неверный адрес Aurum API")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        bail!("Aurum API: требуется корневой HTTPS-адрес без параметров и учётных данных");
    }
    Ok(Some(url))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    api_version: u32,
    features: Features,
}
#[derive(Deserialize)]
struct Features {
    curseforge: bool,
}

async fn available(client: &Client, base: &Url) -> Result<bool> {
    let mut response = client
        .get(base.join("v1/config")?)
        .timeout(Duration::from_secs(3))
        .send()
        .await?
        .error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 16384 {
            bail!("Aurum API: слишком большой ответ конфигурации");
        }
        bytes.extend_from_slice(&chunk);
    }
    let config: Config = serde_json::from_slice(&bytes)?;
    Ok(config.api_version == 1 && config.features.curseforge)
}

pub(crate) fn curseforge_url(path: &str) -> Result<Url> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains('#') {
        bail!("Неверный путь CurseForge");
    }
    let base = base_url()?.context("Каталог CurseForge недоступен. Повторите позже.")?;
    Ok(Url::parse(&format!(
        "{}v1/curseforge{path}",
        base.as_str()
    ))?)
}

impl crate::Engine {
    pub(crate) async fn aurum_curseforge_available(&self) -> bool {
        let Ok(Some(base)) = base_url() else {
            return false;
        };
        let mut state = self.aurum_api_status.lock().await;
        if let Some((time, enabled)) = state.checked {
            if time.elapsed() < Duration::from_secs(60) {
                return enabled;
            }
        }
        let enabled = available(&self.http, &base).await.unwrap_or(false);
        state.checked = Some((Instant::now(), enabled));
        enabled
    }

    pub(crate) async fn curseforge_request(&self, path: &str) -> Result<serde_json::Value> {
        let response = self
            .http
            .get(curseforge_url(path)?)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .context("Не удалось связаться с сервисом CurseForge")?;
        match response.status().as_u16() {
            429 => bail!("Слишком много запросов CurseForge. Повторите через минуту"),
            503 => bail!("Сервис CurseForge временно недоступен"),
            502 | 504 => bail!("Сервис CurseForge временно недоступен"),
            _ => {}
        }
        Ok(response.error_for_status()?.json().await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_api_origin() {
        assert!(parse_base(" ").unwrap().is_none());
        assert_eq!(
            parse_base("https://api.example.com")
                .unwrap()
                .unwrap()
                .as_str(),
            "https://api.example.com/"
        );
        for bad in [
            "http://example.com",
            "https://a:b@example.com",
            "https://example.com/v1",
            "https://example.com?x=y",
            "https://example.com/#x",
        ] {
            assert!(parse_base(bad).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn config_contract_and_unavailable_responses() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (status, body, expected) in [
            (
                200,
                r#"{"apiVersion":1,"features":{"curseforge":true}}"#,
                true,
            ),
            (
                200,
                r#"{"apiVersion":2,"features":{"curseforge":true}}"#,
                false,
            ),
            (
                200,
                r#"{"apiVersion":1,"features":{"curseforge":false}}"#,
                false,
            ),
            (503, r#"{}"#, false),
            (200, r#"invalid"#, false),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
            let task = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0; 2048];
                let count = socket.read(&mut buf).await.unwrap();
                assert!(String::from_utf8_lossy(&buf[..count]).starts_with("GET /v1/config "));
                let response = format!("HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            });
            assert_eq!(
                available(&Client::new(), &base).await.unwrap_or(false),
                expected
            );
            task.await.unwrap();
        }
    }
}
