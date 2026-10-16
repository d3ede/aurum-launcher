//! Independent, read-only adapters for Modrinth's on-disk metadata formats.
use crate::{model::*, store, Engine, Task};
use anyhow::{bail, Context, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthProfile {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub minecraft: String,
    pub loader: Loader,
    pub loader_version: Option<String>,
    pub icon: Option<String>,
    pub mods: usize,
    pub worlds: usize,
    pub issue: Option<String>,
    pub warnings: Vec<String>,
    #[serde(skip)]
    ram_mb: Option<u32>,
    #[serde(skip)]
    jvm_args: String,
    #[serde(skip)]
    data_root: PathBuf,
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthScan {
    pub profiles: Vec<ModrinthProfile>,
    pub directories: Vec<PathBuf>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportFailure {
    pub name: String,
    pub message: String,
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthImportResult {
    pub imported: Vec<Profile>,
    pub imported_sources: Vec<String>,
    pub failed: Vec<ImportFailure>,
    pub cancelled: bool,
}

pub fn default_directories() -> Vec<PathBuf> {
    let mut roots = vec![];
    if let Some(path) = std::env::var_os("THESEUS_CONFIG_DIR") {
        roots.push(path.into());
    }
    for base in [dirs::data_dir(), dirs::config_dir(), dirs::data_local_dir()]
        .into_iter()
        .flatten()
    {
        for name in ["ModrinthApp", "com.modrinth.theseus", "ModrinthAppBeta"] {
            roots.push(base.join(name));
        }
    }
    roots
}

fn read_json(path: &Path) -> Result<Value> {
    if std::fs::metadata(path)?.len() > 8_000_000 {
        bail!("Слишком большой файл параметров")
    }
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

pub(crate) fn open_database(root: &Path) -> Result<Connection> {
    let db = Connection::open_with_flags(root.join("app.db"), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .context("Не удалось прочитать базу Modrinth. Закройте Modrinth и повторите поиск")?;
    db.busy_timeout(Duration::from_secs(2))?;
    db.execute_batch("PRAGMA query_only = ON; BEGIN;")?;
    Ok(db)
}

fn has_table(db: &Connection, table: &str) -> bool {
    db.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

fn setting_string(db: &Connection, column: &str) -> Option<String> {
    // All callers pass constants, never user input.
    db.query_row(&format!("SELECT {column} FROM settings LIMIT 1"), [], |r| {
        r.get(0)
    })
    .ok()
    .flatten()
}

fn settings(db: &Connection) -> Value {
    let ram: Option<u32> = db
        .query_row("SELECT mc_memory_max FROM settings LIMIT 1", [], |r| {
            r.get(0)
        })
        .ok();
    let args = setting_string(db, "json(extra_launch_args)")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    json!({"memory":{"maximum":ram}, "extra_launch_args":args})
}

fn count_entries(path: &Path, directories: bool) -> usize {
    std::fs::read_dir(path)
        .map(|items| {
            items
                .flatten()
                .filter(|e| {
                    if directories {
                        e.path().is_dir()
                    } else {
                        let name = e.file_name().to_string_lossy().into_owned();
                        name.ends_with(".jar") || name.ends_with(".jar.disabled")
                    }
                })
                .count()
        })
        .unwrap_or(0)
}

#[cfg(windows)]
fn world_is_open(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::read_dir(path.join("saves")).is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            let lock = entry.path().join("session.lock");
            lock.is_file()
                && std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .open(lock)
                    .is_err()
        })
    })
}

#[cfg(not(windows))]
fn world_is_open(_path: &Path) -> bool {
    false
}

fn candidate(root: &Path, metadata: &Value, defaults: &Value) -> Result<ModrinthProfile> {
    let folder = metadata["path"].as_str().context("Нет пути сборки")?;
    let profiles = root.join("profiles");
    let path = crate::safe_join(&profiles, &folder.replace('\\', "/"))?;
    // Canonical paths deduplicate aliases and are re-discovered before importing.
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    let mut issue = None;
    if !path.is_dir() {
        issue = Some("Папка сборки не найдена".into());
    }
    if let Ok(base) = std::fs::canonicalize(&profiles) {
        if !path.starts_with(&base) {
            bail!("Папка сборки выходит за каталог профилей")
        }
    }
    let mc = metadata["game_version"].as_str().unwrap_or("").to_string();
    if store::validate_version(&mc).is_err() {
        issue = Some("Не удалось определить версию Minecraft".into());
    }
    let loader_name = metadata["loader"]
        .as_str()
        .unwrap_or("vanilla")
        .to_lowercase();
    let loader = match loader_name.as_str() {
        "vanilla" => Loader::Vanilla,
        "fabric" => Loader::Fabric,
        "forge" => Loader::Forge,
        "neoforge" => Loader::Neoforge,
        "quilt" => Loader::Quilt,
        _ => {
            issue = Some(format!("Загрузчик {loader_name} пока не поддерживается"));
            Loader::Vanilla
        }
    };
    let lv = &metadata["loader_version"];
    let mut loader_version = lv.as_str().or_else(|| lv["id"].as_str()).map(String::from);
    if loader == Loader::Forge {
        loader_version =
            loader_version.map(|v| v.strip_prefix(&format!("{mc}-")).unwrap_or(&v).to_string());
    }
    if loader != Loader::Vanilla
        && loader_version
            .as_deref()
            .is_none_or(|v| store::validate_version(v).is_err())
    {
        issue = Some("Не удалось определить версию загрузчика".into());
    }
    if loader == Loader::Vanilla {
        loader_version = None;
    }
    if metadata["running"].as_bool() == Some(true) || world_is_open(&path) {
        issue = Some("Закройте Minecraft этой сборки и обновите список".into());
    }
    let name = metadata["name"]
        .as_str()
        .unwrap_or(folder)
        .trim()
        .to_string();
    if store::validate_name(&name).is_err() {
        issue = Some("Некорректное название сборки".into());
    }
    let mut warnings = vec![];
    let overrides = &metadata["overrides"];
    let ram_mb = overrides["memory"]["maximum"]
        .as_u64()
        .or_else(|| defaults["memory"]["maximum"].as_u64())
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| (512..=65536).contains(n));
    let args = overrides["extra_launch_args"]
        .as_array()
        .or_else(|| defaults["extra_launch_args"].as_array());
    let jvm_args = args
        .map(|a| {
            let tokens: Vec<_> = a.iter().filter_map(Value::as_str).collect();
            shlex::try_join(tokens).unwrap_or_default()
        })
        .unwrap_or_default();
    let jvm_args = if store::validate_jvm(&jvm_args).is_ok() {
        jvm_args
    } else {
        warnings
            .push("Дополнительные параметры Java несовместимы с Aurum и будут пропущены".into());
        String::new()
    };
    if overrides["hooks"].as_object().is_some_and(|h| {
        h.values()
            .any(|v| v.as_str().is_some_and(|s| !s.is_empty()))
    }) {
        warnings.push("Команды до и после запуска не переносятся".into());
    }
    let icon = metadata["icon"].as_str().and_then(|s| {
        let icon = PathBuf::from(s);
        let icon = if icon.is_absolute() {
            icon
        } else {
            root.join(icon)
        };
        let icon = std::fs::canonicalize(icon).ok()?;
        if !icon.starts_with(root) {
            return None;
        }
        store::prepare_profile_icon(&icon).ok()
    });
    Ok(ModrinthProfile {
        id: path.to_string_lossy().into_owned(),
        mods: count_entries(&path.join("mods"), false),
        worlds: count_entries(&path.join("saves"), true),
        path,
        name,
        minecraft: mc,
        loader,
        loader_version,
        icon,
        issue,
        warnings,
        ram_mb,
        jvm_args,
        data_root: root.into(),
    })
}

fn database_profiles(
    db: &Connection,
    root: &Path,
    warnings: &mut Vec<String>,
) -> Result<Vec<ModrinthProfile>> {
    let defaults = settings(db);
    let modern = has_table(db, "instances");
    let sql = if modern {
        "SELECT i.path,i.name,c.game_version,c.loader,c.loader_version,i.icon_path,
         (SELECT json(o.overrides) FROM instance_launch_overrides o WHERE o.instance_id=i.id),
         EXISTS(SELECT 1 FROM processes p WHERE p.instance_id=i.id)
         FROM instances i LEFT JOIN instance_content_sets c ON c.id=i.applied_content_set_id AND c.instance_id=i.id"
    } else {
        "SELECT p.path,p.name,p.game_version,p.mod_loader,p.mod_loader_version,p.icon_path,
         json_object('memory',json_object('maximum',p.override_mc_memory_max),'extra_launch_args',json(p.override_extra_launch_args)),
         EXISTS(SELECT 1 FROM processes x WHERE x.profile_path=p.path) FROM profiles p"
    };
    let mut query = db
        .prepare(sql)
        .context("Неизвестный формат базы профилей Modrinth")?;
    let rows = query.query_map([], |r| {
        let overrides: Option<String> = r.get(6)?;
        Ok(json!({"path":r.get::<_,String>(0)?, "name":r.get::<_,String>(1)?,
            "game_version":r.get::<_,Option<String>>(2)?, "loader":r.get::<_,Option<String>>(3)?,
            "loader_version":r.get::<_,Option<String>>(4)?, "icon":r.get::<_,Option<String>>(5)?,
            "overrides":overrides.and_then(|s|serde_json::from_str::<Value>(&s).ok()), "running":r.get::<_,bool>(7)?}))
    })?;
    let mut profiles = vec![];
    for row in rows {
        match row
            .map_err(anyhow::Error::from)
            .and_then(|value| candidate(root, &value, &defaults))
        {
            Ok(profile) => profiles.push(profile),
            Err(e) => warnings.push(format!("{}: {e:#}", root.display())),
        }
    }
    Ok(profiles)
}

/// Roots can be default settings folders, a custom app directory, or its profiles folder.
pub fn scan(roots: &[PathBuf]) -> ModrinthScan {
    let mut report = ModrinthScan::default();
    let mut seen = HashSet::new();
    let mut seen_profiles = HashSet::new();
    let mut pending = roots.to_vec();
    while let Some(input) = pending.pop() {
        let input = if input.file_name().is_some_and(|n| n == "profiles") {
            input.parent().unwrap_or(&input).to_path_buf()
        } else {
            input
        };
        let Ok(root) = std::fs::canonicalize(input) else {
            continue;
        };
        if !seen.insert(root.clone()) {
            continue;
        }
        report.directories.push(root.clone());
        let legacy_settings = read_json(&root.join("settings.json")).unwrap_or(Value::Null);
        for key in ["loaded_config_dir", "custom_dir"] {
            if let Some(s) = legacy_settings[key].as_str() {
                pending.push(PathBuf::from(s));
            }
        }
        if root.join("app.db").is_file() {
            match open_database(&root) {
                Ok(db) => {
                    let data_root = setting_string(&db, "custom_dir")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| root.clone());
                    let data_root = std::fs::canonicalize(&data_root).unwrap_or(data_root);
                    pending.push(data_root.clone());
                    match database_profiles(&db, &data_root, &mut report.warnings) {
                        Ok(profiles) => {
                            for p in profiles {
                                if seen_profiles.insert(p.id.clone()) {
                                    report.profiles.push(p);
                                }
                            }
                        }
                        Err(e) => report.warnings.push(format!("{}: {e:#}", root.display())),
                    }
                }
                Err(e) => report.warnings.push(format!("{}: {e:#}", root.display())),
            }
        }
        if let Ok(entries) = std::fs::read_dir(root.join("profiles")) {
            for entry in entries.flatten().filter(|e| e.path().is_dir()) {
                let file = entry.path().join("profile.json");
                if !file.exists() {
                    continue;
                }
                let parsed = (|| -> Result<_> {
                    let value = read_json(&file)?;
                    let mut metadata = value
                        .get("metadata")
                        .filter(|v| v.is_object())
                        .cloned()
                        .context("Нет параметров профиля Modrinth")?;
                    metadata["path"] = json!(entry.file_name().to_string_lossy());
                    metadata["overrides"] = json!({"memory":value["memory"], "extra_launch_args":value["java"]["extra_arguments"], "hooks":value["hooks"]});
                    candidate(
                        &root,
                        &metadata,
                        &json!({"memory":legacy_settings["memory"], "extra_launch_args":legacy_settings["custom_java_args"]}),
                    )
                })();
                match parsed {
                    Ok(p) => {
                        if seen_profiles.insert(p.id.clone()) {
                            report.profiles.push(p);
                        }
                    }
                    Err(e) => report.warnings.push(format!("{}: {e:#}", file.display())),
                }
            }
        }
    }
    report.profiles.sort_by_key(|a| a.name.to_lowercase());
    report
}

fn skip_file(relative: &Path) -> bool {
    if relative.file_name().is_some_and(|n| n == "session.lock") {
        return true;
    }
    let Some(first) = relative.components().next() else {
        return false;
    };
    matches!(
        first.as_os_str().to_str(),
        Some("profile.json" | ".modrinth" | ".cache" | "logs" | "crash-reports" | ".lock")
    )
}

impl Engine {
    pub async fn import_modrinth(
        &self,
        roots: Vec<PathBuf>,
        selected: Vec<String>,
        task: &Task,
    ) -> Result<ModrinthImportResult> {
        if selected.is_empty() || selected.len() > 100 {
            bail!("Выберите от 1 до 100 сборок")
        }
        let report = tokio::task::spawn_blocking(move || scan(&roots)).await?;
        let mut result = ModrinthImportResult::default();
        let mut seen = HashSet::new();
        for (index, key) in selected.iter().enumerate() {
            if !seen.insert(key) {
                continue;
            }
            if task.check().is_err() {
                result.cancelled = true;
                break;
            }
            let Some(source) = report.profiles.iter().find(|p| &p.id == key) else {
                result.failed.push(ImportFailure {
                    name: "Сборка".into(),
                    message: "Профиль больше не найден. Обновите список".into(),
                });
                continue;
            };
            task.progress(
                "import",
                format!(
                    "Сборка {} из {} · {}",
                    index + 1,
                    selected.len(),
                    source.name
                ),
                0,
                0,
            );
            match self.copy_modrinth_profile(source, task).await {
                Ok(p) => {
                    result.imported.push(p);
                    result.imported_sources.push(key.clone());
                }
                Err(e) => {
                    if task.check().is_err() {
                        result.cancelled = true;
                        break;
                    }
                    result.failed.push(ImportFailure {
                        name: source.name.clone(),
                        message: format!("{e:#}"),
                    });
                }
            }
        }
        Ok(result)
    }

    async fn copy_modrinth_profile(
        &self,
        source: &ModrinthProfile,
        task: &Task,
    ) -> Result<Profile> {
        if let Some(issue) = &source.issue {
            bail!("{issue}")
        }
        let own_root = std::fs::canonicalize(&self.root)?;
        if source.path.starts_with(&own_root) || own_root.starts_with(&source.path) {
            bail!("Папка Modrinth должна находиться отдельно от данных Aurum")
        }
        let id = uuid::Uuid::new_v4().to_string();
        let stage = self.root.join("staging").join(format!("modrinth-{id}"));
        let result: Result<Profile> = async {
            tokio::fs::create_dir_all(&stage).await?;
            let src = source.path.clone();
            let root_before = std::fs::metadata(&src)?;
            let cancel = task.cancel.clone();
            let store_root = source.data_root.join("store/content");
            let store_root = std::fs::canonicalize(store_root).ok();
            let plan = tokio::task::spawn_blocking(move || -> Result<Vec<_>> {
                let mut files = vec![];
                for entry in walkdir::WalkDir::new(&src).follow_links(false).into_iter().filter_entry(|e| {
                    e.path().strip_prefix(&src).map(|r| !skip_file(r)).unwrap_or(false)
                }) {
                    if cancel.load(std::sync::atomic::Ordering::Relaxed) { bail!("Операция отменена") }
                    let entry = entry?;
                    let relative = entry.path().strip_prefix(&src)?.to_path_buf();
                    if relative.as_os_str().is_empty() { continue; }
                    let resolved = std::fs::canonicalize(entry.path())?;
                    if entry.file_type().is_symlink() {
                        // Modrinth may link immutable mod files to its content store.
                        if !resolved.is_file() || !store_root.as_ref().is_some_and(|s| resolved.starts_with(s)) {
                            bail!("Не удалось перенести ссылку {}. Импортируйте обычную папку сборки", relative.display())
                        }
                    } else if !resolved.starts_with(&src) { bail!("Файл выходит за папку сборки") }
                    let metadata = std::fs::metadata(&resolved)?;
                    if !metadata.is_dir() && !metadata.is_file() { bail!("Неподдерживаемый файл") }
                    files.push((relative, resolved, metadata));
                }
                Ok(files)
            }).await??;
            let copy_source = source.clone();
            let copy_stage = stage.clone();
            let copy_task = Task { id: task.id.clone(), profile_id: task.profile_id.clone(),
                cancel: task.cancel.clone(), emit: task.emit.clone() };
            tokio::task::spawn_blocking(move || -> Result<()> {
                // Local file I/O stays on one worker instead of scheduling every read/write.
                let total: u64 = plan.iter().filter(|(_,_,m)| m.is_file()).map(|(_,_,m)| m.len()).sum();
                let mut done = 0;
                let mut buffer = vec![0u8; 1024 * 1024];
                let mut last_progress = None;
                copy_task.progress("import", format!("Переносим сборку · {}", copy_source.name), 0, total);
                for (relative, file, before) in &plan {
                    copy_task.check()?;
                    let target = copy_stage.join(relative);
                    // WalkDir lists parent directories before their files.
                    if before.is_dir() { std::fs::create_dir_all(&target)?; continue; }
                    let mut input = std::fs::File::open(file).with_context(|| format!("Не удалось прочитать {}. Закройте Minecraft и повторите импорт", relative.display()))?;
                    let mut output = std::fs::File::create(target)?;
                    loop {
                        copy_task.check()?;
                        let n = input.read(&mut buffer)?;
                        if n == 0 { break; }
                        output.write_all(&buffer[..n])?;
                        done += n as u64;
                        let now = Instant::now();
                        if last_progress.is_none_or(|last| now.duration_since(last) >= Duration::from_millis(150)) {
                            copy_task.progress("import", format!("{} · {}", copy_source.name, relative.display()), done, total);
                            last_progress = Some(now);
                        }
                    }
                    // Normal copies use the OS write cache; originals remain available for recovery.
                    drop(output);
                    let after = std::fs::metadata(file)?;
                    if before.len() != after.len() || before.modified()? != after.modified()? {
                        bail!("Файлы сборки изменились во время импорта. Закройте Minecraft и повторите импорт")
                    }
                }
                copy_task.progress("import", format!("Проверяем перенесённые файлы · {}", copy_source.name), done, total);
                // Detect additions/removals and writes to earlier files before publishing.
                if root_before.modified()? != std::fs::metadata(&copy_source.path)?.modified()? {
                    bail!("Файлы сборки изменились во время импорта. Закройте Minecraft и повторите импорт")
                }
                for (_, file, before) in &plan {
                    copy_task.check()?;
                    let after = std::fs::metadata(file)?;
                    if before.len() != after.len() || before.modified()? != after.modified()? {
                        bail!("Файлы сборки изменились во время импорта. Закройте Minecraft и повторите импорт")
                    }
                }
                Ok(())
            }).await??;
            task.check()?;
            let p = Profile { id: id.clone(), name: source.name.clone(), minecraft: source.minecraft.clone(),
                loader: source.loader.clone(), loader_version: source.loader_version.clone(), installed_version: None,
                ram_mb: source.ram_mb, jvm_args: source.jvm_args.clone(), last_played: None, cover: 1,
                icon: source.icon.clone(), icon_style: None, content: vec![] };
            self.publish_profile(p.clone(), Some(&stage)).await?;
            Ok(p)
        }.await;
        // Only this newly generated staging directory is removed; originals are never changed.
        if stage.exists() {
            let _ = tokio::fs::remove_dir_all(&stage).await;
        }
        result
    }
}
