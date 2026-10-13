#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod microsoft_window;
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
    match action.as_str() {
        "restart" => {
            if !e.running.lock().await.is_empty() {
                return Err("Сначала остановите игру".into());
            }
            app.restart()
        }
        "changeDataDirectory" => {
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
                task.check()?;
                let config = app.path().app_config_dir()?;
                std::fs::create_dir_all(&config)?;
                let temp = config.join("data-location.json.tmp");
                std::fs::write(&temp, serde_json::to_vec(&path)?)?;
                std::fs::rename(temp, config.join("data-location.json"))?;
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
        "snapshot" => Ok(json!(e.snapshot().await)),
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
            ).map_err(err)?.as_ref()
                .map(auren_core::store::validate_profile_icon_style)
                .transpose().map_err(err)?;
            let icon = payload["icon"]
                .as_str()
                .map(auren_core::store::validate_profile_icon)
                .transpose()
                .map_err(err)?;
            let mut profile = e
                .create_profile(
                    param(&payload, "name")?,
                    param(&payload, "minecraft")?,
                    param(&payload, "loader")?,
                    payload["loaderVersion"].as_str().map(String::from),
                    payload["cover"].as_u64().unwrap_or(0) as u8,
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
        "setCurseforgeKey" => {
            let key = param::<String>(&payload, "key")?;
            if key.is_empty() {
                let _ = auren_core::auth::delete_secret("curseforge");
            } else {
                auren_core::auth::set_secret("curseforge", &key).map_err(err)?
            }
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
        "accountAppearance" => Ok(json!(e
            .account_appearance(&param::<String>(&payload, "id")?)
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
            e.launch(&param::<String>(&payload, "id")?)
                .await
                .map_err(err)?;
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
            microsoft_window::focus(&app, &param::<String>(&payload, "operationId")?)?;
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
            let path = e.instance(&id).map_err(err)?.join("auren-latest.log");
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
        "install" | "installContent" | "updateContent" | "importPack" | "downloadPack"
        | "importFolder" | "importModrinth" | "loginMicrosoft" => {
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
                            e.import_modrinth(
                                roots,
                                param(&payload, "selected").map_err(anyhow::Error::msg)?,
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
                    "loginMicrosoft" => {
                        let result = e
                            .login_microsoft(&task, |url| {
                                microsoft_window::open(&app, &e, &task.id, url)
                            })
                            .await;
                        microsoft_window::finish(&app, &task.id);
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
                                e.import_folder(
                                    &path,
                                    payload["name"]
                                        .as_str()
                                        .unwrap_or("Импортированная сборка")
                                        .into(),
                                    payload["minecraft"].as_str().unwrap_or("").into(),
                                    serde_json::from_value(payload["loader"].clone())?,
                                    payload["loaderVersion"].as_str().map(String::from),
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
    tauri::Builder::default()
        .manage(microsoft_window::MicrosoftWindow::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let location = app.path().app_config_dir()?.join("data-location.json");
            let root = if let Some(path) =
                std::env::var_os("AURUM_DATA_DIR").or_else(|| std::env::var_os("AUREN_DATA_DIR"))
            {
                std::path::PathBuf::from(path)
            } else if location.exists() {
                serde_json::from_slice(&std::fs::read(location)?)?
            } else {
                app.path().app_data_dir()?
            };
            let engine = tauri::async_runtime::block_on(Engine::new(root, move |event| {
                if event.phase == "auth-exchange" {
                    microsoft_window::finish(&handle, &event.id);
                }
                let _ = handle.emit("auren:event", event);
            }))?;
            app.manage(engine);
            app.manage(Relocation(std::sync::atomic::AtomicBool::new(false)));
            // Creation-time centering uses the requested client size. Center again
            // after Windows has applied the actual resize frame, then show once.
            if let Some(window) = app.get_webview_window("main") {
                window.center()?;
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc])
        .run(tauri::generate_context!())
        .expect("Unable to start Aurum");
}
