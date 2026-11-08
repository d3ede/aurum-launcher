//! Native, local-only screenshot approval preview. All writes stay in .test-data.
#[cfg(not(windows))]
fn main() {
    eprintln!("The screenshot self-preview requires Windows.");
    std::process::exit(1);
}

#[cfg(windows)]
fn preview_closed(session: &std::path::Path) -> bool {
    let Some(pid) = std::fs::read_to_string(session.join("app-pid.txt"))
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
    else {
        return false;
    };
    let pid = sysinfo::Pid::from_u32(pid);
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system.process(pid).is_none()
}

#[cfg(windows)]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    use anyhow::{ensure, Context};
    use aurum_core::{
        layout,
        model::{Database, Loader},
        screenshots, Engine,
    };
    use aurum_social::{
        identity::Identity,
        photos::{NewPhoto, Store as Photos},
        store::{Privacy, Store},
    };
    use std::{
        fs,
        io::Write,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    let args: Vec<_> = std::env::args_os().skip(1).collect();
    ensure!(
        args.len() == 2,
        "Usage: screenshot_self_preview <new .test-data/session> <real Game Files>"
    );
    let session = PathBuf::from(&args[0]);
    let real = PathBuf::from(&args[1]);
    let allowed = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.test-data")
        .canonicalize()?;
    ensure!(
        session
            .parent()
            .context("Missing session parent")?
            .canonicalize()?
            == allowed,
        "Preview must be directly inside this checkout's .test-data"
    );
    ensure!(
        !session.exists(),
        "Use a new session directory; existing data is never replaced"
    );
    let original: Database =
        serde_json::from_slice(&fs::read(layout::app_path(&real, "state.json"))?)?;
    let mut candidates = Vec::new();
    for profile in &original.profiles {
        let folder = original
            .instance_directories
            .get(&profile.id)
            .unwrap_or(&profile.id);
        let instance = aurum_core::safe_join(&real.join("instances"), folder)?;
        let Ok(files) = fs::read_dir(instance.join("screenshots")) else {
            continue;
        };
        for file in files.flatten() {
            let metadata = file.path().symlink_metadata()?;
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= screenshots::MAX_IMAGE_BYTES
                && file.path().extension().is_some_and(|ext| {
                    ["png", "jpg", "jpeg", "webp"]
                        .iter()
                        .any(|known| ext.to_string_lossy().eq_ignore_ascii_case(known))
                })
            {
                candidates.push((metadata.modified()?, file.path()));
            }
        }
    }
    candidates.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
    let source = candidates
        .into_iter()
        .find_map(|(_, path)| {
            let bytes = fs::read(&path).ok()?;
            screenshots::dimensions(&bytes).ok().map(|_| (path, bytes))
        })
        .context("No supported screenshot found in registered instances")?;
    let selected_name = original
        .accounts
        .iter()
        .find(|a| Some(&a.id) == original.selected_account.as_ref())
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "Player".into());
    let mut name = selected_name.clone();
    let mut avatar = None;
    let real_social = layout::app_path(&real, "social/social.sqlite");
    if real_social.is_file() {
        // Never migrate or write the user's database. Only public display fields are read.
        let db = rusqlite::Connection::open_with_flags(
            real_social,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        if let Ok(value) = db.query_row("SELECT value FROM meta WHERE key='name'", [], |r| {
            r.get::<_, String>(0)
        }) {
            name = value;
        }
        if let Ok(value) = db.query_row("SELECT value FROM meta WHERE key='avatar'", [], |r| {
            r.get::<_, String>(0)
        }) {
            if !value.is_empty() {
                avatar = Some(value);
            }
        }
    }
    fs::create_dir(&session)?;
    let game = session.join("Game Files");
    let app = layout::application(&game);
    fs::create_dir_all(&app)?;
    let mut database = Database {
        settings: original.settings,
        ..Database::default()
    };
    database.settings.language = "ru".into();
    fs::write(
        app.join("state.json"),
        serde_json::to_vec_pretty(&database)?,
    )?;
    let engine = Engine::new(game.clone(), |_| {}).await?;
    engine.add_offline(selected_name).await?;
    let profile = engine
        .create_profile(
            "Самопроверка скриншотов".into(),
            "1.21.1".into(),
            Loader::Vanilla,
            None,
            0,
        )
        .await?;
    let directory = engine.instance(&profile.id)?.join("screenshots");
    fs::create_dir_all(&directory)?;
    let filename = source
        .0
        .file_name()
        .context("Missing screenshot filename")?
        .to_string_lossy()
        .into_owned();
    fs::write(directory.join(&filename), &source.1)?;
    let shot = engine
        .screenshots(Some(&profile.id))
        .await?
        .items
        .into_iter()
        .next()
        .context("Copied screenshot was not discovered")?;
    let social_root = app.join("social");
    let contacts = Store::open(&social_root.join("social.sqlite"))?;
    let identity = Identity::generate()?;
    let own = identity.id();
    identity.save(&social_root.join("identity.dpapi"))?;
    contacts.set("publicId", &own)?;
    contacts.set("name", &name)?;
    contacts.set("enabled", "false")?;
    contacts.set_privacy(&Privacy {
        notifications: true,
        public_relays: false,
        ..Privacy::default()
    })?;
    let display = format!("{} · вы", name.chars().take(40).collect::<String>());
    contacts.incoming(&own, &display)?;
    contacts.accept(&own)?;
    contacts.set_profile(&own, &display, &avatar)?;
    if let Some(avatar) = &avatar {
        contacts.set("avatar", avatar)?;
    }
    let outgoing = engine
        .send_screenshots(&own, std::slice::from_ref(&shot.id))
        .await?
        .remove(0);
    let photos = Photos::new(social_root.join("photos"), Arc::new(Mutex::new(())));
    let peer = Photos::new(session.join("local-peer"), Arc::new(Mutex::new(())));
    let incoming = peer
        .enqueue(
            &own,
            &own,
            vec![NewPhoto {
                source_id: None,
                name: shot.name,
                profile_name: shot.profile_name,
                width: shot.width,
                height: shot.height,
                bytes: source.1,
            }],
        )?
        .remove(0);
    let offer = peer.entry(&incoming)?.context("Missing local offer")?.offer;
    let marker = session.join("preview.json");
    let record = |phase: &str| -> anyhow::Result<()> {
        fs::write(
            &marker,
            serde_json::to_vec_pretty(
                &serde_json::json!({"phase":phase,"gameRoot":game,"outgoing":outgoing,"incoming":incoming,"file":filename,"name":display}),
            )?,
        )?;
        Ok(())
    };
    record("prepared")?;
    println!("Prepared native self-preview in {}", session.display());
    let deadline = Instant::now() + Duration::from_secs(7200);
    while !session.join("show-request").is_file() {
        if preview_closed(&session) {
            record("closed")?;
            return Ok(());
        }
        ensure!(Instant::now() < deadline, "Self-preview was not opened");
        std::thread::sleep(Duration::from_millis(200));
    }
    photos.receive_offer(offer.clone(), &own, &own)?;
    photos.update(&outgoing, "awaiting", 0, None)?;
    record("awaiting-decision")?;
    while Instant::now() < deadline {
        if preview_closed(&session) {
            record("closed")?;
            return Ok(());
        }
        let entry = photos
            .entry(&incoming)?
            .context("Preview request removed")?;
        match entry.decision {
            Some(true) => {
                photos.record_answer(&outgoing, true)?;
                // Give the renderer a chance to display acceptance before durable completion.
                std::thread::sleep(Duration::from_millis(900));
                let mut file = fs::File::create(photos.partial(&incoming)?)?;
                file.write_all(&fs::read(peer.path(&incoming)?)?)?;
                file.sync_all()?;
                drop(file);
                photos.commit_received(&incoming)?;
                photos.update(&outgoing, "delivered", offer.bytes, None)?;
                record("accepted-and-saved")?;
                println!("Self-preview accepted and saved; source game files were untouched");
                return Ok(());
            }
            Some(false) => {
                photos.record_answer(&outgoing, false)?;
                record("declined")?;
                println!("Self-preview declined; no received image was saved");
                return Ok(());
            }
            None => std::thread::sleep(Duration::from_millis(250)),
        }
    }
    anyhow::bail!("Self-preview timed out waiting for the user's decision")
}
