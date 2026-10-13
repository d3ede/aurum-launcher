use crate::{model::Account, store::persist, Engine, Task};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub fn secret(id: &str) -> Result<String> {
    keyring::Entry::new("app.auren.launcher", id)?
        .get_password()
        .context("Данные не найдены в хранилище учётных данных ОС")
}
pub fn set_secret(id: &str, value: &str) -> Result<()> {
    keyring::Entry::new("app.auren.launcher", id)?
        .set_password(value)
        .context("Не удалось сохранить секрет в хранилище ОС")
}
pub fn delete_secret(id: &str) -> Result<()> {
    keyring::Entry::new("app.auren.launcher", id)?
        .delete_credential()
        .map_err(Into::into)
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
impl Engine {
    pub async fn login_microsoft(
        &self,
        task: &Task,
        open: impl FnOnce(&str) -> Result<()>,
    ) -> Result<Account> {
        use crate::microsoft_oauth::{self, cancellable, Login};
        use std::time::Duration;
        task.progress("auth-opening", "Открываем Microsoft", 0, 0);
        let client = microsoft_oauth::client_id()?;
        let login = Login::begin(client).await?;
        task.check()?;
        open(&login.authorize_uri)?;
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
        let mc: Value = self
            .http
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .json(&json!({"identityToken":format!("XBL3.0 x={hash};{token}")}))
            .send()
            .await?
            .error_for_status()
            .context("Minecraft Services не разрешил вход для этой сборки Aurum. Разработчику нужно проверить доступ приложения")?
            .json()
            .await?;
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
        let credentials: Credentials = serde_json::from_str(&secret(id)?)?;
        if credentials.expires_at > crate::now() + 120 {
            return Ok(credentials.access_token);
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
        Ok(credentials.access_token)
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
        tokio::fs::write(folder.join(format!("{}.png", account.id)), bytes).await?;
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
