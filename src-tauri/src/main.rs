#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod hosting;
mod screenshots;
#[cfg(windows)]
mod social;
#[cfg(windows)]
mod social_runtime;

mod server_shortcuts;
mod maintenance;
mod uninstall;
use auren_core::Engine;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

fn param<T: serde::de::DeserializeOwned>(p: &Value, k: &str) -> Result<T, String> {
    serde_json::from_value(p[k].clone()).map_err(|e| format!("{k}: {e}"))
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
struct BrowserSignIn(std::sync::Mutex<std::collections::HashMap<String, String>>);
struct Relocation(std::sync::atomic::AtomicBool);
#[tauri::command]
async fn rpc(
    action: String,
    payload: Value,
    state: tauri::State<'_, Engine>,
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
) -> Result<Value, String> {
    // Remote Microsoft content cannot invoke launcher commands.
    if webview.label() != "main" {
        return Err("Команда доступна только в главном окне Aurum".into());
    }
    let e = state.inner().clone();
    if app
        .state::<Relocation>()
        .0
        .load(std::sync::atomic::Ordering::Relaxed)
        && !["snapshot", "restart", "openFolder", "logs"].contains(&action.as_str())
    {
        return Err(
            "Данные скопированы. Перезапустите Aurum, чтобы использовать новую папку".into(),
        );
    }
    if action.starts_with("screenshots.") {
        return screenshots::rpc(&action, &payload, &e, &app).await;
    }
    if action.starts_with("hosting") {
        return hosting::rpc(&action, &payload, &e, &app).await;
    }
    if action.starts_with("social.") {
        #[cfg(windows)]
        return social::rpc(&action, &payload, &e, &app).await;
        #[cfg(not(windows))]
        return Err("Aurum Social currently requires Windows AppContainer".into());
    }
    match action.as_str() {
        "uninstall" => {
            let _guard = e
                .busy
                .try_lock()
                .map_err(|_| "Дождитесь завершения операции".to_string())?;
            if !e.running.lock().await.is_empty() || !e.hosting_running().is_empty() {
                return Err("Сначала остановите игру и локальные серверы".into());
            }
            let executable = std::env::current_exe().map_err(err)?;
            let uninstaller = executable
                .parent()
                .ok_or("Нет папки программы")?
                .join("uninstall.exe");
            if !uninstaller.is_file() {
                return Err("Деинсталлятор доступен после установки Aurum через установщик".into());
            }
            std::process::Command::new(uninstaller)
                .spawn()
                .map_err(err)?;
            Ok(Value::Null)
        }
        "restart" => {
            if !e.hosting_running().is_empty() {
                return Err("Сначала остановите локальные серверы".into());
            }
            if !e.running.lock().await.is_empty() {
                return Err("Сначала остановите игру".into());
            }
            #[cfg(windows)]
            e.social.shutdown().map_err(err)?;
            app.restart()
        }
        "changeDataDirectory" => {
            #[cfg(windows)]
            e.social.shutdown().map_err(err)?;
            if !e.hosting_running().is_empty() {
                return Err("Сначала остановите локальные серверы".into());
            }
            let _guard = e
                .busy
                .try_lock()
                .map_err(|_| "Дождитесь завершения операции".to_string())?;
            if !e.running.lock().await.is_empty() {
                return Err("Сначала остановите игру".into());
            }
            let handle = app.clone();
            let path = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Выберите пустую папку для данных Aurum")
                    .blocking_pick_folder()
            })
            .await
            .map_err(err)?;
            let Some(path) = path else {
                return Ok(Value::Null);
            };
            let path = path.into_path().map_err(err)?;
            let task = e
                .task(param(&payload, "operationId")?, None)
                .await
                .map_err(err)?;
            let result: Result<(), anyhow::Error> = async {
                e.copy_data(&path, &task).await?;
                let config = app.path().app_config_dir()?;
                std::fs::create_dir_all(&config)?;
                let profile = auren_core::layout::application(&e.root).parent().unwrap().join("webview");
                if profile.is_dir() {
                    std::fs::write(config.join("webview-source.json"), serde_json::to_vec(&profile)?)?;
                }
                let temp = config.join("data-location.json.tmp");
                std::fs::write(&temp, serde_json::to_vec(&path)?)?;
                std::fs::rename(temp, config.join("data-location.json"))?;
                uninstall::register(&path, &app.config().identifier)?;
                app.state::<Relocation>()
                    .0
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                Ok(())
            }
            .await;
            e.finish(&task, &result).await;
            result.map_err(err)?;
            Ok(json!(path.to_string_lossy()))
        }
        "storageRemoveVersion" => Ok(json!(e.remove_unused_installation(&param::<String>(&payload, "id")?).await.map_err(err)?)),
        "storageSnapshot" => Ok(json!(e.storage_snapshot().await.map_err(err)?)),
        "storageClean" => Ok(json!(e.clean_storage(&param::<String>(&payload, "category")?).await.map_err(err)?)),
        "storageTrash" => Ok(json!(e.storage_trash(&param::<Vec<String>>(&payload, "ids")?, payload["restore"].as_bool().unwrap_or(false)).await.map_err(err)?)),
        "optimizeJava" => {
            let _guard = e.busy.try_lock().map_err(|_| "Дождитесь завершения операции".to_string())?;
            e.ensure_idle("").await.map_err(err)?;
            if !e.hosting_running().is_empty() || !e.running.lock().await.is_empty() { return Err("Сначала остановите игры и серверы".into()); }
            let task = e.task(param(&payload, "operationId")?, None).await.map_err(err)?;
            let result = e.optimize_java(&task).await;
            let finished = result.as_ref().map(|_| ()).map_err(|error| anyhow::anyhow!("{error:#}"));
            e.finish(&task, &finished).await;
            Ok(json!(result.map_err(err)?))
        }
        "snapshot" => Ok(json!(e.snapshot().await)),
        "recentServers" => Ok(json!(e.recent_servers().await.map_err(err)?)),
        "serverStatus" => Ok(json!(e
            .server_status(
                &param::<String>(&payload, "id")?,
                payload["force"].as_bool().unwrap_or(false)
            )
            .await
            .map_err(err)?)),
        "removeRecentServer" => {
            e.remove_recent_server(&param::<String>(&payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "createServerShortcut" => Ok(json!(
            server_shortcuts::create(&app, &e, &param::<String>(&payload, "id")?).await?
        )),
        "takeServerShortcut" => Ok(json!(app.state::<server_shortcuts::Shortcuts>().take()?)),
        "scanModrinth" => {
            let extra: Vec<std::path::PathBuf> = param(&payload, "directories")?;
            let mut roots = auren_core::modrinth_import::default_directories();
            roots.extend(extra);
            Ok(json!(tauri::async_runtime::spawn_blocking(move || {
                auren_core::modrinth_import::scan(&roots)
            })
            .await
            .map_err(err)?))
        }
        "chooseModrinthDirectory" => {
            let handle = app.clone();
            let path = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Выберите папку данных Modrinth или папку profiles")
                    .blocking_pick_folder()
            })
            .await
            .map_err(err)?;
            Ok(json!(path
                .map(|p| p.into_path().map(|p| p.to_string_lossy().into_owned()))
                .transpose()
                .map_err(err)?))
        }
        "catalogCategories" => e
            .catalog_categories(
                &param::<String>(&payload, "source")?,
                &param::<String>(&payload, "kind")?,
            )
            .await
            .map_err(err),
        "horizonModStatus" => Ok(json!(e
            .horizon_mod_status(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "horizonBuildLog" => Ok(json!(e
            .horizon_build_log(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "versions" => e.minecraft_versions().await.map_err(err),
        "loaders" => Ok(json!(e
            .loader_versions(
                &param::<String>(&payload, "minecraft")?,
                param(&payload, "loader")?
            )
            .await
            .map_err(err)?)),
        "chooseProfileIcon" => {
            let path = choose_file(&app, "Значок сборки", &["png", "jpg", "jpeg", "webp"]).await?;
            path.map(|path| auren_core::store::prepare_profile_icon(&path).map_err(err))
                .transpose()
                .map(|icon| json!(icon))
        }
        "createProfile" => {
            let icon_style = serde_json::from_value::<Option<auren_core::model::ProfileIconStyle>>(
                payload.get("iconStyle").cloned().unwrap_or(Value::Null),
            )
            .map_err(err)?
            .as_ref()
            .map(auren_core::store::validate_profile_icon_style)
            .transpose()
            .map_err(err)?;
            let icon = payload["icon"]
                .as_str()
                .map(auren_core::store::validate_profile_icon)
                .transpose()
                .map_err(err)?;
            let mut profile = e
                .create_profile_with_engine(
                    param(&payload, "name")?,
                    param(&payload, "minecraft")?,
                    param(&payload, "loader")?,
                    payload["loaderVersion"].as_str().map(String::from),
                    payload["cover"].as_u64().unwrap_or(0) as u8,
                    serde_json::from_value(payload.get("engine").cloned().unwrap_or(json!("java")))
                        .map_err(err)?,
                )
                .await
                .map_err(err)?;
            if icon.is_some() || icon_style.is_some() {
                profile.icon = icon;
                profile.icon_style = icon_style;
                e.update_profile(profile.clone()).await.map_err(err)?;
            }
            Ok(json!(profile))
        }
        "updateProfile" => {
            e.update_profile(param(&payload, "profile")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "deleteProfile" => {
            e.delete_profile(&param::<String>(&payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "saveSettings" => {
            e.save_settings(param(&payload, "settings")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "addOffline" => Ok(json!(e
            .add_offline(param(&payload, "name")?)
            .await
            .map_err(err)?)),
        "selectAccount" => {
            e.select_account(param(&payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "deleteAccount" => {
            e.delete_account(param(&payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "skinLibrary" => Ok(json!(e.skin_library().await.map_err(err)?)),
        "browseSkins" => Ok(json!(e
            .browse_skins(
                &param::<String>(&payload, "query")?,
                &param::<String>(&payload, "mode")?,
                payload["after"].as_str(),
            )
            .await
            .map_err(err)?)),
        "skinBrowserTexture" => Ok(json!(e
            .skin_browser_texture(&param::<String>(&payload, "hash")?)
            .await
            .map_err(err)?)),
        "skinBrowserSkin" => Ok(json!(e
            .skin_browser_skin(
                &param::<String>(&payload, "query")?,
                &param::<String>(&payload, "source")?,
            )
            .await
            .map_err(err)?)),
        "importModrinthSkins" => {
            let _guard = e
                .busy
                .try_lock()
                .map_err(|_| "Дождитесь завершения текущей операции".to_string())?;
            let extra: Vec<std::path::PathBuf> = param(&payload, "directories")?;
            let roots = if extra.is_empty() {
                auren_core::modrinth_import::default_directories()
            } else {
                extra
            };
            Ok(json!(e.import_modrinth_skins(roots).await.map_err(err)?))
        }
        "accountSkinPreview" => Ok(json!(e
            .account_skin_preview(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "accountAppearance" => Ok(json!(e
            .account_appearance(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "accountAvatar" => Ok(json!(e
            .account_avatar(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "defaultSkinTexture" => Ok(json!(auren_core::skins::default_texture(
            &param::<String>(&payload, "id")?,
            &param::<String>(&payload, "model")?
        )
        .map_err(err)?)),
        "chooseSkinTexture" => {
            let path = choose_file(&app, "PNG texture", &["png"]).await?;
            let Some(path) = path else {
                return Ok(Value::Null);
            };
            if std::fs::metadata(&path).map_err(err)?.len() > 1_000_000 {
                return Err("PNG должен быть меньше 1 МБ".into());
            }
            let bytes = std::fs::read(&path).map_err(err)?;
            let normalized = auren_core::skins::validate_texture(
                &bytes,
                payload["cape"].as_bool().unwrap_or(false),
            )
            .map_err(err)?;
            Ok(
                json!({"name":path.file_stem().unwrap_or_default().to_string_lossy(),"bytes":normalized}),
            )
        }
        "saveLibrarySkin" | "saveLibraryCape" | "deleteLibraryItem" | "applyLibrarySkin" => {
            let _guard = e
                .busy
                .try_lock()
                .map_err(|_| "Дождитесь завершения текущей операции".to_string())?;
            match action.as_str() {
                "saveLibrarySkin" => Ok(json!(e
                    .save_library_skin(
                        payload["id"].as_str().map(String::from),
                        param(&payload, "name")?,
                        param(&payload, "model")?,
                        param(&payload, "bytes")?,
                        payload["capeId"].as_str().map(String::from)
                    )
                    .await
                    .map_err(err)?)),
                "saveLibraryCape" => Ok(json!(e
                    .save_library_cape(param(&payload, "name")?, param(&payload, "bytes")?)
                    .await
                    .map_err(err)?)),
                "deleteLibraryItem" => {
                    e.delete_library_item(
                        &param::<String>(&payload, "id")?,
                        payload["cape"].as_bool().unwrap_or(false),
                    )
                    .await
                    .map_err(err)?;
                    Ok(Value::Null)
                }
                "applyLibrarySkin" => {
                    e.apply_library_skin(
                        &param::<String>(&payload, "accountId")?,
                        &param::<String>(&payload, "skinId")?,
                        &param::<String>(&payload, "model")?,
                        payload["capeId"].as_str().map(String::from),
                    )
                    .await
                    .map_err(err)?;
                    Ok(Value::Null)
                }
                _ => unreachable!(),
            }
        }
        "skin" => Ok(json!(e
            .skin(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "setSkin" => {
            let path = choose_file(&app, "PNG skin", &["png"]).await?;
            let Some(path) = path else {
                return Ok(Value::Null);
            };
            e.set_skin(
                &param::<String>(&payload, "id")?,
                &path,
                &param::<String>(&payload, "model")?,
            )
            .await
            .map_err(err)?;
            Ok(json!(true))
        }
        "chooseJava" => {
            let path = choose_file(
                &app,
                "Java executable",
                if cfg!(windows) { &["exe"] } else { &[] },
            )
            .await?;
            Ok(json!(path.map(|p| p.to_string_lossy().into_owned())))
        }
        "checkJava" => Ok(json!(auren_core::minecraft::java_version(
            std::path::Path::new(&param::<String>(&payload, "path")?)
        )
        .await
        .map_err(err)?)),
        "search" => Ok(json!(e
            .search(param(&payload, "query")?)
            .await
            .map_err(err)?)),
        "choosePackFile" => Ok(json!(
            choose_file(&app, "Downloaded modpack file", &["jar", "zip", "litemod"]).await?
        )),
        "importPackManualFile" => {
            let id = param::<String>(&payload, "id")?;
            let file_path = param::<String>(&payload, "path")?;
            if let Some(path) =
                choose_file(&app, "Downloaded modpack file", &["jar", "zip", "litemod"]).await?
            {
                e.import_pack_manual_file_with_cleanup(
                    &id,
                    &file_path,
                    &path,
                    payload["removeImported"].as_bool().unwrap_or(true),
                )
                .await
                .map_err(err)?;
                return Ok(json!(true));
            }
            Ok(json!(false))
        }
        "scanPackDownloads" => Ok(json!(e
            .scan_pack_downloads(
                &param::<String>(&payload, "id")?,
                &app.path().download_dir().map_err(err)?,
                payload["removeImported"].as_bool().unwrap_or(true),
            )
            .await
            .map_err(err)?)),
        "packRequirements" => Ok(json!(e
            .pack_requirements(
                &param::<String>(&payload, "source")?,
                &param::<String>(&payload, "projectId")?,
                &param::<String>(&payload, "versionId")?,
                &serde_json::from_value(
                    payload.get("options").cloned().unwrap_or_else(|| json!({}))
                )
                .map_err(err)?,
            )
            .await
            .map_err(err)?)),
        "project" => Ok(json!(e
            .project_detail(
                &param::<String>(&payload, "source")?,
                &param::<String>(&payload, "id")?,
                payload["minecraft"].as_str(),
                payload["loader"].as_str()
            )
            .await
            .map_err(err)?)),
        "content" => Ok(json!(e
            .list_content(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "inspectContent" => Ok(json!(e
            .inspect_content(&param::<String>(&payload, "id")?)
            .await
            .map_err(err)?)),
        "manageContent" => {
            e.manage_content(
                &param::<String>(&payload, "id")?,
                &param::<String>(&payload, "contentId")?,
                &param::<String>(&payload, "action")?,
            )
            .await
            .map_err(err)?;
            Ok(Value::Null)
        }
        "importContent" => {
            let kind = param::<String>(&payload, "kind")?;
            let path = choose_file(
                &app,
                "Content",
                if kind == "mod" { &["jar"] } else { &["zip"] },
            )
            .await?;
            if let Some(path) = path {
                e.import_content(&param::<String>(&payload, "id")?, &kind, &path)
                    .await
                    .map_err(err)?;
            }
            Ok(Value::Null)
        }
        "launch" => {
            let id = param::<String>(&payload, "id")?;
            if payload["skipHorizonMods"].as_bool().unwrap_or(false) {
                e.launch_without_horizon_mods(&id, payload["server"].as_str())
                    .await
                    .map_err(err)?;
            } else if let Some(address) = payload["server"].as_str() {
                e.launch_to_server(&id, address).await.map_err(err)?;
            } else {
                e.launch(&id).await.map_err(err)?;
            }
            Ok(Value::Null)
        }
        "stop" => {
            e.stop(&param::<String>(&payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "cancel" => {
            e.cancel(&param::<String>(&payload, "operationId")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "reopenMicrosoft" => {
            let id = param::<String>(&payload, "operationId")?;
            let url = app.state::<BrowserSignIn>().0.lock().map_err(err)?.get(&id).cloned().ok_or("Вход уже завершён")?;
            app.opener().open_url(url, None::<&str>).map_err(err)?;
            Ok(Value::Null)
        }
        "openFolder" => {
            let path = if let Some(id) = payload["id"].as_str() {
                e.profile_directory(id).await.map_err(err)?
            } else {
                e.root.clone()
            };
            // Explorer expects a native absolute path; avoid verbatim prefixes and mixed separators.
            let path = dunce::canonicalize(path).map_err(err)?;
            app.opener()
                .open_path(path.to_string_lossy().as_ref(), None::<&str>)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "openUrl" => {
            let url = param::<String>(&payload, "url")?;
            if !url.starts_with("https://") || url.contains(['\n', '\r']) {
                return Err("Разрешены только HTTPS-ссылки".into());
            }
            app.opener().open_url(url, None::<&str>).map_err(err)?;
            Ok(Value::Null)
        }
        "logs" => {
            let id = param::<String>(&payload, "id")?;
            e.profile(&id).await.map_err(err)?;
            let path = e.instance(&id).map_err(err)?.join("aurum-latest.log");
            if !path.exists() {
                return Ok(json!("Журнал появится после запуска игры"));
            }
            let bytes = tauri::async_runtime::spawn_blocking(move || {
                use std::io::{Read, Seek, SeekFrom};
                let mut f = std::fs::File::open(path)?;
                let len = f.metadata()?.len();
                f.seek(SeekFrom::Start(len.saturating_sub(262144)))?;
                let mut bytes = vec![];
                f.read_to_end(&mut bytes)?;
                Ok::<_, std::io::Error>(bytes)
            })
            .await
            .map_err(err)?
            .map_err(err)?;
            Ok(json!(String::from_utf8_lossy(&bytes)))
        }
        "install" | "buildHorizonMods" | "installContent" | "updateContent"
        | "updateAllContent" | "importPack" | "downloadPack" | "importFolder"
        | "importModrinth" | "loginMicrosoft" => {
            let _guard = e
                .busy
                .try_lock()
                .map_err(|_| "Дождитесь завершения текущей операции".to_string())?;
            let task = e
                .task(
                    param(&payload, "operationId")?,
                    payload["id"].as_str().map(String::from),
                )
                .await
                .map_err(err)?;
            let result: Result<Value, anyhow::Error> = async {
                match action.as_str() {
                    "importModrinth" => {
                        let extra: Vec<std::path::PathBuf> =
                            param(&payload, "directories").map_err(anyhow::Error::msg)?;
                        let mut roots = auren_core::modrinth_import::default_directories();
                        roots.extend(extra);
                        Ok(json!(
                            e.import_modrinth_with_cleanup(
                                roots,
                                param(&payload, "selected").map_err(anyhow::Error::msg)?,
                                payload["removeSource"].as_bool().unwrap_or(false),
                                &task
                            )
                            .await?
                        ))
                    }
                    "install" => {
                        e.install(payload["id"].as_str().unwrap_or(""), &task)
                            .await?;
                        Ok(Value::Null)
                    }
                    "buildHorizonMods" => {
                        e.build_horizon_mods(
                            &param::<String>(&payload, "id").map_err(anyhow::Error::msg)?,
                            payload["trustNativeCode"].as_bool().unwrap_or(false),
                            &task,
                        )
                        .await?;
                        Ok(Value::Null)
                    }
                    "installContent" => {
                        e.install_content(
                            payload["id"].as_str().unwrap_or(""),
                            payload["source"].as_str().unwrap_or(""),
                            payload["projectId"].as_str().unwrap_or(""),
                            payload["versionId"].as_str().unwrap_or(""),
                            &task,
                        )
                        .await?;
                        Ok(Value::Null)
                    }
                    "updateContent" => {
                        e.update_content(
                            payload["id"].as_str().unwrap_or(""),
                            payload["contentId"].as_str().unwrap_or(""),
                            &task,
                        )
                        .await?;
                        Ok(Value::Null)
                    }
                    "updateAllContent" => Ok(json!(
                        e.update_all_content(
                            payload["id"].as_str().unwrap_or(""),
                            &param::<Vec<String>>(&payload, "contentIds")
                                .map_err(anyhow::Error::msg)?,
                            &task,
                        )
                        .await?
                    )),
                    "loginMicrosoft" => {
                        let result = e
                            .login_microsoft(&task, |url| {
                                let app = app.clone();
                                let id = task.id.clone();
                                async move {
                                    app.state::<BrowserSignIn>().0.lock().map_err(|_| anyhow::anyhow!("Не удалось подготовить вход"))?.insert(id, url.clone());
                                    app.opener().open_url(&url, None::<&str>)
                                        .map_err(|_| anyhow::anyhow!("Не удалось открыть браузер. Проверьте браузер по умолчанию"))
                                }
                            })
                            .await;
                        if let Ok(mut pending) = app.state::<BrowserSignIn>().0.lock() { pending.remove(&task.id); }
                        if result.is_ok() {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        Ok(json!(result?))
                    }
                    "importPack" => {
                        if let Some(path) =
                            choose_file(&app, "Minecraft modpack", &["mrpack", "zip"])
                                .await
                                .map_err(anyhow::Error::msg)?
                        {
                            Ok(json!(e.import_pack(&path, &task).await?))
                        } else {
                            Ok(Value::Null)
                        }
                    }
                    "downloadPack"
                        if auren_core::pack_catalog::is_pack_source(
                            payload["source"].as_str().unwrap_or(""),
                        ) =>
                    {
                        Ok(json!(
                            e.download_platform_pack_with_options(
                                payload["source"].as_str().unwrap_or(""),
                                payload["projectId"].as_str().unwrap_or(""),
                                payload["versionId"].as_str().unwrap_or(""),
                                &serde_json::from_value(
                                    payload.get("options").cloned().unwrap_or_else(|| json!({}))
                                )?,
                                &task,
                            )
                            .await?
                        ))
                    }
                    "downloadPack" => Ok(json!(
                        e.download_pack(
                            payload["source"].as_str().unwrap_or(""),
                            payload["projectId"].as_str().unwrap_or(""),
                            payload["versionId"].as_str().unwrap_or(""),
                            &task
                        )
                        .await?
                    )),
                    "importFolder" => {
                        let app = app.clone();
                        let path = tauri::async_runtime::spawn_blocking(move || {
                            app.dialog().file().blocking_pick_folder()
                        })
                        .await?;
                        if let Some(path) = path {
                            let path = path
                                .into_path()
                                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                            Ok(json!(
                                e.import_folder_with_cleanup(
                                    &path,
                                    payload["name"]
                                        .as_str()
                                        .unwrap_or("Импортированная сборка")
                                        .into(),
                                    payload["minecraft"].as_str().unwrap_or("").into(),
                                    serde_json::from_value(payload["loader"].clone())?,
                                    payload["loaderVersion"].as_str().map(String::from),
                                    payload["removeSource"].as_bool().unwrap_or(false),
                                    &task
                                )
                                .await?
                            ))
                        } else {
                            Ok(Value::Null)
                        }
                    }
                    _ => unreachable!(),
                }
            }
            .await;
            e.finish(
                &task,
                &result
                    .as_ref()
                    .map(|_| ())
                    .map_err(|e| anyhow::anyhow!("{e:#}")),
            )
            .await;
            result.map_err(|e| format!("{e:#}"))
        }
        _ => Err("Неизвестная команда".into()),
    }
}
async fn choose_file(
    app: &tauri::AppHandle,
    label: &str,
    extensions: &[&str],
) -> Result<Option<std::path::PathBuf>, String> {
    let app = app.clone();
    let label = label.to_string();
    let extensions: Vec<String> = extensions.iter().map(|s| s.to_string()).collect();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if !extensions.is_empty() {
            let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(label, &refs);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(err)?;
    path.map(|p| p.into_path().map_err(err)).transpose()
}
fn main() {
    if let Some(code) = maintenance::command() { std::process::exit(code); }
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    #[cfg(windows)]
    if let Some(action) = std::env::args().nth(1).filter(|arg| {
        matches!(arg.as_str(), "--social-cleanup" | "--social-firewall-remove")
    }) {
        let result = if action == "--social-firewall-remove" {
            if context.config().identifier == "app.auren.launcher" {
                aurum_social::firewall::remove_owned_rules()
            } else {
                Ok(())
            }
        } else {
            social_runtime::cleanup(&context.config().identifier)
        };
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    if let Some(code) = uninstall::command() {
        std::process::exit(code);
    }
    let shortcuts = server_shortcuts::Shortcuts::default();
    shortcuts.enqueue(&std::env::args().collect::<Vec<_>>());
    tauri::Builder::default()
        .manage(shortcuts)
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            server_shortcuts::receive(app, &arguments);
            #[cfg(windows)] social::receive(app,&arguments);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(BrowserSignIn(std::sync::Mutex::new(std::collections::HashMap::new())))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            maintenance::clean_old_updaters();
            let handle = app.handle().clone();
            let isolated_data = std::env::var_os("AURUM_DATA_DIR").is_some() || std::env::var_os("AUREN_DATA_DIR").is_some();
            let location = app.path().app_config_dir()?.join("data-location.json");
            let root = if let Some(path) =
                std::env::var_os("AURUM_DATA_DIR").or_else(|| std::env::var_os("AUREN_DATA_DIR"))
            {
                std::path::PathBuf::from(path)
            } else if location.exists() {
                let selected: std::path::PathBuf =
                    serde_json::from_slice(&std::fs::read(location)?)?;
                let legacy = app.path().app_data_dir()?;
                if selected == legacy {
                    auren_core::default_data_directory(&legacy)?
                } else {
                    selected
                }
            } else {
                auren_core::default_data_directory(&app.path().app_data_dir()?)?
            };
            let root = auren_core::layout::prepare(&root)?;
            let application = auren_core::layout::application(&root);
            if std::env::var_os("AURUM_DATA_DIR").is_none() && std::env::var_os("AUREN_DATA_DIR").is_none() {
                let pending = app.path().app_config_dir()?.join("webview-source.json");
                if pending.exists() {
                    let source: std::path::PathBuf = serde_json::from_slice(&std::fs::read(&pending)?)?;
                    if source.file_name().is_none_or(|n| n != "webview") || source.parent().and_then(|p| p.file_name()).is_none_or(|n| n != auren_core::layout::LAUNCHER) {
                        return Err(anyhow::anyhow!("Invalid interface profile migration source").into());
                    }
                    auren_core::layout::relocate_webview(&source, &root)?;
                    std::fs::remove_file(pending)?;
                }
                auren_core::layout::relocate_webview(&app.path().app_local_data_dir()?, &root)?;
            }
            // Delete only disposable browser caches, before any WebView process opens this profile.
            if application.join("clear-browser-cache").exists() {
                auren_core::storage_manager::clean_browser_cache(&root)?;
            }
            let mut config = app.config().app.windows[0].clone();
            config.create = true;
            config.data_directory = Some(application.parent().unwrap().join("webview"));
            tauri::WebviewWindowBuilder::from_config(app, &config)?.build()?;
            let location = app.path().app_config_dir()?.join("data-location.json");
            if !isolated_data {
                std::fs::create_dir_all(location.parent().unwrap())?;
                std::fs::write(&location, serde_json::to_vec(&root)?)?;
            }
            let engine = tauri::async_runtime::block_on(Engine::new(root, move |event| {
                let _ = handle.emit("aurum:event", event);
            }))?;
            app.manage(engine.clone());
            #[cfg(windows)]{
                app.manage(social::Links::default());
                app.manage(social_runtime::Runtime::new(app.handle())?);
                social::receive(app.handle(),&std::env::args().collect::<Vec<_>>());
                let social_events=app.handle().clone();
                engine.social.set_notifier(std::sync::Arc::new(move||{let _=social_events.emit_to("main","social:event",());}));
                social::resume(app.handle(),&engine);
            }
            if !isolated_data { uninstall::register(&engine.root, &app.config().identifier)?; }
            app.manage(Relocation(std::sync::atomic::AtomicBool::new(false)));
            // Creation-time centering uses the requested client size. Center again
            // after Windows has applied the actual resize frame, then show once.
            if let Some(window) = app.get_webview_window("main") {
                window.center()?;
                window.show()?;
                let closing = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        #[cfg(windows)]
                        if closing.state::<Engine>().social.has_active_tunnels(){api.prevent_close();let _=closing.emit_to("main","social:closeRequested",());return;}
                        if !closing.state::<Engine>().hosting_running().is_empty() {
                            api.prevent_close();
                            let _ = closing.emit(
                                "aurum:event",
                                auren_core::model::Event {
                                    id: String::new(),
                                    profile_id: None,
                                    pack_name: None,
                                    phase: "hosting-close-blocked".into(),
                                    message: "Сначала остановите локальные серверы".into(),
                                    done: 0,
                                    total: 0,
                                },
                            );
                        } else {
                            #[cfg(windows)]
                            let _=closing.state::<Engine>().social.shutdown();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc])
        .run(context)
        .expect("Unable to start Aurum");
}
