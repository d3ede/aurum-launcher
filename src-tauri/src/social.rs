use crate::{err, param};
#[derive(Default)]
pub struct Links(std::sync::Mutex<std::collections::VecDeque<String>>);
impl Links {
    pub fn enqueue(&self, args: &[String]) {
        if let Ok(mut queue) = self.0.lock() {
            for value in args.iter().filter(|v| v.starts_with("aurum://")) {
                if value.len() <= 1800
                    && queue.len() < 8
                    && aurum_social::service::parse_contact(value).is_ok()
                {
                    queue.push_back(value.clone());
                }
            }
        }
    }
}
pub fn receive(app: &tauri::AppHandle, args: &[String]) {
    app.state::<Links>().enqueue(args);
    let _ = tauri::Emitter::emit_to(app, "main", "social:link", ());
}
pub fn resume(app: &tauri::AppHandle, e: &Engine) {
    if e.social.enabled_previously() {
        if let Ok(path) = worker_path(app) {
            if aurum_social::firewall::status(&path, false)
                .is_ok_and(|rules| rules.iter().all(|r| r.present && r.scoped))
            {
                let name = e
                    .social
                    .snapshot()
                    .map(|s| s.name)
                    .unwrap_or_else(|_| "Player".into());
                let _ = e.social.enable(path, name, true);
            }
        }
    }
}
use auren_core::Engine;
use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub fn worker_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(err)?
        .join("social/aurum-social-worker.exe");
    if bundled.is_file() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    {
        let debug = std::env::current_exe()
            .map_err(err)?
            .with_file_name("aurum-social-worker.exe");
        if debug.is_file() {
            return Ok(debug);
        }
    }
    Err(
        "The isolated Social worker is missing. Build the Social sidecars before enabling it."
            .into(),
    )
}
pub async fn rpc(
    action: &str,
    payload: &Value,
    e: &Engine,
    app: &tauri::AppHandle,
) -> Result<Value, String> {
    let social = e.social.clone();
    match action {
        "social.takeLink" => {
            let value = app.state::<Links>().0.lock().map_err(err)?.pop_front();
            Ok(json!(value))
        }
        "social.close" => {
            e.cancel_social_tasks().await;
            tauri::async_runtime::spawn_blocking(move || social.shutdown())
                .await
                .map_err(err)?
                .map_err(err)?;
            app.get_webview_window("main")
                .ok_or("Missing main window")?
                .close()
                .map_err(err)?;
            Ok(Value::Null)
        }
        "social.snapshot" => tauri::async_runtime::spawn_blocking(move || {
            social.snapshot().and_then(|s| Ok(serde_json::to_value(s)?))
        })
        .await
        .map_err(err)?
        .map_err(err),
        "social.enable" => {
            let accepted: bool = param(payload, "accepted")?;
            let name: String = param(payload, "name")?;
            let executable = worker_path(app)?;
            tauri::async_runtime::spawn_blocking(move || social.enable(executable, name, accepted))
                .await
                .map_err(err)?
                .map_err(err)?;
            Ok(Value::Null)
        }
        "social.disable" => {
            e.cancel_social_tasks().await;
            tauri::async_runtime::spawn_blocking(move || social.disable())
                .await
                .map_err(err)?
                .map_err(err)?;
            Ok(Value::Null)
        }
        "social.lanListeners" => {
            let listeners = e
                .social_lan_listeners(&param::<String>(payload, "profileId")?)
                .await
                .map_err(err)?;
            serde_json::to_value(listeners).map_err(err)
        }
        "social.exportManifest" => {
            let profile: String = param(payload, "profileId")?;
            let configs = param(payload, "configs")?;
            let sensitive = param(payload, "sensitive")?;
            let task = e
                .social_task(param(payload, "operationId")?)
                .await
                .map_err(err)?;
            let result = e
                .social_export_checked(&profile, configs, sensitive, Some(task.cancel.clone()))
                .await;
            let outcome = result
                .as_ref()
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!(e.to_string()));
            e.finish_social_task(&task, &outcome).await;
            result
                .and_then(|value| serde_json::to_value(value).map_err(Into::into))
                .map_err(err)
        }
        "social.invite" => {
            let profile: String = param(payload, "profileId")?;
            let friend: String = param(payload, "friend")?;
            let port = param(payload, "port")?;
            let sharing = auren_core::social::ShareOptions {
                configs: param(payload, "configs")?,
                sensitive: param(payload, "sensitive")?,
                with_pack: param(payload, "withPack")?,
            };
            let task = e
                .social_task(param(payload, "operationId")?)
                .await
                .map_err(err)?;
            let result = e
                .social_invite(&profile, &friend, port, sharing, &task)
                .await;
            e.finish_social_task(&task, &result).await;
            result.map_err(err)?;
            Ok(Value::Null)
        }
        "social.dismissInvite" => {
            social.dismiss(param(payload, "id")?).map_err(err)?;
            Ok(Value::Null)
        }
        "social.plan" => {
            if !social.is_enabled() {
                return Err("Enable Social before reviewing an invitation".into());
            }
            let id: String = param(payload, "id")?;
            let task = e
                .social_task(param(payload, "operationId")?)
                .await
                .map_err(err)?;
            let result = e.social_plan_cancellable(&id, &task).await;
            let outcome = result
                .as_ref()
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!(e.to_string()));
            e.finish_social_task(&task, &outcome).await;
            result
                .and_then(|plan| serde_json::to_value(plan).map_err(Into::into))
                .map_err(err)
        }
        "social.install" => {
            if !social.is_enabled() {
                return Err("Enable Social before resuming an installation".into());
            }
            let plan_id: String = param(payload, "planId")?;
            let accepted: bool = param(payload, "accepted")?;
            let _guard = e
                .busy
                .try_lock()
                .map_err(|_| "Wait for the current operation to finish")?;
            let task = e
                .social_task(param(payload, "operationId")?)
                .await
                .map_err(err)?;
            let result = e.social_install(&plan_id, &task, accepted).await;
            let outcome = result
                .as_ref()
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!(e.to_string()));
            e.finish_social_task(&task, &outcome).await;
            result
                .and_then(|installed| serde_json::to_value(installed).map_err(Into::into))
                .map_err(err)
        }
        "social.join" => {
            let id: String = param(payload, "id")?;
            let profile: String = param(payload, "profileId")?;
            let task = e
                .social_task(param(payload, "operationId")?)
                .await
                .map_err(err)?;
            let result = e.social_join(&id, &profile, &task).await;
            e.finish_social_task(&task, &result).await;
            result.map_err(err)?;
            Ok(Value::Null)
        }
        "social.pending" => {
            serde_json::to_value(e.social_pending().await.map_err(err)?).map_err(err)
        }
        "social.add" => {
            social.add(param(payload, "input")?).map_err(err)?;
            Ok(Value::Null)
        }
        "social.relationship" => {
            social
                .relationship(param(payload, "id")?, &param::<String>(payload, "action")?)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "social.privacy" => {
            social
                .set_privacy(param(payload, "privacy")?)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "social.rename" => {
            social
                .rename(&param::<String>(payload, "name")?)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "social.qr" => {
            let id = social
                .snapshot()
                .map_err(err)?
                .id
                .ok_or("Enable Social to create an identity first")?;
            Ok(json!(aurum_social::identity::qr(&id).map_err(err)?))
        }
        "social.firewallStatus" => {
            let worker = worker_path(app)?;
            tauri::async_runtime::spawn_blocking(move || {
                aurum_social::firewall::status(&worker, false)
                    .and_then(|s| Ok(serde_json::to_value(s)?))
            })
            .await
            .map_err(err)?
            .map_err(err)
        }
        "social.configureFirewall" => {
            if !param::<bool>(payload, "accepted")? {
                return Err("Explicit consent to the scoped Firewall rule is required".into());
            }
            let worker = worker_path(app)?;
            tauri::async_runtime::spawn_blocking(move || {
                aurum_social::firewall::request_configuration(&worker)
            })
            .await
            .map_err(err)?
            .map_err(err)?;
            Ok(Value::Null)
        }
        "social.exportIdentity" => {
            let password: String = param(payload, "password")?;
            let handle = app.clone();
            let saved = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
                let Some(path) = handle
                    .dialog()
                    .file()
                    .set_file_name("aurum-identity.age")
                    .blocking_save_file()
                else {
                    return Ok(false);
                };
                let bytes = social.export_identity(&password).map_err(err)?;
                std::fs::write(path.into_path().map_err(err)?, bytes).map_err(err)?;
                Ok(true)
            })
            .await
            .map_err(err)??;
            Ok(json!(saved))
        }
        "social.restoreIdentity" => {
            let password: String = param(payload, "password")?;
            let replace: bool = param(payload, "replace")?;
            let handle = app.clone();
            let restored = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
                let Some(path) = handle
                    .dialog()
                    .file()
                    .add_filter("Encrypted Aurum identity", &["age"])
                    .blocking_pick_file()
                else {
                    return Ok(false);
                };
                let path = path.into_path().map_err(err)?;
                if std::fs::metadata(&path).map_err(err)?.len() > 4096 {
                    return Err("Identity backup exceeds limit".into());
                }
                social
                    .restore_identity(&std::fs::read(path).map_err(err)?, &password, replace)
                    .map_err(err)?;
                Ok(true)
            })
            .await
            .map_err(err)??;
            Ok(json!(restored))
        }
        _ => Err("Unknown Social command".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_only_queue_bounded_valid_contact_requests() {
        let links = Links::default();
        let id = aurum_social::identity::Identity::generate().unwrap().id();
        let link = format!("aurum://social/add/{id}");
        let mut args = vec![
            "aurum://social/launch/cmd.exe".into(),
            "aurum://social/add/not-a-key".into(),
            "https://example.com".into(),
        ];
        args.extend(std::iter::repeat_n(link.clone(), 20));
        links.enqueue(&args);
        let queue = links.0.lock().unwrap();
        assert_eq!(queue.len(), 8);
        assert!(queue.iter().all(|v| v == &link));
    }
}
