use crate::{model::Account, store::persist, Engine, Task};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub fn secret(id: &str) -> Result<String> {
    crate::secret_store::get(id)
}
pub fn set_secret(id: &str, value: &str) -> Result<()> {
    crate::secret_store::set(id, value)
}
pub fn delete_secret(id: &str) -> Result<()> {
    crate::secret_store::delete(id)
}
#[derive(Serialize, Deserialize)]
struct Credentials {
    #[serde(default)]
    client_id: String,
    refresh_token: String,
    access_token: String,
    expires_at: u64,
    xuid: String,
}

// Keep server diagnostics, but never forward arbitrary JSON (which may contain tokens).
async fn minecraft_login_reply(mut response: reqwest::Response, secrets: &[&str]) -> Result<Value> {
    let status = response.status();
    if status.is_success() {
        return Ok(response.json().await?);
    }
    let mut body = Vec::new();
    let mut read_failed = false;
    // Error pages can be unexpectedly large. Retain a bounded diagnostic response.
    while body.len() < 16 * 1024 {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let count = chunk.len().min(16 * 1024 - body.len());
                body.extend_from_slice(&chunk[..count]);
            }
            Ok(None) => break,
            Err(_) => {
                read_failed = true;
                break;
            }
        }
    }
    let mut details = Vec::new();
    if let Ok(json) = serde_json::from_slice::<Value>(&body) {
        for field in [
            "error",
            "errorMessage",
            "error_description",
            "message",
            "path",
            "developerMessage",
            "requestId",
            "correlationId",
        ] {
            if let Some(value) = json[field]
                .as_str()
                .filter(|value| !value.trim().is_empty())
            {
                details.push(format!("{field}: {value}"));
            }
        }
    } else {
        let text = String::from_utf8_lossy(&body);
        // HTML proxy/CDN pages are not useful as plain-text sign-in errors.
        if body.len() < 16 * 1024
            && !text.trim_start().starts_with(['<', '{', '['])
            && !text.trim().is_empty()
        {
            details.push(text.into_owned());
        }
    }
    let request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok());
    if let Some(id) = request_id {
        details.push(format!("x-request-id: {id}"));
    }
    if read_failed {
        details.push("[response read failed]".into());
    }
    if body.len() == 16 * 1024 {
        details.push("[error body truncated at 16384 bytes]".into());
    }
    if details.is_empty() {
        details.push("[no error description returned]".into());
    }
    let mut details = details.join("; ");
    // Redact even a credential echoed inside an otherwise legitimate error message.
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        details = details.replace(secret, "[redacted]");
    }
    let details = details.split_whitespace().collect::<Vec<_>>().join(" ");
    let details = if details.chars().count() > 1500 {
        format!("{}…", details.chars().take(1500).collect::<String>())
    } else {
        details
    };
    bail!("Minecraft Services: HTTP {status}. {details}")
}

