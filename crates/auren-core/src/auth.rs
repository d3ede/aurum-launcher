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
    refresh_token: String,
    access_token: String,
    expires_at: u64,
    xuid: String,
}
impl Engine {
    pub async fn login_microsoft(&self, task: &Task) -> Result<()> {
        let client_id = self.db.lock().await.settings.microsoft_client_id.clone();
        if client_id.is_empty() {
            bail!("Укажите Client ID зарегистрированного Microsoft приложения в настройках. Нужны public client flow, personal Microsoft accounts и доступ Minecraft Services")
        }
        let device: Value = self
            .http
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
            .form(&[
                ("client_id", client_id.as_str()),
                ("scope", "XboxLive.signin offline_access"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        task.progress(
            "auth-code",
            json!({"code":device["user_code"],"url":device["verification_uri"]}).to_string(),
            0,
            0,
        );
        let code = device["device_code"]
            .as_str()
            .context("Microsoft не вернул device_code")?;
        let mut interval = device["interval"].as_u64().unwrap_or(5);
        let deadline = crate::now() + device["expires_in"].as_u64().unwrap_or(900);
        let oauth = loop {
            task.check()?;
            if crate::now() > deadline {
                bail!("Код авторизации истёк; повторите вход")
            }
            for _ in 0..interval * 4 {
                task.check()?;
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
            let reply: Value = self
                .http
                .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
                .form(&[
                    ("client_id", client_id.as_str()),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    ("device_code", code),
                ])
                .send()
                .await?
                .json()
                .await?;
            match reply["error"].as_str() {
                Some("authorization_pending") => continue,
                Some("slow_down") => {
                    interval += 5;
                    continue;
                }
                Some(_) => bail!(
                    "Microsoft OAuth: {}",
                    reply["error_description"]
                        .as_str()
                        .unwrap_or("Вход отклонён")
                ),
                None => break reply,
            }
        };
        task.progress("auth", "Проверяем Xbox Live и владение Minecraft", 0, 0);
        let (credentials, profile) = self.exchange(&oauth).await?;
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
        next.accounts.push(account);
        next.selected_account = Some(uuid);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
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
            .context("Minecraft Services отклонил приложение; проверьте его разрешения")?
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
        let client = self.db.lock().await.settings.microsoft_client_id.clone();
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
        let (credentials, _) = self.exchange(&oauth).await?;
        set_secret(id, &serde_json::to_string(&credentials)?)?;
        Ok(credentials.access_token)
    }
    pub fn xuid(&self, id: &str) -> Result<String> {
        let credentials: Credentials = serde_json::from_str(&secret(id)?)?;
        Ok(credentials.xuid)
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
