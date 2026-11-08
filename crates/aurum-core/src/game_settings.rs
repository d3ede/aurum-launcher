use crate::{model::Runtime, store::persist, Engine};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

const MAX_OPTIONS: u64 = 1_048_576;
const BACKUP: &str = "options.aurum-backup.txt";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Graphics,
    Fov,
    Controls,
    Mouse,
    Sound,
    Interface,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSettingsPreset {
    pub id: String,
    pub name: String,
    pub source_version: String,
    pub source_name: String,
    pub options: String,
    pub categories: Vec<Category>,
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub applied: usize,
    pub skipped: Vec<String>,
}

// Only stable releases have a known format. Snapshot/prerelease settings are
// transferred only to the exact same version.
fn release(version: &str) -> Option<(u16, u16, u16)> {
    let parts = version
        .split('.')
        .map(str::parse::<u16>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .ok()?;
    match parts.as_slice() {
        [1, minor, patch] => Some((1, *minor, *patch)),
        [1, minor] => Some((1, *minor, 0)),
        [year, drop] if *year >= 26 => Some((*year, *drop, 0)),
        [year, drop, patch] if *year >= 26 => Some((*year, *drop, *patch)),
        _ => None,
    }
}

fn parse(raw: &str) -> BTreeMap<String, String> {
    raw.trim_start_matches('\u{feff}')
        .lines()
        .filter_map(|line| {
            let (key, value) = line.trim_end_matches('\r').split_once(':')?;
            (!key.is_empty()).then(|| (key.to_owned(), value.to_owned()))
        })
        .collect()
}

fn category(key: &str) -> Option<Category> {
    Some(match key {
        "fov" | "fovEffectScale" | "bobView" => Category::Fov,
        "mouseSensitivity"
        | "invertYMouse"
        | "rawMouseInput"
        | "mouseWheelSensitivity"
        | "discrete_mouse_scroll"
        | "touchscreen" => Category::Mouse,
        "toggleCrouch" | "toggleSprint" | "autoJump" => Category::Controls,
        "lang"
        | "guiScale"
        | "forceUnicodeFont"
        | "chatScale"
        | "chatWidth"
        | "chatHeightFocused"
        | "chatHeightUnfocused"
        | "chatOpacity"
        | "chatVisibility"
        | "chatColors"
        | "chatLinks"
        | "chatLinksPrompt"
        | "chatTextOpacity"
        | "textBackgroundOpacity"
        | "showSubtitles" => Category::Interface,
        "renderDistance"
        | "simulationDistance"
        | "maxFps"
        | "enableVsync"
        | "fancyGraphics"
        | "graphicsMode"
        | "graphicsPreset"
        | "ao"
        | "renderClouds"
        | "particles"
        | "entityShadows"
        | "entityDistanceScaling"
        | "gamma"
        | "mipmapLevels"
        | "biomeBlendRadius" => Category::Graphics,
        k if k.starts_with("soundCategory_")
            && [
                "master", "music", "record", "weather", "block", "hostile", "neutral", "player",
                "ambient", "voice",
            ]
            .contains(&k.trim_start_matches("soundCategory_")) =>
        {
            Category::Sound
        }
        // Mod keybinds are intentionally kept local to each modpack.
        k if vanilla_binding(k) => Category::Controls,
        _ => return None,
    })
}

fn vanilla_binding(key: &str) -> bool {
    [
        "forward",
        "left",
        "back",
        "right",
        "jump",
        "sneak",
        "sprint",
        "inventory",
        "swapOffhand",
        "drop",
        "use",
        "attack",
        "pickItem",
        "chat",
        "playerlist",
        "command",
        "screenshot",
        "togglePerspective",
        "smoothCamera",
        "fullscreen",
        "spectatorOutlines",
        "advancements",
        "saveToolbarActivator",
        "loadToolbarActivator",
        "socialInteractions",
    ]
    .iter()
    .any(|name| key == format!("key_key.{name}"))
        || (1..=9).any(|n| key == format!("key_key.hotbar.{n}"))
}

fn since(key: &str) -> (u16, u16, u16) {
    match key {
        "simulationDistance" => (1, 18, 0),
        "graphicsMode" | "fovEffectScale" | "entityDistanceScaling" => (1, 16, 0),
        "graphicsPreset" => (1, 21, 11),
        "toggleCrouch" | "toggleSprint" => (1, 15, 0),
        "rawMouseInput"
        | "mouseWheelSensitivity"
        | "discrete_mouse_scroll"
        | "biomeBlendRadius"
        | "chatTextOpacity"
        | "textBackgroundOpacity" => (1, 14, 0),
        "autoJump" => (1, 10, 0),
        "showSubtitles" | "key_key.swapOffhand" => (1, 9, 0),
        "key_key.advancements"
        | "key_key.saveToolbarActivator"
        | "key_key.loadToolbarActivator" => (1, 12, 0),
        "key_key.socialInteractions" => (1, 16, 4),
        "entityShadows" => (1, 8, 0),
        _ => (1, 7, 2),
    }
}

fn valid(key: &str, value: &str) -> bool {
    let number = |min: f64, max: f64| {
        value
            .parse::<f64>()
            .is_ok_and(|n| n.is_finite() && n >= min && n <= max)
    };
    match key {
        "fov" => number(-1.0, 1.0),
        "mouseWheelSensitivity" => number(0.01, 10.0),
        "renderDistance" => number(2.0, 64.0),
        "simulationDistance" => number(5.0, 32.0),
        "maxFps" => number(10.0, 260.0),
        "guiScale" => number(0.0, 16.0),
        "mipmapLevels" => number(0.0, 4.0),
        "biomeBlendRadius" => number(0.0, 7.0),
        "entityDistanceScaling" => number(0.5, 5.0),
        "particles" | "chatVisibility" | "graphicsMode" => ["0", "1", "2"].contains(&value),
        "ao" => ["true", "false", "0", "1", "2"].contains(&value),
        "renderClouds" => ["true", "false", "fast", "fancy", "0", "1", "2"].contains(&value),
        "graphicsPreset" => ["fast", "fancy", "fabulous", "custom"].contains(&value),
        "lang" => {
            value.len() <= 32
                && value.contains('_')
                && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        }
        "mouseSensitivity"
        | "gamma"
        | "fovEffectScale"
        | "chatScale"
        | "chatWidth"
        | "chatHeightFocused"
        | "chatHeightUnfocused"
        | "chatOpacity"
        | "chatTextOpacity"
        | "textBackgroundOpacity" => number(0.0, 1.0),
        k if k.starts_with("soundCategory_") => number(0.0, 1.0),
        k if vanilla_binding(k) => {
            binding(value, true).is_some() || binding(value, false).is_some()
        }
        _ => value == "true" || value == "false",
    }
}

// LWJGL 2 scan codes ↔ Minecraft's post-1.13 named bindings. Unsupported
// scan codes are skipped rather than silently changed to an unrelated key.
fn binding(value: &str, modern: bool) -> Option<String> {
    let pairs = [
        (0, "unknown"),
        (1, "escape"),
        (2, "1"),
        (3, "2"),
        (4, "3"),
        (5, "4"),
        (6, "5"),
        (7, "6"),
        (8, "7"),
        (9, "8"),
        (10, "9"),
        (11, "0"),
        (12, "minus"),
        (13, "equal"),
        (14, "backspace"),
        (15, "tab"),
        (16, "q"),
        (17, "w"),
        (18, "e"),
        (19, "r"),
        (20, "t"),
        (21, "y"),
        (22, "u"),
        (23, "i"),
        (24, "o"),
        (25, "p"),
        (26, "left.bracket"),
        (27, "right.bracket"),
        (28, "enter"),
        (29, "left.control"),
        (30, "a"),
        (31, "s"),
        (32, "d"),
        (33, "f"),
        (34, "g"),
        (35, "h"),
        (36, "j"),
        (37, "k"),
        (38, "l"),
        (39, "semicolon"),
        (40, "apostrophe"),
        (41, "grave.accent"),
        (42, "left.shift"),
        (43, "backslash"),
        (44, "z"),
        (45, "x"),
        (46, "c"),
        (47, "v"),
        (48, "b"),
        (49, "n"),
        (50, "m"),
        (51, "comma"),
        (52, "period"),
        (53, "slash"),
        (54, "right.shift"),
        (55, "keypad.multiply"),
        (56, "left.alt"),
        (57, "space"),
        (58, "caps.lock"),
        (59, "f1"),
        (60, "f2"),
        (61, "f3"),
        (62, "f4"),
        (63, "f5"),
        (64, "f6"),
        (65, "f7"),
        (66, "f8"),
        (67, "f9"),
        (68, "f10"),
        (69, "num.lock"),
        (70, "scroll.lock"),
        (71, "keypad.7"),
        (72, "keypad.8"),
        (73, "keypad.9"),
        (74, "keypad.subtract"),
        (75, "keypad.4"),
        (76, "keypad.5"),
        (77, "keypad.6"),
        (78, "keypad.add"),
        (79, "keypad.1"),
        (80, "keypad.2"),
        (81, "keypad.3"),
        (82, "keypad.0"),
        (83, "keypad.decimal"),
        (87, "f11"),
        (88, "f12"),
        (156, "keypad.enter"),
        (157, "right.control"),
        (181, "keypad.divide"),
        (184, "right.alt"),
        (199, "home"),
        (200, "up"),
        (201, "page.up"),
        (203, "left"),
        (205, "right"),
        (207, "end"),
        (208, "down"),
        (209, "page.down"),
        (210, "insert"),
        (211, "delete"),
        (219, "left.win"),
        (220, "right.win"),
    ];
    if modern {
        if let Some(name) = value.strip_prefix("key.keyboard.") {
            let known = pairs.iter().any(|(_, key)| *key == name)
                || name
                    .strip_prefix('f')
                    .and_then(|n| n.parse::<u8>().ok())
                    .is_some_and(|n| (1..=25).contains(&n))
                || ["pause", "print.screen", "menu"].contains(&name);
            return known.then(|| value.into());
        }
        if let Some(name) = value.strip_prefix("key.mouse.") {
            return (["left", "right", "middle"].contains(&name)
                || name.parse::<u8>().is_ok_and(|n| (4..=8).contains(&n)))
            .then(|| value.into());
        }
    }
    if let Ok(n) = value.parse::<i32>() {
        if (-100..=-93).contains(&n) {
            let button = n + 100;
            let name = match button {
                0 => "left".into(),
                1 => "right".into(),
                2 => "middle".into(),
                _ => (button + 1).to_string(),
            };
            return Some(if modern {
                format!("key.mouse.{name}")
            } else {
                value.into()
            });
        }
        let (_, name) = pairs.iter().find(|(code, _)| *code == n)?;
        return Some(if modern {
            format!("key.keyboard.{name}")
        } else {
            value.into()
        });
    }
    if let Some(name) = value.strip_prefix("key.mouse.") {
        let n = match name {
            "left" => 0,
            "right" => 1,
            "middle" => 2,
            _ => name.parse::<i32>().ok()?.checked_sub(1)?,
        };
        return (0..=7).contains(&n).then(|| (n - 100).to_string());
    }
    let name = value.strip_prefix("key.keyboard.")?;
    let (code, _) = pairs.iter().find(|(_, key)| *key == name)?;
    Some(code.to_string())
}

fn merge(preset: &GameSettingsPreset, target: &str, target_version: &str) -> (String, ApplyResult) {
    let source = parse(&preset.options);
    let current = parse(target);
    let data_version = current.get("version").and_then(|v| v.parse::<u32>().ok());
    let mut changes = BTreeMap::new();
    let mut report = ApplyResult::default();
    let version = release(target_version);
    for (key, value) in source {
        let Some(group) = category(&key) else {
            continue;
        };
        if !preset.categories.contains(&group) {
            continue;
        }
        let graphics_alias =
            ["fancyGraphics", "graphicsMode", "graphicsPreset"].contains(&key.as_str());
        let supported = version.is_some_and(|v| {
            v >= if graphics_alias {
                (1, 7, 2)
            } else {
                since(&key)
            }
        }) || preset.source_version == target_version;
        if !supported || !valid(&key, &value) {
            report.skipped.push(key);
            continue;
        }
        let mut dest_key = key.clone();
        let mut dest_value = value.clone();
        if key.starts_with("key_") {
            // A new/unversioned options file is passed through Minecraft's own
            // data fixer. Supplying GLFW strings with version 0 would make the
            // old LWJGL migration reinterpret them as invalid numeric bindings.
            if data_version.is_some_and(|v| v > 1343 && v < 1519) {
                report.skipped.push(key);
                continue;
            }
            let Some(converted) = binding(
                &value,
                version.map_or(value.parse::<i32>().is_err(), |v| {
                    v >= (1, 13, 0) && data_version.is_some_and(|n| n >= 1519)
                }),
            ) else {
                report.skipped.push(key);
                continue;
            };
            dest_value = converted;
        }
        if key == "lang" {
            dest_value = if version.is_some_and(|v| v < (1, 11, 0)) {
                let (lang, country) = value.split_once('_').unwrap();
                format!(
                    "{}_{}",
                    lang.to_ascii_lowercase(),
                    country.to_ascii_uppercase()
                )
            } else {
                value.to_ascii_lowercase()
            };
        }
        // Graphics presets replaced the old aggregate mode in 1.21.11. Keep
        // individual imported settings authoritative by using Custom there.
        if ["fancyGraphics", "graphicsMode", "graphicsPreset"].contains(&key.as_str()) {
            let mode = match value.as_str() {
                "false" | "0" | "fast" => "0",
                "2" | "fabulous" => "2",
                "custom" => "custom",
                _ => "1",
            };
            if mode == "custom" && version.is_some_and(|v| v < (1, 21, 11)) {
                report.skipped.push(key);
                continue;
            }
            match version {
                Some(v) if v >= (1, 21, 11) => {
                    dest_key = "graphicsPreset".into();
                    dest_value = if mode == "0" {
                        "fast"
                    } else if mode == "1" {
                        "fancy"
                    } else if mode == "2" {
                        "fabulous"
                    } else {
                        "custom"
                    }
                    .into();
                }
                Some(v) if v >= (1, 16, 0) => {
                    dest_key = "graphicsMode".into();
                    dest_value = if mode == "custom" { "1" } else { mode }.into();
                }
                Some(_) => {
                    dest_key = "fancyGraphics".into();
                    dest_value = (mode != "0").to_string();
                }
                None => {
                    if !current.contains_key(&key) && preset.source_version != target_version {
                        report.skipped.push(key);
                        continue;
                    }
                }
            }
        }
        if key == "ao" {
            if let Some(existing) = current.get("ao") {
                dest_value = if ["true", "false"].contains(&existing.as_str()) {
                    (value != "false" && value != "0").to_string()
                } else if value == "true" {
                    "2".into()
                } else if value == "false" {
                    "0".into()
                } else {
                    value.clone()
                };
            } else if preset.source_version != target_version {
                report.skipped.push(key);
                continue;
            }
        }
        if key == "renderClouds" {
            // New graphics formats have additional cloud levels. Cross-version
            // conversion is deliberately limited to the known classic formats.
            if version.is_some_and(|v| v >= (1, 21, 11)) && preset.source_version != target_version
            {
                report.skipped.push(key);
                continue;
            }
            if version.is_some_and(|v| v < (1, 8, 0)) {
                dest_value = (!["false", "0"].contains(&value.as_str())).to_string();
            } else if ["true", "false"].contains(&value.as_str()) {
                dest_value = if value == "true" { "fancy" } else { "false" }.into();
            }
        }
        // Never guess unknown snapshot formats, even when a key has the same name.
        if version.is_none() && preset.source_version != target_version {
            report.skipped.push(key);
            continue;
        }
        changes.insert(dest_key, dest_value);
    }
    if version.is_some_and(|v| v >= (1, 21, 11))
        && !parse(&preset.options).contains_key("graphicsPreset")
        && changes
            .keys()
            .any(|k| category(k) == Some(Category::Graphics) && k != "graphicsPreset")
    {
        changes.insert("graphicsPreset".into(), "custom".into());
    }
    let newline = if target.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut written = std::collections::HashSet::new();
    let mut lines = Vec::new();
    for line in target.lines() {
        let key = line
            .trim_start_matches('\u{feff}')
            .split_once(':')
            .map(|(k, _)| k);
        if let Some(key) = key.filter(|k| changes.contains_key(*k)) {
            if written.insert(key.to_owned()) {
                lines.push(format!("{key}:{}", changes[key]));
            }
        } else {
            lines.push(line.to_owned());
        }
    }
    for (key, value) in &changes {
        if written.insert(key.clone()) {
            lines.push(format!("{key}:{value}"));
        }
    }
    report.applied = changes.len();
    let output = if changes.is_empty() {
        target.to_owned()
    } else {
        format!("{}{}", lines.join(newline), newline)
    };
    (output, report)
}

async fn read_options(path: &Path) -> Result<String> {
    use tokio::io::AsyncReadExt;
    let file = tokio::fs::File::open(path)
        .await
        .context("В сборке нет options.txt. Запустите Minecraft, настройте игру и закройте её.")?;
    let mut bytes = Vec::new();
    file.take(MAX_OPTIONS + 1).read_to_end(&mut bytes).await?;
    if bytes.len() as u64 > MAX_OPTIONS {
        bail!("Файл настроек слишком большой")
    }
    String::from_utf8(bytes).context("Файл настроек должен быть в UTF-8")
}

impl Engine {
    pub async fn save_game_settings(
        &self,
        preset: GameSettingsPreset,
    ) -> Result<GameSettingsPreset> {
        uuid::Uuid::parse_str(&preset.id)?;
        crate::store::validate_name(&preset.name)?;
        crate::store::validate_version(&preset.source_version)?;
        if preset.options.len() as u64 > MAX_OPTIONS
            || preset.options.contains('\0')
            || preset.source_name.len() > 256
        {
            bail!("Неверный файл настроек")
        }
        if preset.categories.is_empty() {
            bail!("Выберите хотя бы одну категорию настроек")
        }
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        if let Some(old) = next
            .game_settings_profiles
            .iter_mut()
            .find(|p| p.id == preset.id)
        {
            *old = preset.clone();
        } else {
            if next.game_settings_profiles.len() >= 5 {
                bail!("Можно сохранить не больше пяти профилей настроек")
            }
            next.game_settings_profiles.push(preset.clone());
        }
        persist(&self.root, &next).await?;
        *db = next;
        Ok(preset)
    }

    pub async fn capture_game_settings(
        &self,
        id: &str,
        name: String,
        replace_id: Option<&str>,
    ) -> Result<GameSettingsPreset> {
        self.ensure_idle(id).await?;
        let profile = self.profile(id).await?;
        if profile.engine != Runtime::Java {
            bail!("Профили настроек поддерживают Minecraft Java")
        }
        let options = read_options(&self.instance(id)?.join("options.txt")).await?;
        if parse(&options).is_empty() {
            bail!("Файл options.txt пуст или повреждён")
        }
        let old = if let Some(id) = replace_id {
            Some(self.game_settings_preset(id).await?)
        } else {
            None
        };
        self.save_game_settings(GameSettingsPreset {
            id: old
                .as_ref()
                .map_or_else(|| uuid::Uuid::new_v4().to_string(), |p| p.id.clone()),
            name,
            source_version: profile.minecraft,
            source_name: profile.name,
            options,
            categories: old.map_or_else(
                || {
                    vec![
                        Category::Graphics,
                        Category::Fov,
                        Category::Controls,
                        Category::Mouse,
                        Category::Sound,
                        Category::Interface,
                    ]
                },
                |p| p.categories,
            ),
        })
        .await
    }

    pub async fn game_settings_preset(&self, id: &str) -> Result<GameSettingsPreset> {
        self.db
            .lock()
            .await
            .game_settings_profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .context("Профиль настроек не найден. Выберите другой профиль.")
    }

    pub async fn delete_game_settings(&self, id: &str) -> Result<()> {
        let mut db = self.db.lock().await;
        let mut next = db.clone();
        next.game_settings_profiles.retain(|p| p.id != id);
        persist(&self.root, &next).await?;
        *db = next;
        Ok(())
    }

    pub async fn apply_game_settings(
        &self,
        id: &str,
        preset: &GameSettingsPreset,
        task_id: Option<&str>,
    ) -> Result<ApplyResult> {
        self.ensure_content_change(id, &["settings"], task_id)
            .await?;
        let profile = self.profile(id).await?;
        if profile.engine != Runtime::Java {
            bail!("Профили настроек поддерживают Minecraft Java")
        }
        let directory = self.instance(id)?;
        let path = directory.join("options.txt");
        let original = if path.try_exists()? {
            Some(read_options(&path).await?)
        } else {
            None
        };
        let mut target_options = original.clone().unwrap_or_default();
        if original.is_none() {
            let jar = self
                .root
                .join("versions")
                .join(&profile.minecraft)
                .join(format!("{}.jar", profile.minecraft));
            let data_version =
                tokio::task::spawn_blocking(move || client_data_version(&jar)).await?;
            let data_version = data_version.or_else(|| {
                (preset.source_version == profile.minecraft)
                    .then(|| {
                        parse(&preset.options)
                            .get("version")
                            .and_then(|v| v.parse::<u32>().ok())
                    })
                    .flatten()
            });
            if let Some(data_version) = data_version {
                target_options = format!("version:{data_version}\n");
            }
        }
        let (merged, report) = merge(preset, &target_options, &profile.minecraft);
        if report.applied == 0 {
            return Ok(report);
        }
        tokio::fs::create_dir_all(&directory).await?;
        // Keep the first pre-Aurum file until explicitly restored; subsequent
        // applications must not replace the player's recovery point.
        if let Some(ref original) = original {
            use tokio::io::AsyncWriteExt;
            match tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(directory.join(BACKUP))
                .await
            {
                Ok(mut file) => {
                    file.write_all(original.as_bytes()).await?;
                    file.sync_all().await?;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
        }
        let pending = directory.join(format!(".options-{}.tmp", uuid::Uuid::new_v4()));
        let result: Result<()> = async {
            tokio::fs::write(&pending, merged).await?;
            self.ensure_content_change(id, &["settings"], task_id)
                .await?;
            tokio::fs::rename(&pending, &path).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(pending).await;
        }
        result?;
        Ok(report)
    }

    pub async fn restore_game_settings(&self, id: &str) -> Result<()> {
        self.ensure_idle(id).await?;
        self.profile(id).await?;
        let dir = self.instance(id)?;
        if !dir.join(BACKUP).try_exists()? {
            bail!("Нет резервной копии настроек для восстановления")
        }
        tokio::fs::rename(dir.join(BACKUP), dir.join("options.txt")).await?;
        Ok(())
    }
}

fn client_data_version(path: &Path) -> Option<u32> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let entry = zip.by_name("version.json").ok()?;
    if entry.size() > 64 * 1024 {
        return None;
    }
    let mut bytes = Vec::new();
    entry.take(64 * 1024 + 1).read_to_end(&mut bytes).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value["world_version"]
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
}

#[cfg(test)]
mod tests;