impl Engine {
    pub async fn login_microsoft<F: std::future::Future<Output = Result<()>>>(
        &self,
        task: &Task,
        open: impl FnOnce(String) -> F,
    ) -> Result<Account> {
        use crate::microsoft_oauth::{self, cancellable, Login};
        use std::time::Duration;
        task.progress("auth-opening", "Открываем Microsoft", 0, 0);
        let client = microsoft_oauth::client_id()?;
        let login = Login::begin(client).await?;
        task.check()?;
        open(login.authorize_uri.clone()).await?;
        task.check()?;
        task.progress("auth-waiting", "Подтвердите вход в окне Microsoft", 0, 0);
        let code = login.wait(task).await?;
        task.progress("auth-exchange", "Подключаем ваш аккаунт", 0, 0);
        let oauth = cancellable(task, Duration::from_secs(90), async {
            let reply = self.http.post(microsoft_oauth::TOKEN_ENDPOINT)
                .form(&[
                    ("client_id", client), ("grant_type", "authorization_code"),
                    ("code", code.as_str()), ("code_verifier", login.verifier.as_str()),
                    ("redirect_uri", login.redirect_uri.as_str()), ("scope", microsoft_oauth::SCOPE),
                ]).send().await.context("Не удалось связаться с Microsoft. Проверьте интернет и повторите вход")?;
            if !reply.status().is_success() {
                bail!("Microsoft не завершил вход. Попробуйте снова; если ошибка повторяется, приложение Aurum требует проверки регистрации")
            }
            Ok(reply.json::<Value>().await?)
        }).await?;
        task.progress("auth-profile", "Проверяем Minecraft Java", 0, 0);
        let (mut credentials, profile) =
            cancellable(task, Duration::from_secs(180), self.exchange(&oauth)).await?;
        credentials.client_id = client.into();
        task.check()?;
        let uuid = profile["id"]
            .as_str()
            .context("Нет Minecraft UUID")?
            .to_string();
        let account = Account {
            id: uuid.clone(),
            uuid: uuid.clone(),
            name: profile["name"]
                .as_str()
                .context("Нет имени Minecraft")?
                .into(),
            kind: "microsoft".into(),
            skin_model: "steve".into(),
            has_skin: false,
        };
        set_secret(&uuid, &serde_json::to_string(&credentials)?)?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.accounts.retain(|a| a.id != uuid);
        next.accounts.push(account.clone());
        next.selected_account = Some(uuid);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(account)
    }
    async fn exchange(&self, oauth: &Value) -> Result<(Credentials, Value)> {
        let msa = oauth["access_token"]
            .as_str()
            .context("Microsoft не вернул токен")?;
        let xbox:Value=self.http.post("https://user.auth.xboxlive.com/user/authenticate").json(&json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={msa}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})).send().await?.error_for_status().context("Xbox Live отклонил вход")?.json().await?;
        let xbox_token = xbox["Token"].as_str().context("Нет Xbox token")?;
        let response=self.http.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbox_token]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"})).send().await?;
        if !response.status().is_success() {
            let error: Value = response.json().await?;
            bail!("Xbox XSTS: {}. Проверьте Xbox-профиль, возрастные ограничения и разрешения приложения",error["XErr"])
        }
        let xsts: Value = response.json().await?;
        let hash = xsts["DisplayClaims"]["xui"][0]["uhs"]
            .as_str()
            .context("Нет Xbox user hash")?;
        let token = xsts["Token"].as_str().context("Нет XSTS token")?;
        let response = self
            .http
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .json(&json!({"identityToken":format!("XBL3.0 x={hash};{token}")}))
            .send()
            .await?;
        let mc = minecraft_login_reply(response, &[msa, xbox_token, token]).await?;
        let access = mc["access_token"].as_str().context("Нет Minecraft token")?;
        let entitlements: Value = self
            .http
            .get("https://api.minecraftservices.com/entitlements/mcstore")
            .bearer_auth(access)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if !entitlements["items"].as_array().is_some_and(|items| {
            items.iter().any(|v| {
                matches!(
                    v["name"].as_str(),
                    Some("game_minecraft" | "product_minecraft")
                )
            })
        }) {
            bail!("У аккаунта не подтверждено право владения Minecraft Java Edition")
        }
        let profile: Value = self
            .http
            .get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(access)
            .send()
            .await?
            .error_for_status()
            .context("Minecraft Java профиль не найден")?
            .json()
            .await?;
        Ok((
            Credentials {
                client_id: String::new(),
                refresh_token: oauth["refresh_token"]
                    .as_str()
                    .context("Нет refresh token")?
                    .into(),
                access_token: access.into(),
                expires_at: crate::now() + mc["expires_in"].as_u64().unwrap_or(86400),
                xuid: xsts["DisplayClaims"]["xui"][0]["xid"]
                    .as_str()
                    .unwrap_or("")
                    .into(),
            },
            profile,
        ))
    }
    pub async fn minecraft_token(&self, id: &str) -> Result<String> {
        Ok(self.minecraft_credentials(id).await?.access_token)
    }
    pub(crate) async fn minecraft_launch_credentials(
        &self,
        id: &str,
    ) -> Result<(String, String, String)> {
        let credentials = self.minecraft_credentials(id).await?;
        let client_id = if credentials.client_id.is_empty() {
            crate::microsoft_oauth::client_id()?.to_string()
        } else {
            credentials.client_id
        };
        Ok((credentials.access_token, client_id, credentials.xuid))
    }
    async fn minecraft_credentials(&self, id: &str) -> Result<Credentials> {
        let credentials: Credentials = serde_json::from_str(&secret(id)?)?;
        if credentials.expires_at > crate::now() + 120 {
            return Ok(credentials);
        }
        // Remember the issuing app so later builds can refresh existing sessions.
        let client = if credentials.client_id.is_empty() {
            crate::microsoft_oauth::client_id()?.to_string()
        } else {
            credentials.client_id.clone()
        };
        let oauth: Value = self
            .http
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&[
                ("client_id", client.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", credentials.refresh_token.as_str()),
                ("scope", "XboxLive.signin offline_access"),
            ])
            .send()
            .await?
            .error_for_status()
            .context("Сессия истекла; войдите в Microsoft снова")?
            .json()
            .await?;
        let (mut credentials, _) = self.exchange(&oauth).await?;
        credentials.client_id = client;
        set_secret(id, &serde_json::to_string(&credentials)?)?;
        Ok(credentials)
    }
    pub fn xuid(&self, id: &str) -> Result<String> {
        let credentials: Credentials = serde_json::from_str(&secret(id)?)?;
        Ok(credentials.xuid)
    }
    pub fn account_client_id(&self, id: &str) -> Result<String> {
        let credentials: Credentials = serde_json::from_str(&secret(id)?)?;
        if credentials.client_id.is_empty() {
            Ok(crate::microsoft_oauth::client_id()?.to_string())
        } else {
            Ok(credentials.client_id)
        }
    }
    pub async fn set_skin(&self, id: &str, path: &std::path::Path, model: &str) -> Result<()> {
        if !["steve", "alex"].contains(&model) {
            bail!("Неизвестная модель скина")
        }
        if tokio::fs::metadata(path).await?.len() > 1_000_000 {
            bail!("PNG должен быть меньше 1 МБ")
        }
        let bytes = tokio::fs::read(path).await?;
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .context("Выберите PNG-скин")?;
        if image.width() != 64 || ![32, 64].contains(&image.height()) {
            bail!("Размер скина: 64×64 или 64×32")
        }
        let account = self
            .db
            .lock()
            .await
            .accounts
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .context("Аккаунт не найден")?;
        if account.kind == "microsoft" {
            let token = self.minecraft_token(id).await?;
            let form = reqwest::multipart::Form::new()
                .text("variant", if model == "alex" { "slim" } else { "classic" })
                .part(
                    "file",
                    reqwest::multipart::Part::bytes(bytes.clone())
                        .file_name("skin.png")
                        .mime_str("image/png")?,
                );
            self.http
                .post("https://api.minecraftservices.com/minecraft/profile/skins")
                .bearer_auth(token)
                .multipart(form)
                .send()
                .await?
                .error_for_status()
                .context("Minecraft не принял скин")?;
        }
        let folder = self.root.join("skins");
        tokio::fs::create_dir_all(&folder).await?;
        tokio::fs::write(folder.join(format!("{}.png", account.id)), &bytes).await?;
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        let account = next
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .context("Аккаунт удалён")?;
        account.skin_model = model.into();
        account.has_skin = true;
        persist(&self.root, &next).await?;
        *db = next;
        drop(db);
        self.cache_account_avatar(id, &bytes).await;
        Ok(())
    }
    pub async fn skin(&self, id: &str) -> Result<Vec<u8>> {
        let account = self
            .db
            .lock()
            .await
            .accounts
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .context("Аккаунт не найден")?;
        if !account.has_skin {
            return Ok(vec![]);
        }
        Ok(tokio::fs::read(self.root.join("skins").join(format!("{}.png", account.id))).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn reply(status: &str, body: &str, headers: &str) -> reqwest::Response {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let wire = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        );
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096];
            let mut request = Vec::new();
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut buffer).await.unwrap();
                assert!(count > 0, "client closed before sending HTTP headers");
                request.extend_from_slice(&buffer[..count]);
            }
            stream.write_all(wire.as_bytes()).await.unwrap();
        });
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn minecraft_rejection_preserves_reason_and_request_id_without_guessing() {
        let response = reply(
            "403 Forbidden",
            r#"{"error":"ForbiddenOperationException","errorMessage":"Invalid app registration, see https://aka.ms/AppRegInfo","path":"/authentication/login_with_xbox","requestId":"request-123"}"#,
            "",
        ).await;
        let error = minecraft_login_reply(response, &[])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("HTTP 403 Forbidden"));
        assert!(error.contains("error: ForbiddenOperationException"));
        assert!(
            error.contains("errorMessage: Invalid app registration, see https://aka.ms/AppRegInfo")
        );
        assert!(error.contains("requestId: request-123"));
        assert!(error.contains("path: /authentication/login_with_xbox"));
        assert!(!error.contains("Разработчику"));
    }

    #[tokio::test]
    async fn minecraft_errors_exclude_token_fields_and_redact_echoed_credentials() {
        let response = reply(
            "401 Unauthorized",
            r#"{"errorMessage":"Rejected secret-xsts and secret-msa","access_token":"private-access","refresh_token":"private-refresh","unknown":{"Token":"private-xbox"}}"#,
            "x-request-id: diagnostic-123\r\n",
        ).await;
        let error = minecraft_login_reply(response, &["secret-xsts", "secret-msa"])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("Rejected [redacted] and [redacted]"));
        assert!(error.contains("x-request-id: diagnostic-123"));
        for secret in [
            "secret-xsts",
            "secret-msa",
            "private-access",
            "private-refresh",
            "private-xbox",
        ] {
            assert!(!error.contains(secret));
        }
    }

    #[tokio::test]
    async fn minecraft_errors_handle_plain_text_missing_and_oversized_responses() {
        let response = reply("429 Too Many Requests", "Try again later\nRate limited", "").await;
        let error = minecraft_login_reply(response, &[])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("HTTP 429 Too Many Requests. Try again later Rate limited"));
        for body in [
            "",
            "<html>Proxy failure</html>",
            r#"{"access_token":"private"}"#,
            r#"{"access_token":"private"#,
        ] {
            let response = reply("503 Service Unavailable", body, "").await;
            let error = minecraft_login_reply(response, &[])
                .await
                .unwrap_err()
                .to_string();
            assert!(error.contains("HTTP 503 Service Unavailable"));
            assert!(error.contains("[no error description returned]"));
            assert!(!error.contains("private"));
        }
        let body = json!({"errorMessage": "я".repeat(2000)}).to_string();
        let response = reply("403 Forbidden", &body, "").await;
        let error = minecraft_login_reply(response, &[])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.ends_with('…'));
        assert!(error.chars().count() < 1600);
        let response = reply("403 Forbidden", &"x".repeat(20_000), "").await;
        let error = minecraft_login_reply(response, &[])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("HTTP 403 Forbidden"));
        assert!(error.len() < 200);
    }

    #[tokio::test]
    async fn successful_minecraft_login_keeps_token_response() {
        let response = reply(
            "200 OK",
            r#"{"access_token":"minecraft-token","expires_in":86400}"#,
            "",
        )
        .await;
        let result = minecraft_login_reply(response, &[]).await.unwrap();
        assert_eq!(result["access_token"], "minecraft-token");
        assert_eq!(result["expires_in"], 86400);
    }
}
