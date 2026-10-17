use crate::{err, param};
use auren_core::{
    hosting::{HostingInstall, HostingUpdate},
    Engine,
};
use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub async fn rpc(
    action: &str,
    payload: &Value,
    engine: &Engine,
    app: &tauri::AppHandle,
) -> Result<Value, String> {
    match action {
        "hostingProfiles" => Ok(json!(engine.hosting_profiles().await.map_err(err)?)),
        "hostingFiles" => Ok(json!(engine
            .hosting_files(
                &param::<String>(payload, "id")?,
                &param::<String>(payload, "path")?
            )
            .await
            .map_err(err)?)),
        "hostingScriptTrust" => Ok(json!(engine
            .hosting_script_trust(&param::<String>(payload, "id")?)
            .await
            .map_err(err)?)),
        "hostingTrustScript" => {
            engine
                .hosting_trust_script(
                    &param::<String>(payload, "id")?,
                    &param::<String>(payload, "hash")?,
                )
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingNetworkScript" => {
            engine
                .hosting_network_script(&param::<String>(payload, "id")?, param(payload, "script")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingNetworkStopCommand" => {
            engine
                .hosting_network_stop_command(
                    &param::<String>(payload, "id")?,
                    param(payload, "command")?,
                )
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingChooseFolder" => {
            let handle = app.clone();
            let path = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Папка сервера или сети серверов")
                    .blocking_pick_folder()
            })
            .await
            .map_err(err)?;
            Ok(json!(path
                .map(|path| path
                    .into_path()
                    .map(|path| path.to_string_lossy().into_owned()))
                .transpose()
                .map_err(err)?))
        }
        "hostingInspect" => {
            let root: std::path::PathBuf = param(payload, "root")?;
            Ok(json!(tauri::async_runtime::spawn_blocking(move || {
                auren_core::hosting::inspect(&root)
            })
            .await
            .map_err(err)?
            .map_err(err)?))
        }
        "hostingImport" => Ok(json!(engine
            .hosting_import(param(payload, "root")?, param(payload, "selected")?)
            .await
            .map_err(err)?)),
        "hostingSettings" => Ok(json!(engine
            .hosting_settings(&param::<String>(payload, "id")?)
            .await
            .map_err(err)?)),
        "hostingUpdate" => {
            engine
                .hosting_update(
                    &param::<String>(payload, "id")?,
                    param::<HostingUpdate>(payload, "update")?,
                )
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingRemove" => {
            engine
                .hosting_remove(&param::<String>(payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingOpen" => {
            let path = engine
                .hosting_path(
                    &param::<String>(payload, "id")?,
                    payload["logs"].as_bool().unwrap_or(false),
                )
                .await
                .map_err(err)?;
            app.opener()
                .open_path(path.to_string_lossy(), None::<&str>)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingConsole" => Ok(json!(engine
            .hosting_console(
                &param::<String>(payload, "id")?,
                payload["after"].as_u64().unwrap_or(0)
            )
            .await
            .map_err(err)?)),
        "hostingControl" => {
            engine
                .hosting_control(
                    &param::<String>(payload, "id")?,
                    &param::<String>(payload, "action")?,
                    payload["command"].as_str().unwrap_or(""),
                )
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingPlayerAction" => {
            engine
                .hosting_player_action(
                    &param::<String>(payload, "id")?,
                    &param::<String>(payload, "player")?,
                    &param::<String>(payload, "action")?,
                    payload["target"].as_str().unwrap_or(""),
                )
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingAcceptEula" => {
            if payload["accepted"] != true {
                return Err("Нужно явно принять Minecraft EULA".into());
            }
            engine
                .hosting_accept_eula(&param::<String>(payload, "id")?)
                .await
                .map_err(err)?;
            Ok(Value::Null)
        }
        "hostingVersions" => Ok(json!(engine
            .hosting_versions(&param::<String>(payload, "core")?)
            .await
            .map_err(err)?)),
        "hostingStart" | "hostingRestart" | "hostingInstall" => {
            let task = engine
                .task(param(payload, "operationId")?, None)
                .await
                .map_err(err)?;
            let result = match action {
                "hostingInstall" => match param::<HostingInstall>(payload, "request") {
                    Ok(request) => engine
                        .hosting_install(request, &task)
                        .await
                        .map(|profile| json!(profile)),
                    Err(error) => Err(anyhow::anyhow!(error)),
                },
                _ => match param::<String>(payload, "id") {
                    Ok(id) => if action == "hostingRestart" {
                        engine.hosting_restart(&id, &task).await
                    } else {
                        engine.hosting_start(&id, &task).await
                    }
                    .map(|_| Value::Null),
                    Err(error) => Err(anyhow::anyhow!(error)),
                },
            };
            engine
                .finish(
                    &task,
                    &result
                        .as_ref()
                        .map(|_| ())
                        .map_err(|error| anyhow::anyhow!("{error:#}")),
                )
                .await;
            result.map_err(err)
        }
        _ => Err("Неизвестная команда хостинга".into()),
    }
}
