//! Java-only Social adapter: explicit review, provider resolution and staged installs.
#[cfg(feature = "social-lab")]
pub mod lab;
use crate::{
    catalog::{cf_version, mr_version, MODRINTH},
    model::*,
    Engine, Task,
};
use anyhow::{bail, Context, Result};
use aurum_social::{
    manifest::{self, Manifest, SharedFile, Source},
    world::WorldSpec,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::Duration,
};
use tokio::io::AsyncWriteExt;
pub fn normalize_avatar(bytes: &[u8]) -> Result<String> {
    use base64::Engine as _;
    if bytes.len() > 8 * 1024 * 1024 {
        bail!("Avatar image exceeds 8 MiB");
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()?
        .resize_to_fill(64, 64, image::imageops::FilterType::Lanczos3)
        .to_rgb8();
    for quality in [80, 65, 45, 25, 10] {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality)
            .encode_image(&image)?;
        if jpeg.len() <= 2400 {
            return Ok(format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(jpeg)
            ));
        }
    }
    bail!("Avatar could not be compressed")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    pub manifest: Manifest,
    pub excluded: Vec<String>,
    pub potential_secrets: Vec<String>,
}
pub struct ShareOptions {
    pub configs: bool,
    pub sensitive: bool,
    pub with_pack: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanItem {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub sha256: Option<String>,
    pub sha1: String,
    pub source: Option<Source>,
    pub url: Option<String>,
    pub page: String,
    pub config: Option<Vec<u8>>,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallPlan {
    pub version: u8,
    pub created: u64,
    pub invitation: String,
    pub sender: String,
    pub world: WorldSpec,
    pub manifest_digest: String,
    pub items: Vec<PlanItem>,
    pub warnings: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    pub plan: InstallPlan,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub profile_id: String,
    pub missing: usize,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u8,
    plan: String,
    profile: Profile,
    complete: bool,
}

impl Engine {
    pub async fn social_pending(&self) -> Result<Vec<Review>> {
        let directory = self.root.join("social/installations");
        if !directory.is_dir() {
            return Ok(Vec::new());
        }
        let mut entries = tokio::fs::read_dir(directory).await?;
        let mut reviews = Vec::new();
        let mut inspected = 0;
        while let Some(entry) = entries.next_entry().await? {
            inspected += 1;
            if inspected > 256 {
                break;
            }
            if !entry.file_type().await?.is_file()
                || entry.metadata().await?.len() > 2 * 1024 * 1024
            {
                continue;
            }
            let Ok(journal) =
                serde_json::from_slice::<Journal>(&tokio::fs::read(entry.path()).await?)
            else {
                continue;
            };
            if journal.complete {
                continue;
            }
            if validate_hash(&journal.plan, 64).is_err() {
                continue;
            }
            let path = self
                .root
                .join("social/plans")
                .join(format!("{}.json", journal.plan));
            if !path.is_file() || tokio::fs::metadata(&path).await?.len() > 8 * 1024 * 1024 {
                continue;
            }
            let bytes = tokio::fs::read(path).await?;
            if format!("{:x}", Sha256::digest(&bytes)) != journal.plan {
                continue;
            }
            let Ok(plan) = serde_json::from_slice::<InstallPlan>(&bytes) else {
                continue;
            };
            if validate_plan(&plan).is_ok() {
                reviews.push(Review {
                    id: journal.plan,
                    plan,
                });
            }
            if reviews.len() >= 32 {
                break;
            }
        }
        Ok(reviews)
    }
    pub async fn social_task(&self, id: String) -> Result<Task> {
        let task = self.task(id, None).await?;
        self.social_tasks.lock().await.insert(task.id.clone());
        Ok(task)
    }
    pub async fn finish_social_task(&self, task: &Task, result: &Result<()>) {
        self.finish(task, result).await;
        self.social_tasks.lock().await.remove(&task.id);
    }
    pub async fn cancel_social_tasks(&self) {
        let ids = self.social_tasks.lock().await.clone();
        let tasks = self.operations.lock().await;
        for id in ids {
            if let Some(cancel) = tasks.get(&id) {
                cancel.store(true, Ordering::Release);
            }
        }
    }
    pub async fn social_plan_cancellable(&self, id: &str, task: &Task) -> Result<Review> {
        let future = self.social_plan(id);
        tokio::pin!(future);
        tokio::select! {result=&mut future=>result,_=async{loop{if task.cancel.load(Ordering::Acquire)||!self.social.is_enabled(){break;}tokio::time::sleep(Duration::from_millis(20)).await;}}=>bail!("Social review cancelled")}
    }
    pub async fn social_export(&self, id: &str, configs: bool, sensitive: bool) -> Result<Export> {
        self.social_export_checked(id, configs, sensitive, None)
            .await
    }
    pub async fn social_export_checked(
        &self,
        id: &str,
        configs: bool,
        sensitive: bool,
        cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    ) -> Result<Export> {
        let p = self.profile(id).await?;
        if p.engine != Runtime::Java {
            bail!("Social does not support Horizon worlds or native mods yet");
        }
        let root = self.instance(id)?;
        let content = self.list_content(id).await?;
        tokio::task::spawn_blocking(move || -> Result<Export> {
            let check = || -> Result<()> {
                if cancel.as_ref().is_some_and(|c| c.load(Ordering::Acquire)) {
                    bail!("Social export cancelled");
                }
                Ok(())
            };
            let mut result = Export {
                manifest: Manifest {
                    version: 1,
                    name: p.name,
                    minecraft: p.minecraft,
                    loader: p.loader.key().into(),
                    loader_version: p.loader_version,
                    files: Vec::new(),
                },
                excluded: Vec::new(),
                potential_secrets: Vec::new(),
            };
            for c in content.into_iter().filter(|c| c.enabled) {
                check()?;
                if result.manifest.files.len() >= 2000 {
                    bail!("Too many shared files");
                }
                let path = format!("{}/{}", crate::content::folder(&c.kind)?, c.filename);
                let file = manifest::no_links(&root, &path)?;
                let before = std::fs::metadata(&file)?;
                if before.len() > 2 * 1024 * 1024 * 1024 {
                    bail!("A shared file exceeds 2 GiB");
                }
                let sha256 = manifest::hash_file_checked(&file, check)?;
                let after = std::fs::metadata(&file)?;
                if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
                    bail!("Profile changed while preparing its manifest; retry");
                }
                let source = if ["modrinth", "curseforge"].contains(&c.source.as_str())
                    && !c.project_id.is_empty()
                    && !c.version_id.is_empty()
                {
                    Some(Source {
                        provider: c.source,
                        project_id: c.project_id,
                        version_id: c.version_id,
                    })
                } else {
                    None
                };
                result.manifest.files.push(SharedFile {
                    path,
                    bytes: before.len(),
                    sha256,
                    source,
                    config: None,
                });
            }
            if configs {
                let mut total = 0usize;
                let mut scanned = 0usize;
                for directory in ["config", "defaultconfigs"] {
                    let base = root.join(directory);
                    if !base.exists() {
                        continue;
                    }
                    for entry in walkdir::WalkDir::new(&base)
                        .follow_links(false)
                        .max_depth(12)
                        .max_open(8)
                    {
                        let entry = entry?;
                        check()?;
                        scanned += 1;
                        if scanned > 4096 || result.manifest.files.len() >= 2000 {
                            bail!("Too many config entries to share safely");
                        }
                        let relative = entry
                            .path()
                            .strip_prefix(&root)?
                            .to_string_lossy()
                            .replace('\\', "/");
                        if entry.file_type().is_symlink() {
                            bail!("Linked configs cannot be shared");
                        }
                        if entry.file_type().is_dir() {
                            continue;
                        }
                        let file = manifest::no_links(&root, &relative)?;
                        if std::fs::metadata(&file)?.len() > 64 * 1024 {
                            result.excluded.push(relative);
                            continue;
                        }
                        let bytes = std::fs::read(&file)?;
                        if total + bytes.len() > 256 * 1024 {
                            result.excluded.push(relative);
                            continue;
                        }
                        if manifest::potential_secret(&bytes) {
                            result.potential_secrets.push(relative.clone());
                            if !sensitive {
                                result.excluded.push(relative);
                                continue;
                            }
                        }
                        total += bytes.len();
                        result.manifest.files.push(SharedFile {
                            path: relative,
                            bytes: bytes.len() as u64,
                            sha256: format!("{:x}", Sha256::digest(&bytes)),
                            source: None,
                            config: Some(bytes),
                        });
                    }
                }
            }
            result.manifest.files.sort_by(|a, b| a.path.cmp(&b.path));
            result.manifest.validate()?;
            Ok(result)
        })
        .await?
    }
    pub async fn social_invite(
        &self,
        profile: &str,
        friend: &str,
        port: Option<u16>,
        sharing: ShareOptions,
        task: &Task,
    ) -> Result<()> {
        let p = self.profile(profile).await?;
        let mut listeners = self.social_lan_listeners(profile).await?;
        if let Some(port) = port {
            listeners.retain(|l| l.address.port() == port);
        }
        if listeners.len() != 1 {
            bail!("Open your world to LAN, then select its current port if more than one is found");
        }
        task.check()?;
        let exported = if sharing.with_pack {
            Some(
                self.social_export_checked(
                    profile,
                    sharing.configs,
                    sharing.sensitive,
                    Some(task.cancel.clone()),
                )
                .await?
                .manifest,
            )
        } else {
            None
        };
        task.check()?;
        if !self.social.is_enabled() {
            bail!("Social was disabled");
        }
        let social = self.social.clone();
        let friend = friend.to_owned();
        let listener = listeners.remove(0);
        let id = tokio::task::spawn_blocking(move || {
            social.invite(
                &friend,
                WorldSpec {
                    name: p.name,
                    minecraft: p.minecraft,
                    loader: p.loader.key().into(),
                    loader_version: p.loader_version,
                },
                listener,
                exported,
            )
        })
        .await??;
        task.progress("social-invite", "Waiting for invitation receipt", 0, 1);
        let until = tokio::time::Instant::now()
            + Duration::from_secs(if sharing.with_pack { 180 } else { 45 });
        while self.social.delivery(&id) != Some(true) {
            if let Err(error) = task.check() {
                let _ = self.social.cancel_offer(id);
                return Err(error);
            }
            if !self.social.is_enabled() {
                bail!("Social was disabled");
            }
            if tokio::time::Instant::now() > until {
                let _ = self.social.cancel_offer(id);
                bail!(
                    "Invitation was not delivered. Check that your friend is online and try again."
                );
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }
    pub async fn social_plan(&self, invitation: &str) -> Result<Review> {
        let incoming = self
            .social
            .snapshot()?
            .invitations
            .into_iter()
            .find(|i| i.offer.id == invitation)
            .context("Invitation is no longer available")?;
        incoming.offer.validate()?;
        let manifest = incoming
            .manifest
            .context("Shared manifest has not finished loading")?;
        manifest.validate()?;
        let engine = self.social_http()?;
        let world = incoming.offer.world.clone();
        let profile = preview_profile(&world)?;
        let mut items = Vec::new();
        let mut queue = VecDeque::new();
        let mut seen = HashMap::<(String, String), String>::new();
        let mut warnings = Vec::new();
        let mut conflicts = HashSet::new();
        for f in &manifest.files {
            if let Some(bytes) = &f.config {
                items.push(PlanItem {
                    path: f.path.clone(),
                    name: f.path.clone(),
                    bytes: f.bytes,
                    sha256: Some(f.sha256.clone()),
                    sha1: String::new(),
                    source: None,
                    url: None,
                    page: String::new(),
                    config: Some(bytes.clone()),
                    required: false,
                });
            } else if let Some(source) = &f.source {
                queue.push_back((source.clone(), Some(f.clone())));
            } else {
                warnings.push(format!("{}: add the exact local file manually", f.path));
                items.push(PlanItem {
                    path: f.path.clone(),
                    name: f.path.rsplit('/').next().unwrap_or(&f.path).into(),
                    bytes: f.bytes,
                    sha256: Some(f.sha256.clone()),
                    sha1: String::new(),
                    source: None,
                    url: None,
                    page: String::new(),
                    config: None,
                    required: false,
                });
            }
        }
        while let Some((source, shared)) = queue.pop_front() {
            if items.len() + queue.len() > 2000 {
                bail!("Dependency closure exceeds 2000 files");
            }
            let key = (source.provider.clone(), source.project_id.clone());
            if let Some(version) = seen.get(&key) {
                if version != &source.version_id {
                    bail!("Conflicting versions in the shared dependency closure");
                }
                continue;
            }
            seen.insert(key, source.version_id.clone());
            validate_source(&source)?;
            let (raw, kind, name) = if source.provider == "modrinth" {
                let raw = engine
                    .json(&format!("{MODRINTH}/version/{}", source.version_id))
                    .await?;
                if raw["project_id"].as_str() != Some(&source.project_id) {
                    bail!("Modrinth version belongs to a different project");
                }
                let project = engine
                    .json(&format!("{MODRINTH}/project/{}", source.project_id))
                    .await?;
                (
                    raw,
                    project["project_type"]
                        .as_str()
                        .context("Missing project type")?
                        .to_owned(),
                    project["title"]
                        .as_str()
                        .unwrap_or(&source.project_id)
                        .to_owned(),
                )
            } else {
                let raw = engine
                    .cf(&format!(
                        "/mods/{}/files/{}",
                        source.project_id, source.version_id
                    ))
                    .await?;
                let raw = raw["data"].clone();
                if raw["modId"].as_u64() != Some(source.project_id.parse()?) {
                    bail!("CurseForge file belongs to a different project");
                }
                let project = engine.cf(&format!("/mods/{}", source.project_id)).await?;
                let project = crate::catalog::cf_project(&project["data"]);
                (raw, project.kind, project.title)
            };
            let version = if source.provider == "modrinth" {
                mr_version(&raw)
            } else {
                cf_version(&raw)
            };
            if !crate::content::compatible(&version, &profile, &kind) {
                bail!("{name}: incompatible with the shared Minecraft/loader version");
            }
            let directory = crate::content::folder(&kind)?;
            let (filename, url, bytes, sha1) = if source.provider == "modrinth" {
                let files = raw["files"].as_array().context("Missing version files")?;
                let expected = shared.as_ref().and_then(|f| f.path.rsplit('/').next());
                let file = files
                    .iter()
                    .find(|f| f["filename"].as_str() == expected)
                    .or_else(|| files.iter().find(|f| f["primary"] == true))
                    .or_else(|| files.first())
                    .context("Empty version files")?;
                (
                    file["filename"]
                        .as_str()
                        .context("Missing filename")?
                        .to_owned(),
                    file["url"].as_str().map(str::to_owned),
                    file["size"].as_u64().context("Missing file size")?,
                    file["hashes"]["sha1"]
                        .as_str()
                        .context("Missing provider SHA-1")?
                        .to_owned(),
                )
            } else {
                (
                    raw["fileName"]
                        .as_str()
                        .context("Missing filename")?
                        .to_owned(),
                    raw["downloadUrl"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned),
                    raw["fileLength"].as_u64().context("Missing file size")?,
                    raw["hashes"]
                        .as_array()
                        .and_then(|a| a.iter().find(|h| h["algo"] == 1))
                        .and_then(|h| h["value"].as_str())
                        .context("Missing provider SHA-1")?
                        .to_owned(),
                )
            };
            let path = shared
                .as_ref()
                .map(|f| f.path.clone())
                .unwrap_or_else(|| format!("{directory}/{filename}"));
            manifest::safe_path(&path)?;
            if path.split('/').next() != Some(directory)
                || filename.contains(['/', '\\'])
                || sha1.len() != 40
                || !sha1.bytes().all(|c| c.is_ascii_hexdigit())
                || bytes > 2 * 1024 * 1024 * 1024
            {
                bail!("Invalid provider file metadata");
            }
            if shared.as_ref().is_some_and(|f| f.bytes != bytes) {
                bail!("The provider file size differs from the sender's manifest; request an updated invitation");
            }
            let url = match url {
                Some(url) => {
                    if approved_cdn(&url).is_ok() {
                        Some(url)
                    } else {
                        warnings.push(format!(
                            "{path}: provider download requires manual verification"
                        ));
                        None
                    }
                }
                None => None,
            };
            let page = if source.provider == "modrinth" {
                format!(
                    "https://modrinth.com/project/{}/version/{}",
                    source.project_id, source.version_id
                )
            } else {
                format!(
                    "https://www.curseforge.com/projects/{}/files/{}",
                    source.project_id, source.version_id
                )
            };
            items.push(PlanItem {
                path,
                name,
                bytes,
                sha256: shared.as_ref().map(|f| f.sha256.clone()),
                sha1,
                source: Some(source.clone()),
                url,
                page,
                config: None,
                required: shared.is_none(),
            });
            if let Some(deps) = raw["dependencies"].as_array() {
                for dep in deps {
                    let required = if source.provider == "modrinth" {
                        dep["dependency_type"] == "required"
                    } else {
                        dep["relationType"] == 3
                    };
                    if source.provider == "modrinth" && dep["dependency_type"] == "incompatible" {
                        if let Some(project) = dep["project_id"].as_str() {
                            conflicts.insert((source.provider.clone(), project.to_owned()));
                        }
                    }
                    if !required {
                        continue;
                    }
                    let dependency = if source.provider == "modrinth" {
                        if let Some(v) = dep["version_id"].as_str() {
                            crate::store::validate_version(v)?;
                            let version = engine.json(&format!("{MODRINTH}/version/{v}")).await?;
                            Source {
                                provider: source.provider.clone(),
                                project_id: version["project_id"]
                                    .as_str()
                                    .context("Missing dependency project")?
                                    .into(),
                                version_id: v.into(),
                            }
                        } else {
                            let project = dep["project_id"]
                                .as_str()
                                .context("Required local dependency must be added manually")?;
                            crate::store::validate_version(project)?;
                            let versions = engine
                                .mr_versions(project, Some(&world.minecraft), Some(&world.loader))
                                .await?;
                            let version = versions
                                .first()
                                .context("Required dependency has no compatible version")?;
                            Source {
                                provider: source.provider.clone(),
                                project_id: project.into(),
                                version_id: version["id"]
                                    .as_str()
                                    .context("Missing dependency version")?
                                    .into(),
                            }
                        }
                    } else {
                        let project = dep["modId"]
                            .as_u64()
                            .context("Missing dependency mod ID")?
                            .to_string();
                        let versions = engine
                            .cf_versions(&project, Some(&world.minecraft), Some(&world.loader))
                            .await?;
                        let version = versions
                            .first()
                            .context("Required dependency has no compatible version")?;
                        Source {
                            provider: source.provider.clone(),
                            project_id: project,
                            version_id: version["id"]
                                .as_u64()
                                .context("Missing dependency version")?
                                .to_string(),
                        }
                    };
                    // Prefer the sender's exact required version if it is already in this manifest.
                    if let Some(exact) = manifest
                        .files
                        .iter()
                        .filter_map(|f| f.source.as_ref())
                        .find(|s| {
                            s.provider == dependency.provider
                                && s.project_id == dependency.project_id
                        })
                    {
                        if dep["version_id"].is_string()
                            && exact.version_id != dependency.version_id
                        {
                            bail!("An exact dependency version conflicts with the shared profile");
                        }
                        queue.push_back((exact.clone(), None));
                    } else {
                        queue.push_back((dependency, None));
                    }
                }
            }
        }
        if conflicts.iter().any(|key| seen.contains_key(key)) {
            bail!("The resolved shared profile contains incompatible projects");
        }
        let mut paths = HashSet::new();
        for item in &items {
            if !paths.insert(item.path.to_ascii_lowercase()) {
                bail!("Resolved dependency filenames collide");
            }
        }
        items.sort_by(|a, b| a.path.cmp(&b.path));
        let plan = InstallPlan {
            version: 1,
            created: crate::now(),
            invitation: invitation.into(),
            sender: incoming.from,
            world,
            manifest_digest: manifest.digest()?,
            items,
            warnings,
        };
        validate_plan(&plan)?;
        let bytes = serde_json::to_vec(&plan)?;
        let id = format!("{:x}", Sha256::digest(&bytes));
        let folder = self.root.join("social/plans");
        tokio::fs::create_dir_all(&folder).await?;
        tokio::fs::write(folder.join(format!("{id}.json")), bytes).await?;
        Ok(Review { id, plan })
    }
    fn social_http(&self) -> Result<Self> {
        let mut engine = self.clone();
        engine.http = reqwest::Client::builder()
            .no_proxy()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .user_agent("Aurum Social (+https://github.com/d3ede/aurum-launcher)")
            .build()?;
        Ok(engine)
    }
    pub async fn social_install(
        &self,
        plan_id: &str,
        task: &Task,
        accepted: bool,
    ) -> Result<InstallResult> {
        if !accepted {
            bail!("Review and accept the complete file/dependency plan first");
        }
        validate_hash(plan_id, 64)?;
        let path = self
            .root
            .join("social/plans")
            .join(format!("{plan_id}.json"));
        if tokio::fs::metadata(&path).await?.len() > 8 * 1024 * 1024 {
            bail!("Install plan exceeds limit");
        }
        let bytes = tokio::fs::read(&path).await?;
        if format!("{:x}", Sha256::digest(&bytes)) != plan_id {
            bail!("The reviewed install plan changed");
        }
        let plan: InstallPlan = serde_json::from_slice(&bytes)?;
        validate_plan(&plan)?;
        let engine = self.social_http()?;
        let cancelled = task.cancel.clone();
        let future = engine.install_social_plan(plan_id, &plan, task);
        tokio::pin!(future);
        tokio::select! {result=&mut future=>result,_=async{loop{if cancelled.load(Ordering::Acquire){break;}tokio::time::sleep(Duration::from_millis(20)).await;}}=>bail!("Social installation cancelled; verified cache and install journal retained")}
    }
    async fn install_social_plan(
        &self,
        id: &str,
        plan: &InstallPlan,
        task: &Task,
    ) -> Result<InstallResult> {
        let stage = self.root.join("staging").join(format!("social-{id}"));
        let journal_path = self
            .root
            .join("social/installations")
            .join(format!("{id}.json"));
        tokio::fs::create_dir_all(journal_path.parent().unwrap()).await?;
        let mut journal = if journal_path.exists() {
            let bytes = tokio::fs::read(&journal_path).await?;
            if bytes.len() > 2 * 1024 * 1024 {
                bail!("Install journal exceeds limit");
            }
            let journal: Journal = serde_json::from_slice(&bytes)?;
            if journal.plan != id
                || journal.version != 1
                || uuid::Uuid::parse_str(&journal.profile.id).is_err()
            {
                bail!("Invalid Social install journal");
            }
            journal
        } else {
            let mut profile = preview_profile(&plan.world)?;
            profile.id = uuid::Uuid::new_v4().to_string();
            profile.name = format!("{} · Social", plan.world.name);
            Journal {
                version: 1,
                plan: id.into(),
                profile,
                complete: false,
            }
        };
        if journal.complete {
            let p = self.profile(&journal.profile.id).await?;
            return Ok(InstallResult {
                profile_id: p.id,
                missing: p.manual_downloads.len(),
            });
        }
        write_journal(&journal_path, &journal).await?;
        if self
            .db
            .lock()
            .await
            .profiles
            .iter()
            .any(|p| p.id == journal.profile.id)
        {
            let profile = self.profile(&journal.profile.id).await?;
            if profile.manual_downloads.is_empty() {
                self.install(&profile.id, task).await?;
            }
            journal.complete = true;
            write_journal(&journal_path, &journal).await?;
            return Ok(InstallResult {
                profile_id: profile.id,
                missing: profile.manual_downloads.len(),
            });
        }
        let game = stage.join("game");
        tokio::fs::create_dir_all(&game).await?;
        let cache = self.root.join("cache/social-content");
        tokio::fs::create_dir_all(&cache).await?;
        for (index, item) in plan.items.iter().enumerate() {
            task.check()?;
            task.progress(
                "content",
                format!("Preparing {}", item.name),
                index as u64,
                plan.items.len() as u64,
            );
            let target = crate::safe_join(&game, &item.path)?;
            tokio::fs::create_dir_all(target.parent().unwrap()).await?;
            if let Some(bytes) = &item.config {
                tokio::fs::write(&target, bytes).await?;
                continue;
            }
            let cache_key = item
                .sha256
                .clone()
                .unwrap_or_else(|| format!("sha1-{}", item.sha1));
            let cached = cache.join(cache_key);
            let good =
                |path: PathBuf| async move { verify_item(&path, item).await.unwrap_or(false) };
            if !good(cached.clone()).await {
                // Reuse an exact verified file from another local profile before downloading.
                let profiles = self.db.lock().await.profiles.clone();
                let mut reused = false;
                'profiles: for profile in profiles.iter().take(512) {
                    for c in &profile.content {
                        if let (Some(source), true) = (&item.source, c.enabled) {
                            if c.source == source.provider
                                && c.project_id == source.project_id
                                && c.version_id == source.version_id
                            {
                                let root = self.instance(&profile.id)?;
                                let relative =
                                    format!("{}/{}", crate::content::folder(&c.kind)?, c.filename);
                                if let Ok(path) = manifest::no_links(&root, &relative) {
                                    if good(path.clone()).await {
                                        tokio::fs::copy(path, &cached).await?;
                                        reused = true;
                                        break 'profiles;
                                    }
                                }
                            }
                        }
                    }
                }
                if !reused {
                    if let Some(url) = &item.url {
                        if let Err(error) = download_bounded(url, &cached, item, task).await {
                            task.check()?;
                            journal
                                .profile
                                .manual_downloads
                                .push(manual(item, &error.to_string()));
                            continue;
                        }
                    } else {
                        journal
                            .profile
                            .manual_downloads
                            .push(manual(item, "restricted"));
                        continue;
                    }
                }
            }
            if !good(cached.clone()).await {
                bail!("Verified content cache changed unexpectedly");
            }
            tokio::fs::copy(&cached, &target).await?;
            let source = item.source.as_ref();
            let kind = match item.path.split('/').next().unwrap_or("") {
                "mods" => "mod",
                "resourcepacks" => "resourcepack",
                "shaderpacks" => "shader",
                _ => bail!("Invalid content root"),
            };
            journal.profile.content.push(Content {
                id: source
                    .map(|s| format!("{}:{}", s.provider, s.project_id))
                    .unwrap_or_else(|| format!("local:{}", item.path)),
                source: source
                    .map(|s| s.provider.clone())
                    .unwrap_or_else(|| "local".into()),
                project_id: source.map(|s| s.project_id.clone()).unwrap_or_default(),
                version_id: source.map(|s| s.version_id.clone()).unwrap_or_default(),
                name: item.name.clone(),
                filename: item.path.rsplit('/').next().unwrap().into(),
                kind: kind.into(),
                enabled: true,
                info: ContentInfo {
                    sha1: item.sha1.clone(),
                    sha256: item.sha256.clone().unwrap_or_default(),
                    ..Default::default()
                },
            });
        }
        journal
            .profile
            .manual_downloads
            .sort_by(|a, b| a.path.cmp(&b.path));
        journal
            .profile
            .manual_downloads
            .dedup_by(|a, b| a.path == b.path);
        journal.profile.content.sort_by(|a, b| a.id.cmp(&b.id));
        journal.profile.content.dedup_by(|a, b| a.id == b.id);
        task.check()?;
        self.publish_profile(journal.profile.clone(), Some(&game))
            .await?;
        write_journal(&journal_path, &journal).await?;
        if journal.profile.manual_downloads.is_empty() {
            self.install(&journal.profile.id, task).await?;
        }
        journal.complete = true;
        write_journal(&journal_path, &journal).await?;
        Ok(InstallResult {
            profile_id: journal.profile.id,
            missing: journal.profile.manual_downloads.len(),
        })
    }
    pub async fn social_prepare(
        &self,
        invitation: &str,
        profile_id: Option<&str>,
        task: &Task,
    ) -> Result<String> {
        let _guard = self
            .busy
            .try_lock()
            .context("Wait for the current operation")?;
        validate_hash(invitation, 32)?;
        task.check()?;
        let incoming = self
            .social
            .snapshot()?
            .invitations
            .into_iter()
            .find(|i| i.offer.id == invitation)
            .context("Invitation expired")?;
        incoming.offer.validate()?;
        let world = incoming.offer.world;
        let preparation = self
            .root
            .join("social/preparations")
            .join(format!("{invitation}.json"));
        let saved = if profile_id.is_none() && preparation.is_file() {
            let bytes = tokio::fs::read(&preparation).await?;
            if bytes.len() > 128 {
                bail!("Invalid preparation journal");
            }
            let id: String = serde_json::from_slice(&bytes)?;
            uuid::Uuid::parse_str(&id)?;
            self.profile(&id).await.ok()
        } else {
            None
        };
        let p = if let Some(id) = profile_id {
            self.profile(id).await?
        } else if let Some(saved) = saved {
            saved
        } else {
            let created = self
                .create_profile(
                    world.name.clone(),
                    world.minecraft.clone(),
                    serde_json::from_value(Value::String(world.loader.clone()))?,
                    world.loader_version.clone(),
                    0,
                )
                .await?;
            tokio::fs::create_dir_all(preparation.parent().unwrap()).await?;
            tokio::fs::write(&preparation, serde_json::to_vec(&created.id)?).await?;
            created
        };
        if p.engine != Runtime::Java
            || p.minecraft != world.minecraft
            || p.loader.key() != world.loader
            || p.loader_version != world.loader_version
        {
            bail!("Select a Java profile with the same Minecraft and loader version");
        }
        if !p.manual_downloads.is_empty() {
            bail!("Add the missing files before joining this world");
        }
        if p.installed_version.is_none() {
            task.progress("social-prepare", "Preparing Minecraft", 0, 1);
            let engine = self.social_http()?;
            let future = engine.install(&p.id, task);
            tokio::pin!(future);
            tokio::select! {result=&mut future=>result?,_=async{loop{if task.cancel.load(Ordering::Acquire)||!self.social.is_enabled(){break;}tokio::time::sleep(Duration::from_millis(20)).await;}}=>bail!("Social game setup cancelled")};
        }
        Ok(p.id)
    }
    pub async fn social_join(&self, invitation: &str, profile_id: &str, task: &Task) -> Result<()> {
        let result = self.social_join_inner(invitation, profile_id, task).await;
        if result.is_err() {
            let _ = self.social.abandon_join(invitation.into());
        }
        result
    }
    async fn social_join_inner(
        &self,
        invitation: &str,
        profile_id: &str,
        task: &Task,
    ) -> Result<()> {
        {
            let db = self.db.lock().await;
            if !db
                .accounts
                .iter()
                .any(|a| Some(&a.id) == db.selected_account.as_ref())
            {
                bail!("Add and select a player account before joining");
            }
        }
        let incoming = self
            .social
            .snapshot()?
            .invitations
            .into_iter()
            .find(|i| i.offer.id == invitation)
            .context("Invitation expired")?;
        incoming.offer.validate()?;
        let p = self.profile(profile_id).await?;
        if p.engine != Runtime::Java
            || p.minecraft != incoming.offer.world.minecraft
            || p.loader.key() != incoming.offer.world.loader
            || p.loader_version != incoming.offer.world.loader_version
        {
            bail!("Select a Java profile with the same Minecraft and loader version");
        }
        if !p.manual_downloads.is_empty() {
            bail!("Add the missing files before joining this world");
        }
        if p.installed_version.is_none() {
            let _guard = self
                .busy
                .try_lock()
                .context("Wait for the current operation")?;
            let engine = self.social_http()?;
            let installing = engine.install(profile_id, task);
            tokio::pin!(installing);
            tokio::select! {r=&mut installing=>r?,_=async{loop{if task.cancel.load(Ordering::Acquire)||!self.social.is_enabled(){break;}tokio::time::sleep(Duration::from_millis(20)).await;}}=>bail!("Social game setup cancelled")};
        }
        task.check()?;
        task.progress("social-connect", "Connecting to world", 0, 1);
        let service = self.social.clone();
        let join_id = invitation.to_string();
        tokio::task::spawn_blocking(move || service.join(join_id)).await??;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(100);
        let address = loop {
            task.check()?;
            let state = self.social.snapshot()?;
            if !state.enabled {
                bail!("Social was disabled");
            }
            let incoming = state
                .invitations
                .into_iter()
                .find(|i| i.offer.id == invitation)
                .context("Invitation revoked")?;
            if incoming.status == "unreachable" {
                bail!(
                    "Direct connection failed; enable a compatible VPN on both computers and retry"
                );
            }
            if incoming.status == "failed" {
                bail!(
                    "{}",
                    incoming.error.unwrap_or_else(|| "Invitation failed".into())
                );
            }
            if let Some(address) = incoming.join_address {
                break address;
            }
            if tokio::time::Instant::now() > deadline {
                bail!("World connection timed out");
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        let target = crate::servers::ServerAddress::parse(&address)?;
        let target_ip: std::net::IpAddr = target.host.parse()?;
        if !target_ip.is_loopback() {
            bail!("Social join address must be the local broker bridge");
        }
        tokio::time::timeout(Duration::from_secs(5), crate::servers::ping(&target))
            .await
            .context("The host did not respond through the game bridge")??;
        task.check()?;
        if !self.social.is_enabled() {
            bail!("Social was disabled");
        }
        task.progress("social-launch", "Starting Minecraft", 0, 1);
        self.launch_social_server(profile_id, &address, task).await
    }
}
fn manual(item: &PlanItem, reason: &str) -> PackManualDownload {
    PackManualDownload {
        name: item.name.clone(),
        path: item.path.clone(),
        url: item.page.clone(),
        sha1: item.sha1.clone(),
        sha256: item.sha256.clone(),
        reason: if item.source.is_none() {
            "local".into()
        } else if reason == "restricted" {
            "restricted".into()
        } else {
            "download".into()
        },
    }
}
fn preview_profile(world: &WorldSpec) -> Result<Profile> {
    world.validate()?;
    let loader: Loader = serde_json::from_value(Value::String(world.loader.clone()))?;
    Ok(Profile {
        engine: Runtime::Java,
        id: String::new(),
        name: world.name.clone(),
        minecraft: world.minecraft.clone(),
        loader,
        loader_version: world.loader_version.clone(),
        installed_version: None,
        ram_mb: None,
        jvm_args: String::new(),
        last_played: None,
        cover: 0,
        icon: None,
        icon_style: None,
        content: Vec::new(),
        manual_downloads: Vec::new(),
    })
}
fn validate_source(source: &Source) -> Result<()> {
    crate::store::validate_version(&source.project_id)?;
    crate::store::validate_version(&source.version_id)?;
    if !["modrinth", "curseforge"].contains(&source.provider.as_str()) {
        bail!("Unknown Social source");
    }
    if source.provider == "curseforge"
        && (!source.project_id.bytes().all(|c| c.is_ascii_digit())
            || !source.version_id.bytes().all(|c| c.is_ascii_digit()))
    {
        bail!("Invalid CurseForge IDs");
    }
    Ok(())
}
fn validate_hash(hash: &str, len: usize) -> Result<()> {
    if hash.len() != len || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("Invalid integrity hash");
    }
    Ok(())
}
fn validate_plan(plan: &InstallPlan) -> Result<()> {
    plan.world.validate()?;
    validate_hash(&plan.manifest_digest, 64)?;
    aurum_social::identity::decode_id(&plan.sender)?;
    if plan.version != 1 || plan.items.len() > 2000 {
        bail!("Unsupported Social install plan");
    }
    let mut paths = HashSet::new();
    let mut bytes = 0u64;
    let mut configs = 0usize;
    for item in &plan.items {
        manifest::safe_path(&item.path)?;
        if !paths.insert(item.path.to_ascii_lowercase()) {
            bail!("Plan path collision");
        }
        if item.bytes > 2 * 1024 * 1024 * 1024 {
            bail!("Plan file exceeds limit");
        }
        bytes = bytes
            .checked_add(item.bytes)
            .context("Plan size overflow")?;
        if let Some(hash) = &item.sha256 {
            validate_hash(hash, 64)?;
        }
        if let Some(source) = &item.source {
            validate_source(source)?;
            validate_hash(&item.sha1, 40)?;
        }
        if let Some(url) = &item.url {
            approved_cdn(url)?;
        }
        if let Some(config) = &item.config {
            if !(item.path.starts_with("config/") || item.path.starts_with("defaultconfigs/"))
                || config.len() > 64 * 1024
                || config.len() as u64 != item.bytes
                || Some(format!("{:x}", Sha256::digest(config))) != item.sha256
            {
                bail!("Invalid reviewed config payload");
            }
            configs += config.len();
        } else if item.path.starts_with("config/") || item.path.starts_with("defaultconfigs/") {
            bail!("Config payload is missing");
        }
    }
    if bytes > 32 * 1024 * 1024 * 1024 || configs > 256 * 1024 {
        bail!("Plan exceeds byte limits");
    }
    Ok(())
}
async fn write_journal(path: &Path, journal: &Journal) -> Result<()> {
    let temp = path.with_extension("tmp");
    tokio::fs::write(&temp, serde_json::to_vec(journal)?).await?;
    tokio::fs::rename(temp, path).await?;
    Ok(())
}
async fn verify_item(path: &Path, item: &PlanItem) -> Result<bool> {
    if !path.is_file() || tokio::fs::metadata(path).await?.len() != item.bytes {
        return Ok(false);
    }
    if let Some(hash) = &item.sha256 {
        if !crate::net::verify(path, Some(("sha256", hash))).await? {
            return Ok(false);
        }
    }
    if !item.sha1.is_empty() && !crate::net::verify(path, Some(("sha1", &item.sha1))).await? {
        return Ok(false);
    }
    Ok(true)
}
fn approved_cdn(value: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(value)?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            url.host_str(),
            Some("cdn.modrinth.com" | "edge.forgecdn.net" | "mediafilez.forgecdn.net")
        )
    {
        bail!("Social downloads must use an approved provider CDN");
    }
    Ok(url)
}
fn public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let o = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && o[0] != 0
                && o[0] < 224
                && !(o[0] == 100 && (64..=127).contains(&o[1]))
                && !(o[0] == 198 && (o[1] == 18 || o[1] == 19))
        }
        std::net::IpAddr::V6(ip) => {
            ip.to_ipv4_mapped().is_none()
                && ip.segments()[0] & 0xe000 == 0x2000
                && ip.segments()[0] != 0x2002
                && !(ip.segments()[0] == 0x2001 && ip.segments()[1] < 0x0200)
                && !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
                && !ip.is_multicast()
                && !(ip.segments()[0] == 0x2001 && ip.segments()[1] == 0xdb8)
        }
    }
}
async fn download_bounded(value: &str, path: &Path, item: &PlanItem, task: &Task) -> Result<()> {
    let url = approved_cdn(value)?;
    let host = url.host_str().context("Missing CDN hostname")?;
    let addresses = tokio::net::lookup_host((host, 443))
        .await?
        .filter(|a| public_ip(a.ip()))
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        bail!("CDN resolved to no public addresses");
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .build()?;
    let temp = path.with_extension("part");
    let result: Result<()> = async {
        let response = client.get(url).send().await?;
        if !response.status().is_success() {
            bail!("Provider download returned {}", response.status());
        }
        if response.content_length().is_some_and(|n| n != item.bytes) {
            bail!("Provider download size changed");
        }
        let mut stream = response.bytes_stream();
        let mut file = tokio::fs::File::create(&temp).await?;
        let mut received = 0u64;
        while let Some(bytes) = stream.next().await {
            task.check()?;
            let bytes = bytes?;
            received = received
                .checked_add(bytes.len() as u64)
                .context("Download size overflow")?;
            if received > item.bytes {
                bail!("Download exceeds the reviewed size");
            }
            file.write_all(&bytes).await?;
        }
        file.sync_all().await?;
        drop(file);
        if received != item.bytes || !verify_item(&temp, item).await? {
            bail!("Downloaded file does not match the reviewed hashes");
        }
        task.check()?;
        tokio::fs::rename(&temp, path).await?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(temp).await;
    }
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn avatar_normalization_strips_metadata_and_bounds_peer_payload() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(128, 96, |x, y| {
            image::Rgba([(x * 17) as u8, (y * 29) as u8, (x ^ y) as u8, 120])
        }))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
        let avatar = super::normalize_avatar(png.get_ref()).unwrap();
        aurum_social::profile::validate_avatar(&Some(avatar.clone())).unwrap();
        assert!(avatar.len() <= 3250);
        assert!(super::normalize_avatar(b"not an image").is_err());
        assert!(super::normalize_avatar(&vec![0; 8 * 1024 * 1024 + 1]).is_err());
    }
    use super::*;
    #[test]
    fn peer_urls_cannot_select_arbitrary_hosts() {
        for url in [
            "http://cdn.modrinth.com/a",
            "https://localhost/a",
            "https://169.254.169.254/a",
            "https://cdn.modrinth.com.evil.test/a",
            "https://user@cdn.modrinth.com/a",
            "https://cdn.modrinth.com:444/a",
        ] {
            assert!(approved_cdn(url).is_err());
        }
        assert!(approved_cdn("https://cdn.modrinth.com/data/a/b.jar").is_ok());
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "fc00::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()));
        }
    }
    #[tokio::test]
    async fn export_excludes_worlds_and_sensitive_configs() {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
        let p = e
            .create_profile(
                "Social fixture".into(),
                "1.21.1".into(),
                Loader::Fabric,
                Some("0.16.9".into()),
                0,
            )
            .await
            .unwrap();
        let root = e.instance(&p.id).unwrap();
        tokio::fs::create_dir_all(root.join("config"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(root.join("saves/world"))
            .await
            .unwrap();
        tokio::fs::write(root.join("config/plain.toml"), b"enabled=true")
            .await
            .unwrap();
        tokio::fs::write(root.join("config/secret.toml"), b"api_key=fixture")
            .await
            .unwrap();
        tokio::fs::write(root.join("saves/world/level.dat"), b"world fixture")
            .await
            .unwrap();
        let export = e.social_export(&p.id, true, false).await.unwrap();
        assert_eq!(export.manifest.files.len(), 1);
        assert_eq!(export.manifest.files[0].path, "config/plain.toml");
        assert_eq!(export.potential_secrets, ["config/secret.toml"]);
        assert_eq!(
            e.social_export(&p.id, false, false)
                .await
                .unwrap()
                .manifest
                .files
                .len(),
            0
        );
    }
}
pub mod notification;
