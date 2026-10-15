use crate::{store::validate_name, Engine};
use anyhow::{bail, Context, Result};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSkin {
    pub id: String,
    pub name: String,
    pub model: String,
    pub texture: String,
    pub cape_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedCape {
    pub id: String,
    pub name: String,
    pub texture: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSelection {
    pub skin_id: String,
    pub cape_id: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SkinLibrary {
    #[serde(default)]
    pub skins: Vec<SavedSkin>,
    #[serde(default)]
    pub capes: Vec<SavedCape>,
    #[serde(default)]
    pub selections: HashMap<String, AppearanceSelection>,
}
#[derive(Debug, Serialize)]
pub struct OwnedCape {
    pub id: String,
    pub name: String,
    pub texture: String,
    pub active: bool,
}
#[derive(Debug, Serialize)]
pub struct Appearance {
    pub texture: String,
    pub model: String,
    pub capes: Vec<OwnedCape>,
}

pub fn encode_texture(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
fn decode_texture(texture: &str) -> Result<Vec<u8>> {
    Ok(base64::engine::general_purpose::STANDARD.decode(
        texture
            .strip_prefix("data:image/png;base64,")
            .context("Неверный формат текстуры")?,
    )?)
}
pub fn validate_texture(bytes: &[u8], cape: bool) -> Result<Vec<u8>> {
    if bytes.len() > 1_000_000 {
        bail!("PNG должен быть меньше 1 МБ")
    }
    let reader =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
    let (width, height) = reader.into_dimensions().context("Выберите PNG-текстуру")?;
    if width != 64
        || if cape {
            height != 32
        } else {
            ![32, 64].contains(&height)
        }
    {
        bail!(
            "{}",
            if cape {
                "Размер плаща: 64×32"
            } else {
                "Размер скина: 64×64 или 64×32"
            }
        );
    }
    let decoded = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)?;
    let mut output = std::io::Cursor::new(vec![]);
    decoded.write_to(&mut output, image::ImageFormat::Png)?;
    Ok(output.into_inner())
}
fn validate_model(model: &str) -> Result<()> {
    if !["steve", "alex"].contains(&model) {
        bail!("Неизвестная модель скина")
    }
    Ok(())
}
fn validate_cape_id(id: Option<&str>, library: &SkinLibrary) -> Result<()> {
    if let Some(id) = id {
        if let Some(owned) = id.strip_prefix("owned:") {
            uuid::Uuid::parse_str(owned).context("Неверный идентификатор плаща")?;
        } else if !library.capes.iter().any(|c| c.id == id) {
            bail!("Плащ не найден в библиотеке")
        }
    }
    Ok(())
}
pub fn default_texture(id: &str, model: &str) -> Result<Vec<u8>> {
    validate_model(model)?;
    macro_rules! skins { ($($name:literal),*) => { match (id.strip_prefix("default:").unwrap_or(""),model) {
        $(($name,"steve") => Ok(include_bytes!(concat!("../../../src/assets/skins/wide-",$name,".png")).to_vec()),
          ($name,"alex") => Ok(include_bytes!(concat!("../../../src/assets/skins/slim-",$name,".png")).to_vec()),)*
        _ => anyhow::bail!("Стандартный скин не найден"),
    } } }
    skins!("steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri")
}

impl Engine {
    pub async fn import_modrinth_skins(
        &self,
        roots: Vec<std::path::PathBuf>,
    ) -> Result<crate::modrinth_skins::ModrinthSkinImportResult> {
        let scan = tokio::task::spawn_blocking(move || crate::modrinth_skins::scan(&roots)).await?;
        let _lock = self.db.lock().await;
        let mut library = self.skin_library().await?;
        let mut report = crate::modrinth_skins::ModrinthSkinImportResult {
            invalid: scan.invalid,
            warnings: scan.warnings,
            ..Default::default()
        };
        let mut existing: std::collections::HashSet<_> = library
            .skins
            .iter()
            .map(|s| {
                // Normalize existing PNGs too, so encoding metadata does not create duplicates.
                let texture = decode_texture(&s.texture)
                    .and_then(|b| validate_texture(&b, false))
                    .map(|b| encode_texture(&b))
                    .unwrap_or_else(|_| s.texture.clone());
                (texture, s.model.clone())
            })
            .collect();
        let mut number = library.skins.len() + 1;
        for skin in scan.skins {
            if !existing.insert((skin.texture.clone(), skin.model.clone())) {
                report.duplicates += 1;
                continue;
            }
            while library
                .skins
                .iter()
                .any(|s| s.name == format!("Modrinth {number}"))
            {
                number += 1;
            }
            library.skins.push(SavedSkin {
                id: uuid::Uuid::new_v4().to_string(),
                name: format!("Modrinth {number}"),
                model: skin.model,
                texture: skin.texture,
                cape_id: None,
            });
            number += 1;
            report.imported += 1;
        }
        if report.imported > 0 {
            self.persist_skins(&library).await?;
        }
        Ok(report)
    }

    pub async fn skin_library(&self) -> Result<SkinLibrary> {
        let path = self.root.join("skin-library.json");
        if !path.exists() {
            return Ok(SkinLibrary::default());
        }
        serde_json::from_slice(&tokio::fs::read(path).await?)
            .context("Не удалось прочитать библиотеку скинов; исходный файл сохранён")
    }
    async fn persist_skins(&self, library: &SkinLibrary) -> Result<()> {
        let temp = self.root.join("skin-library.json.tmp");
        let mut file = tokio::fs::File::create(&temp).await?;
        use tokio::io::AsyncWriteExt;
        file.write_all(&serde_json::to_vec_pretty(library)?).await?;
        file.sync_all().await?;
        drop(file);
        tokio::fs::rename(temp, self.root.join("skin-library.json")).await?;
        Ok(())
    }
    pub async fn save_library_skin(
        &self,
        id: Option<String>,
        name: String,
        model: String,
        bytes: Vec<u8>,
        cape_id: Option<String>,
    ) -> Result<SavedSkin> {
        validate_name(&name)?;
        validate_model(&model)?;
        let texture = encode_texture(&validate_texture(&bytes, false)?);
        let _lock = self.db.lock().await;
        let mut library = self.skin_library().await?;
        validate_cape_id(cape_id.as_deref(), &library)?;
        let skin = SavedSkin {
            id: id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            name: name.trim().into(),
            model,
            texture,
            cape_id,
        };
        if id.is_some() {
            let old = library
                .skins
                .iter_mut()
                .find(|s| s.id == skin.id)
                .context("Скин не найден")?;
            *old = skin.clone();
        } else {
            library.skins.push(skin.clone());
        }
        self.persist_skins(&library).await?;
        Ok(skin)
    }
    pub async fn save_library_cape(&self, name: String, bytes: Vec<u8>) -> Result<SavedCape> {
        validate_name(&name)?;
        let texture = encode_texture(&validate_texture(&bytes, true)?);
        let _lock = self.db.lock().await;
        let mut library = self.skin_library().await?;
        if let Some(existing) = library.capes.iter().find(|c| c.texture == texture) {
            return Ok(existing.clone());
        }
        let cape = SavedCape {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.trim().into(),
            texture,
        };
        library.capes.push(cape.clone());
        self.persist_skins(&library).await?;
        Ok(cape)
    }
    pub async fn delete_library_item(&self, id: &str, cape: bool) -> Result<()> {
        let _lock = self.db.lock().await;
        let mut library = self.skin_library().await?;
        if cape {
            if !library.capes.iter().any(|c| c.id == id) {
                bail!("Плащ не найден")
            }
            library.capes.retain(|c| c.id != id);
            for skin in &mut library.skins {
                if skin.cape_id.as_deref() == Some(id) {
                    skin.cape_id = None;
                }
            }
            for selected in library.selections.values_mut() {
                if selected.cape_id.as_deref() == Some(id) {
                    selected.cape_id = None;
                }
            }
        } else {
            if !library.skins.iter().any(|s| s.id == id) {
                bail!("Скин не найден")
            }
            library.skins.retain(|s| s.id != id);
            library.selections.retain(|_, s| s.skin_id != id);
        }
        self.persist_skins(&library).await
    }
    async fn minecraft_profile(&self, id: &str) -> Result<Value> {
        let token = self.minecraft_token(id).await?;
        Ok(self
            .http
            .get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(token)
            .send()
            .await?
            .error_for_status()
            .context("Не удалось получить скин и плащи Minecraft")?
            .json()
            .await?)
    }
    async fn minecraft_texture(&self, url: &str, cape: bool) -> Result<String> {
        let mut url = reqwest::Url::parse(url)?;
        if url.host_str() != Some("textures.minecraft.net") {
            bail!("Неизвестный источник текстуры Minecraft")
        }
        url.set_scheme("https")
            .map_err(|_| anyhow::anyhow!("Неверный адрес текстуры"))?;
        let mut response = self.http.get(url).send().await?.error_for_status()?;
        let mut bytes = vec![];
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 1_000_000 {
                bail!("Текстура слишком большая")
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(encode_texture(&validate_texture(&bytes, cape)?))
    }
    pub async fn account_appearance(&self, id: &str) -> Result<Appearance> {
        let account = self
            .db
            .lock()
            .await
            .accounts
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .context("Аккаунт не найден")?;
        if account.kind != "microsoft" {
            return Ok(Appearance {
                texture: if account.has_skin {
                    encode_texture(&self.skin(id).await?)
                } else {
                    String::new()
                },
                model: account.skin_model,
                capes: vec![],
            });
        }
        let profile = self.minecraft_profile(id).await?;
        let active = profile["skins"]
            .as_array()
            .and_then(|skins| skins.iter().find(|s| s["state"] == "ACTIVE"));
        let (texture, model) = if let Some(skin) = active {
            (
                self.minecraft_texture(skin["url"].as_str().context("Нет текстуры скина")?, false)
                    .await?,
                if skin["variant"] == "SLIM" {
                    "alex"
                } else {
                    "steve"
                }
                .into(),
            )
        } else {
            (String::new(), "steve".into())
        };
        let mut capes = vec![];
        if let Some(list) = profile["capes"].as_array() {
            for cape in list {
                let Some(id) = cape["id"].as_str() else {
                    continue;
                };
                uuid::Uuid::parse_str(id)?;
                capes.push(OwnedCape {
                    id: format!("owned:{id}"),
                    name: cape["alias"].as_str().unwrap_or("Minecraft").into(),
                    active: cape["state"] == "ACTIVE",
                    texture: self
                        .minecraft_texture(
                            cape["url"].as_str().context("Нет текстуры плаща")?,
                            true,
                        )
                        .await?,
                });
            }
        }
        Ok(Appearance {
            texture,
            model,
            capes,
        })
    }
    pub async fn apply_library_skin(
        &self,
        account_id: &str,
        skin_id: &str,
        model: &str,
        cape_id: Option<String>,
    ) -> Result<()> {
        validate_model(model)?;
        let library = self.skin_library().await?;
        validate_cape_id(cape_id.as_deref(), &library)?;
        let bytes = if skin_id.starts_with("default:") {
            default_texture(skin_id, model)?
        } else {
            decode_texture(
                &library
                    .skins
                    .iter()
                    .find(|s| s.id == skin_id)
                    .context("Скин не найден")?
                    .texture,
            )?
        };
        let account = self
            .db
            .lock()
            .await
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .cloned()
            .context("Аккаунт не найден")?;
        if account.kind == "microsoft" {
            if let Some(id) = cape_id.as_deref() {
                let owned = id.strip_prefix("owned:").context("Локальные плащи доступны только для предпросмотра. Выберите плащ вашего Minecraft-аккаунта")?;
                let profile = self.minecraft_profile(account_id).await?;
                if !profile["capes"]
                    .as_array()
                    .is_some_and(|capes| capes.iter().any(|c| c["id"] == owned))
                {
                    bail!("Этот плащ не принадлежит выбранному аккаунту")
                }
            }
        } else if cape_id
            .as_deref()
            .is_some_and(|id| id.starts_with("owned:"))
        {
            bail!("Для этого плаща выберите Microsoft-аккаунт")
        }
        let pending = self
            .root
            .join(format!("skin-apply-{}.png", uuid::Uuid::new_v4()));
        tokio::fs::write(&pending, &bytes).await?;
        let result = self.set_skin(account_id, &pending, model).await;
        let _ = tokio::fs::remove_file(&pending).await;
        result?;
        if account.kind == "microsoft" {
            let token = self.minecraft_token(account_id).await?;
            let endpoint = "https://api.minecraftservices.com/minecraft/profile/capes/active";
            let request =
                if let Some(owned) = cape_id.as_deref().and_then(|id| id.strip_prefix("owned:")) {
                    self.http
                        .put(endpoint)
                        .json(&serde_json::json!({"capeId":owned}))
                } else {
                    self.http.delete(endpoint)
                };
            request
                .bearer_auth(token)
                .send()
                .await?
                .error_for_status()
                .context(
                    "Скин применён, но Minecraft не принял изменение плаща. Повторите применение",
                )?;
        }
        let _lock = self.db.lock().await;
        let mut library = self.skin_library().await?;
        library.selections.insert(
            account_id.into(),
            AppearanceSelection {
                skin_id: skin_id.into(),
                cape_id,
            },
        );
        self.persist_skins(&library).await
    }
}
