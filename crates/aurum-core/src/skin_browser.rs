//! Read-only skin discovery. Importing an appearance never changes an account.
use crate::{
    skins::{encode_texture, validate_texture},
    Engine,
};
use anyhow::{bail, Context, Result};
use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct BrowserSkin {
    id: String,
    name: Option<String>,
    #[serde(rename = "shortId")]
    short_id: Option<String>,
    hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAppearance {
    pub id: String,
    pub name: Option<String>,
    pub short_id: Option<String>,
    pub model: String,
    pub texture: String,
}

fn skin_name(skin: &Value) -> Option<String> {
    skin["name"]
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(String::from)
}

#[derive(Debug, Serialize)]
pub struct BrowserPage {
    skins: Vec<BrowserSkin>,
    after: Option<String>,
}

fn hex_id(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn skin_id(query: &str) -> Result<String> {
    let query = query.trim();
    let value = if query.starts_with("https://") {
        let url = reqwest::Url::parse(query)?;
        if !matches!(url.host_str(), Some("mineskin.org" | "www.mineskin.org")) {
            bail!("Укажите ID или ссылку MineSkin")
        }
        url.path()
            .trim_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        query.to_string()
    };
    let value = value.replace('-', "");
    if !hex_id(&value, 8, 8) && !hex_id(&value, 32, 32) {
        bail!("Укажите ID или ссылку MineSkin")
    }
    Ok(value)
}

async fn body(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let seconds = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(60)
            .min(3600);
        bail!("Слишком много запросов. Повторите через {} с.", seconds)
    }
    if response.status() == reqwest::StatusCode::NOT_FOUND
        || response.status() == reqwest::StatusCode::NO_CONTENT
    {
        bail!("Скин или игрок не найден")
    }
    let mut response = response
        .error_for_status()
        .context("Не удалось загрузить скины. Проверьте подключение")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            bail!("Ответ сервиса скинов слишком большой")
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

impl Engine {
    async fn skin_browser_json(&self, url: reqwest::Url) -> Result<Value> {
        let response = self
            .http
            .get(url)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .context("Не удалось загрузить скины. Проверьте подключение")?;
        let value: Value = serde_json::from_slice(&body(response, 1_000_000).await?)?;
        if value["success"] == false {
            bail!("Скин или игрок не найден")
        }
        Ok(value)
    }

    pub async fn browse_skins(
        &self,
        query: &str,
        mode: &str,
        after: Option<&str>,
    ) -> Result<BrowserPage> {
        if query.chars().count() > 100 {
            bail!("Поисковый запрос слишком длинный")
        }
        let path = match mode {
            "latest" => "",
            "popular" => "/popular",
            "random" => "/random",
            _ => bail!("Неизвестный порядок скинов"),
        };
        let mut url = reqwest::Url::parse(&format!("https://api.mineskin.org/v2/skins{path}"))?;
        {
            let mut params = url.query_pairs_mut();
            params.append_pair("size", "18");
            if !query.trim().is_empty() {
                params.append_pair("filter", query.trim());
            }
            if let Some(after) = after {
                if !hex_id(after, 32, 32) {
                    bail!("Неверная страница скинов")
                }
                params.append_pair("after", after);
            }
        }
        let value = self.skin_browser_json(url).await?;
        let skins = value["skins"]
            .as_array()
            .context("Сервис вернул неверный список скинов")?
            .iter()
            .filter_map(|skin| {
                let id = skin["uuid"].as_str()?;
                let hash = skin["texture"].as_str()?;
                if !hex_id(id, 32, 32) || !hex_id(hash, 64, 64) {
                    return None;
                }
                Some(BrowserSkin {
                    id: id.into(),
                    name: skin_name(skin),
                    short_id: skin["shortId"]
                        .as_str()
                        .filter(|id| hex_id(id, 8, 8))
                        .map(String::from),
                    hash: hash.into(),
                })
            })
            .collect();
        Ok(BrowserPage {
            skins,
            after: value["pagination"]["next"]["after"]
                .as_str()
                .filter(|id| hex_id(id, 32, 32) && Some(*id) != after)
                .map(String::from),
        })
    }

    pub async fn skin_browser_texture(&self, hash: &str) -> Result<String> {
        if !hex_id(hash, 64, 64) {
            bail!("Неверный адрес текстуры скина")
        }
        let response = self
            .http
            .get(format!("https://textures.minecraft.net/texture/{hash}"))
            .timeout(Duration::from_secs(15))
            .send()
            .await?;
        Ok(encode_texture(&validate_texture(
            &body(response, 1_000_000).await?,
            false,
        )?))
    }

    pub async fn skin_browser_skin(&self, query: &str, source: &str) -> Result<BrowserAppearance> {
        let (id, name, short_id, model, url) = if source == "mineskin" {
            let id = skin_id(query)?;
            let result = self
                .skin_browser_json(reqwest::Url::parse(&format!(
                    "https://api.mineskin.org/v2/skins/{id}"
                ))?)
                .await?;
            let skin = &result["skin"];
            let variant = skin["variant"]
                .as_str()
                .context("Неизвестная модель скина")?;
            let model = match variant {
                "slim" => "alex",
                "classic" => "steve",
                _ => bail!("Неизвестная модель скина"),
            };
            (
                format!(
                    "mineskin:{}",
                    skin["uuid"].as_str().context("Скин или игрок не найден")?
                ),
                skin_name(skin),
                skin["shortId"]
                    .as_str()
                    .filter(|id| hex_id(id, 8, 8))
                    .map(String::from),
                model.to_string(),
                skin["texture"]["url"]["skin"]
                    .as_str()
                    .context("Неверный адрес текстуры скина")?
                    .to_string(),
            )
        } else if source == "player" {
            let query = query.trim();
            let uuid = query.replace('-', "");
            let (uuid, name) = if hex_id(&uuid, 32, 32) {
                (uuid, query.to_string())
            } else {
                if query.is_empty()
                    || query.len() > 16
                    || !query
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_')
                {
                    bail!("Укажите ник Minecraft или UUID игрока")
                }
                let result = self
                    .skin_browser_json(reqwest::Url::parse(&format!(
                        "https://api.mojang.com/users/profiles/minecraft/{query}"
                    ))?)
                    .await?;
                (
                    result["id"]
                        .as_str()
                        .context("Скин или игрок не найден")?
                        .to_string(),
                    result["name"].as_str().unwrap_or(query).to_string(),
                )
            };
            // Resolve the player's actual skin, not a MineSkin generator account or uploader.
            let result = self
                .skin_browser_json(reqwest::Url::parse(&format!(
                    "https://sessionserver.mojang.com/session/minecraft/profile/{uuid}"
                ))?)
                .await?;
            let property = result["properties"]
                .as_array()
                .and_then(|p| p.iter().find(|p| p["name"] == "textures"))
                .and_then(|p| p["value"].as_str())
                .context("У игрока нет собственного скина")?;
            let textures: Value = serde_json::from_slice(
                &base64::engine::general_purpose::STANDARD.decode(property)?,
            )?;
            let skin = &textures["textures"]["SKIN"];
            (
                format!("player:{uuid}"),
                Some(result["name"].as_str().unwrap_or(&name).to_string()),
                None,
                if skin["metadata"]["model"] == "slim" {
                    "alex"
                } else {
                    "steve"
                }
                .to_string(),
                skin["url"]
                    .as_str()
                    .context("У игрока нет собственного скина")?
                    .to_string(),
            )
        } else {
            bail!("Неизвестный источник скинов")
        };
        let url = reqwest::Url::parse(&url)?;
        if url.host_str() != Some("textures.minecraft.net")
            || !matches!(url.scheme(), "http" | "https")
        {
            bail!("Неверный адрес текстуры скина")
        }
        let hash = url
            .path()
            .strip_prefix("/texture/")
            .context("Неверный адрес текстуры скина")?;
        Ok(BrowserAppearance {
            id,
            name,
            short_id,
            model,
            texture: self.skin_browser_texture(hash).await?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_real_names_and_keeps_missing_names_separate_from_ids() {
        for name in [
            "Knight",
            "  Рыцарь ночи  ",
            "竜の騎士",
            "none",
            "a".repeat(100).as_str(),
        ] {
            let value =
                serde_json::json!({"name": name, "uuid": "a".repeat(32), "shortId": "abcd1234"});
            assert_eq!(skin_name(&value).as_deref(), Some(name.trim()));
        }
        for value in [
            serde_json::json!({"name": null, "shortId": "abcd1234"}),
            serde_json::json!({"name": "  "}),
            serde_json::json!({}),
        ] {
            assert_eq!(skin_name(&value), None);
        }
    }
    #[test]
    fn accepts_only_mineskin_ids_and_links() {
        assert_eq!(
            skin_id("https://mineskin.org/skins/898c498b?foo=bar").unwrap(),
            "898c498b"
        );
        assert_eq!(
            skin_id("ebb8fa97-5e51-4b6c-907a-6f55702ff2e8").unwrap(),
            "ebb8fa975e514b6c907a6f55702ff2e8"
        );
        for invalid in [
            "https://evil.test/898c498b",
            "https://mineskin.org.evil.test/898c498b",
            "../898c498b",
            "popular",
            "gggggggg",
        ] {
            assert!(skin_id(invalid).is_err(), "{invalid}");
        }
    }
}
