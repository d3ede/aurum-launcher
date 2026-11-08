use crate::{err, param};
use aurum_core::Engine;
use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub async fn rpc(
    action: &str,
    payload: &Value,
    e: &Engine,
    app: &tauri::AppHandle,
) -> Result<Value, String> {
    match action {
        "screenshots.list" => {
            let profile: Option<String> = param(payload, "profileId")?;
            serde_json::to_value(e.screenshots(profile.as_deref()).await.map_err(err)?).map_err(err)
        }
        "screenshots.image" => {
            let id: String = param(payload, "id")?;
            let thumbnail: bool = param(payload, "thumbnail")?;
            Ok(json!(e
                .screenshot_image(&id, thumbnail)
                .await
                .map_err(err)?))
        }
        "screenshots.send" => {
            #[cfg(windows)]
            {
                let friend: String = param(payload, "friend")?;
                let ids: Vec<String> = param(payload, "ids")?;
                Ok(json!(e
                    .send_screenshots(&friend, &ids)
                    .await
                    .map_err(err)?))
            }
            #[cfg(not(windows))]
            {
                Err("Screenshot sharing currently requires Windows Social".into())
            }
        }
        "screenshots.transfers" => {
            #[cfg(windows)]
            {
                let social = e.social.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    social
                        .screenshot_transfers()
                        .and_then(|v| Ok(serde_json::to_value(v)?))
                })
                .await
                .map_err(err)?
                .map_err(err)
            }
            #[cfg(not(windows))]
            {
                Ok(json!([]))
            }
        }
        "screenshots.decide" => {
            #[cfg(windows)]
            {
                let batch: String = param(payload, "batch")?;
                let accept: bool = param(payload, "accept")?;
                let social = e.social.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    social.decide_screenshots(&batch, accept)
                })
                .await
                .map_err(err)?
                .map_err(err)?;
                Ok(Value::Null)
            }
            #[cfg(not(windows))]
            {
                Err("Social screenshots require Windows".into())
            }
        }
        "screenshots.cancel" | "screenshots.retry" | "screenshots.removeReceived" => {
            #[cfg(windows)]
            {
                let social = e.social.clone();
                let id: String = param(payload, "id")?;
                let action = action.to_owned();
                tauri::async_runtime::spawn_blocking(move || match action.as_str() {
                    "screenshots.cancel" => social.cancel_screenshot(&id),
                    "screenshots.retry" => social.retry_screenshot(&id),
                    _ => social.remove_received_screenshot(&id),
                })
                .await
                .map_err(err)?
                .map_err(err)?;
                Ok(Value::Null)
            }
            #[cfg(not(windows))]
            {
                Err("Social screenshots require Windows".into())
            }
        }
        "screenshots.openFolder" => {
            let id: String = param(payload, "profileId")?;
            e.profile(&id).await.map_err(err)?;
            let path = e.instance(&id).map_err(err)?.join("screenshots");
            std::fs::create_dir_all(&path).map_err(err)?;
            app.opener()
                .open_path(path.to_string_lossy().as_ref(), None::<&str>)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "screenshots.copy" => {
            #[cfg(windows)]
            {
                use tauri::Manager;
                let id: String = param(payload, "id")?;
                let window = app
                    .get_webview_window("main")
                    .ok_or("Launcher window is unavailable")?;
                let owner = window.hwnd().map_err(err)?.0 as isize;
                let bytes = screenshot_bytes(e, &id).await?;
                tauri::async_runtime::spawn_blocking(move || {
                    aurum_core::screenshots::clipboard::copy_image(&bytes, owner).map_err(err)
                })
                .await
                .map_err(err)??;
                Ok(Value::Null)
            }
            #[cfg(not(windows))]
            {
                Err("Screenshot clipboard currently requires Windows".into())
            }
        }
        "screenshots.save" => {
            let id: String = param(payload, "id")?;
            let bytes = screenshot_bytes(e, &id).await?;
            aurum_core::screenshots::dimensions(&bytes).map_err(err)?;
            let extension = if bytes.starts_with(b"\x89PNG") {
                "png"
            } else if bytes.starts_with(b"\xff\xd8") {
                "jpg"
            } else {
                "webp"
            };
            let handle = app.clone();
            let name = format!("Aurum-screenshot.{extension}");
            let saved = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
                let Some(path) = handle
                    .dialog()
                    .file()
                    .set_file_name(name)
                    .blocking_save_file()
                else {
                    return Ok(false);
                };
                std::fs::write(path.into_path().map_err(err)?, bytes).map_err(err)?;
                Ok(true)
            })
            .await
            .map_err(err)??;
            Ok(json!(saved))
        }
        _ => Err("Unknown screenshot command".into()),
    }
}

async fn screenshot_bytes(e: &Engine, id: &str) -> Result<Vec<u8>, String> {
    if let Some(id) = id.strip_prefix("received:") {
        #[cfg(windows)]
        {
            e.social.received_screenshot(id).map_err(err)
        }
        #[cfg(not(windows))]
        {
            let _ = id;
            Err("Social screenshots require Windows".into())
        }
    } else {
        e.screenshot_bytes(id).await.map_err(err)
    }
}
