//! Explicit local maintenance entry point used for an installed data upgrade.
pub fn command() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|s| s != "--maintain-storage") {
        return None;
    }
    let result = (|| -> anyhow::Result<()> {
        let home = std::path::PathBuf::from(
            args.get(2)
                .ok_or_else(|| anyhow::anyhow!("Missing data home"))?,
        );
        let report = std::path::PathBuf::from(
            args.get(3)
                .ok_or_else(|| anyhow::anyhow!("Missing report path"))?,
        );
        let root = auren_core::layout::prepare(&home)?;
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            auren_core::layout::relocate_webview(
                &std::path::PathBuf::from(local).join("app.auren.launcher"),
                &root,
            )?;
        }
        let app = auren_core::layout::application(&root);
        let before = auren_core::storage_manager::bytes(&root)?
            + auren_core::storage_manager::bytes(app.parent().unwrap())?;
        let runtime = tokio::runtime::Runtime::new()?;
        runtime.block_on(async {
            let engine = auren_core::Engine::new(root.clone(), |_| {}).await?;
            engine.ensure_idle("").await?;
            if !engine.running.lock().await.is_empty() || !engine.hosting_running().is_empty() { anyhow::bail!("Close games before maintenance") }
            let task = engine.task("6ab0f7a4-dce0-4f7b-8d46-1040600799e3".into(), None).await?;
            let optimized = engine.optimize_java(&task).await;
            let finished = optimized.as_ref().map(|_| ()).map_err(|e| anyhow::anyhow!("{e:#}"));
            engine.finish(&task, &finished).await;
            let optimized = optimized?;
            let cache = engine.clean_storage("cache").await?;
            let logs = engine.clean_storage("logs").await?;
            let browser = auren_core::storage_manager::clean_browser_cache(&root)?;
            let after = auren_core::storage_manager::bytes(&root)? + auren_core::storage_manager::bytes(app.parent().unwrap())?;
            let snapshot = engine.storage_snapshot().await?;
            std::fs::write(&report, serde_json::to_vec_pretty(&serde_json::json!({
                "reclaimedBytes": before.saturating_sub(after), "javaReclaimedBytes": optimized,
                "cacheReclaimedBytes": cache, "logsReclaimedBytes": logs, "browserReclaimedBytes": browser,
                "storage": snapshot,
            }))?)?;
            Ok::<(), anyhow::Error>(())
        })
    })();
    match result {
        Ok(()) => Some(0),
        Err(error) => {
            eprintln!("{error:#}");
            Some(1)
        }
    }
}

/// The Windows updater must keep its installer alive across process exit; prune it later.
pub fn clean_old_updaters() {
    let base = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&base) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry
            .file_type()
            .is_ok_and(|t| t.is_dir() && !t.is_symlink())
        {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some((version, random)) = name
            .strip_prefix("Aurum Launcher-")
            .and_then(|s| s.split_once("-updater-"))
        else {
            continue;
        };
        if !version.chars().all(|c| c.is_ascii_digit() || c == '.')
            || !random.chars().all(|c| c.is_ascii_alphanumeric())
        {
            continue;
        }
        let Ok(age) = entry
            .metadata()
            .and_then(|m| m.modified())
            .and_then(|t| t.elapsed().map_err(std::io::Error::other))
        else {
            continue;
        };
        if age < std::time::Duration::from_secs(24 * 60 * 60) {
            continue;
        }
        let path = entry.path();
        let Ok(contents) = std::fs::read_dir(&path) else {
            continue;
        };
        let contents: Vec<_> = contents.flatten().collect();
        if contents.len() != 1 {
            continue;
        }
        let installer = &contents[0];
        if installer.file_name() != format!("Aurum Launcher-{version}-installer.exe").as_str()
            || !installer
                .file_type()
                .is_ok_and(|t| t.is_file() && !t.is_symlink())
        {
            continue;
        }
        // Locked/running installers are left for the next startup.
        if std::fs::remove_file(installer.path()).is_ok() {
            let _ = std::fs::remove_dir(path);
        }
    }
}
