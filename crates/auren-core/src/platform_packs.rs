//! Staged, cancellable installs. Remote manifests never execute installer scripts.
use crate::{model::*, pack_catalog::*, Engine, Task};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, io::Read, path::Path};

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackOptions {
    /// None uses the publisher's recommended/default optional components.
    pub optional: Option<Vec<String>>,
    #[serde(default)]
    pub manual_files: HashMap<String, String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionalComponent {
    pub id: String,
    pub name: String,
    pub description: String,
    pub selected: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualFile {
    pub id: String,
    pub name: String,
    pub url: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRequirements {
    pub optional: Vec<OptionalComponent>,
    pub manual_files: Vec<ManualFile>,
    pub file_count: usize,
}
struct FileSpec {
    name: String,
    url: String,
    hash: Option<(String, String)>,
    destination: String,
    archive: bool,
    browser: bool,
}
struct Plan {
    mc: String,
    loader: Loader,
    loader_version: Option<String>,
    ram: Option<u32>,
    files: Vec<FileSpec>,
    optional: Vec<OptionalComponent>,
    technic: bool,
}

fn loader(name: &str, version: &str, mc: &str) -> Result<(Loader, Option<String>)> {
    let kind = match name.to_ascii_lowercase().as_str() {
        "forge" | "minecraftforge" => Loader::Forge,
        "neoforge" => Loader::Neoforge,
        "fabric" | "fabric-loader" => Loader::Fabric,
        "quilt" | "quilt-loader" => Loader::Quilt,
        "" | "vanilla" => return Ok((Loader::Vanilla, None)),
        _ => bail!("Unsupported mod loader: {name}"),
    };
    let prefix = format!("{mc}-");
    let version = if kind == Loader::Forge {
        version.strip_prefix(&prefix).unwrap_or(version)
    } else {
        version
    };
    crate::store::validate_version(version)?;
    Ok((kind, Some(version.into())))
}
fn hash(v: &Value) -> Option<(String, String)> {
    for (key, len) in [("sha256", 64), ("sha1", 40), ("md5", 32)] {
        if let Some(h) = v[key]
            .as_str()
            .or(v["hashes"][key].as_str())
            .filter(|h| !h.is_empty())
        {
            if h.len() == len && h.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Some((key.into(), h.into()));
            }
        }
    }
    None
}
fn ftb_path(file: &Value) -> Result<String> {
    let directory = text(file, "path")
        .strip_prefix("./")
        .unwrap_or(text(file, "path"))
        .trim_end_matches('/');
    let name = text(file, "name");
    if name.contains('/') {
        bail!("Invalid FTB filename");
    }
    let path = if directory.is_empty() {
        name.into()
    } else {
        format!("{directory}/{name}")
    };
    crate::safe_join(Path::new("pack"), &path)?;
    Ok(path)
}

impl Engine {
    async fn platform_plan(
        &self,
        source: &str,
        project: &str,
        version: &str,
        options: &PackOptions,
    ) -> Result<Plan> {
        crate::store::validate_version(project)?;
        crate::store::validate_version(version)?;
        // Only versions actually exposed by this public project may be installed.
        let detail = self.pack_catalog_detail(source, project, None).await?;
        if !detail.versions.iter().any(|v| v.id == version) {
            bail!("Version does not belong to this public modpack");
        }
        let mut plan = Plan {
            mc: String::new(),
            loader: Loader::Vanilla,
            loader_version: None,
            ram: None,
            files: vec![],
            optional: vec![],
            technic: source == "technic",
        };
        match source {
            "ftb" => {
                let project: u64 = project.parse()?;
                let version: u64 = version.parse()?;
                let raw = self
                    .catalog_json(&format!("{FTB}/modpack/{project}/{version}"))
                    .await?;
                if raw["parent"].as_u64() != Some(project)
                    || raw["id"].as_u64() != Some(version)
                    || raw["private"] == true
                {
                    bail!("Invalid FTB version manifest");
                }
                let targets = raw["targets"].as_array().context("Missing FTB targets")?;
                if targets.iter().filter(|t| t["type"] == "modloader").count() > 1 {
                    bail!("This FTB pack requires multiple mod loaders unsupported by this build");
                }
                plan.mc = targets
                    .iter()
                    .find(|v| v["name"] == "minecraft" && v["type"] == "game")
                    .map(|v| text(v, "version").to_string())
                    .context("Missing Minecraft target")?;
                if let Some(target) = targets.iter().find(|v| v["type"] == "modloader") {
                    (plan.loader, plan.loader_version) =
                        loader(text(target, "name"), text(target, "version"), &plan.mc)?;
                }
                plan.ram = raw["specs"]["recommended"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok());
                for file in raw["files"].as_array().context("Missing FTB files")? {
                    if file["serveronly"] == true {
                        continue;
                    }
                    let destination = ftb_path(file)?;
                    if destination.starts_with("jarmods/") {
                        bail!("This legacy FTB pack requires custom jar patches unsupported by this build");
                    }
                    let mut url = text(file, "url").to_string();
                    if url.is_empty() {
                        // Respect CurseForge distribution policy rather than constructing CDN URLs.
                        if let (Some(p), Some(f)) = (
                            file["curseforge"]["project"].as_u64(),
                            file["curseforge"]["file"].as_u64(),
                        ) {
                            if let Ok(raw) = self.cf(&format!("/mods/{p}/files/{f}")).await {
                                url = text(&raw["data"], "downloadUrl").into();
                            }
                            if url.is_empty() {
                                url = format!(
                                    "https://www.curseforge.com/minecraft/mc-mods/{p}/download/{f}"
                                );
                            }
                        }
                    }
                    let browser = text(file, "url").is_empty()
                        && (url.is_empty() || url.contains("www.curseforge.com"));
                    let h = hash(file).context("Missing or invalid FTB file checksum")?;
                    plan.files.push(FileSpec {
                        name: text(file, "name").into(),
                        url,
                        hash: Some(h),
                        destination,
                        archive: false,
                        browser,
                    });
                }
            }
            "atlauncher" => {
                let raw = self
                    .catalog_json(&format!(
                        "{ATL_CDN}packs/{project}/versions/{version}/Configs.json"
                    ))
                    .await?;
                if raw["version"] != version {
                    bail!("Invalid ATLauncher version manifest");
                }
                plan.mc = text(&raw, "minecraft").into();
                let l = &raw["loader"];
                let name = text(l, "type");
                if !name.is_empty() {
                    let mut v = l["metadata"]["loader"]
                        .as_str()
                        .or(l["metadata"]["version"].as_str())
                        .unwrap_or("")
                        .to_string();
                    if v.is_empty()
                        && (l["metadata"]["recommended"] == true
                            || l["metadata"]["latest"] == true
                            || l["choose"] == true)
                    {
                        let (kind, _) = loader(name, "placeholder", &plan.mc)?;
                        v = self
                            .loader_versions(&plan.mc, kind)
                            .await?
                            .into_iter()
                            .next()
                            .context("No supported loader version")?;
                    }
                    (plan.loader, plan.loader_version) = loader(name, &v, &plan.mc)?;
                }
                plan.ram = raw["memory"].as_u64().and_then(|n| u32::try_from(n).ok());
                let mods = raw["mods"].as_array().context("Missing ATLauncher mods")?;
                let mut selected: Vec<String> = mods
                    .iter()
                    .filter(|m| {
                        m["client"] != false
                            && (m["optional"] != true
                                || options.optional.as_ref().map_or(
                                    m["selected"] == true || m["recommended"] == true,
                                    |ids| ids.iter().any(|id| id == text(m, "name")),
                                ))
                    })
                    .map(|m| text(m, "name").into())
                    .collect();
                // Optional selections can depend on other optional components.
                loop {
                    let before = selected.len();
                    for m in mods
                        .iter()
                        .filter(|m| selected.iter().any(|n| n == text(m, "name")))
                        .cloned()
                        .collect::<Vec<_>>()
                    {
                        for dep in m["depends"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                        {
                            if !selected.iter().any(|n| n == dep) {
                                selected.push(dep.into());
                            }
                        }
                    }
                    if selected.len() == before {
                        break;
                    }
                    if selected.len() > mods.len() + 100 {
                        bail!("Invalid optional dependencies");
                    }
                }
                for m in mods.iter().filter(|m| m["client"] != false) {
                    let name = text(m, "name");
                    if m["optional"] == true {
                        plan.optional.push(OptionalComponent {
                            id: name.into(),
                            name: name.into(),
                            description: text(m, "description").into(),
                            selected: selected.iter().any(|n| n == name),
                        });
                    }
                    if !selected.iter().any(|n| n == name) {
                        continue;
                    }
                    let kind = text(m, "type");
                    // Old packs sometimes declare Forge as a mod instead of a loader.
                    if kind == "forge" || (kind == "jar" && name == "Minecraft Forge") {
                        (plan.loader, plan.loader_version) =
                            loader("forge", text(m, "version"), &plan.mc)?;
                        continue;
                    }
                    let directory = match kind {
                        "mods" => "mods".into(), "coremods" => "coremods".into(),
                        "dependency" | "depandency" => format!("mods/{}",plan.mc),
                        "ic2lib" => "mods/ic2".into(), "denlib" => "mods/denlib".into(),
                        "flan" => "Flan".into(), "resourcepack" => "resourcepacks".into(),
                        "texturepack" => "texturepacks".into(),"shaderpack" => "shaderpacks".into(),
                        "root" => String::new(),
                        _ => bail!("{name}: this pack needs unsupported ATLauncher component type '{kind}'. Open its project page for alternatives."),
                    };
                    let file = text(m, "file");
                    if file.contains('/') {
                        bail!("Invalid ATLauncher filename");
                    }
                    let destination = if directory.is_empty() {
                        file.into()
                    } else {
                        format!("{directory}/{file}")
                    };
                    crate::safe_join(Path::new("pack"), &destination)?;
                    let download = text(m, "download");
                    let url = match download {
                        "server" => format!("{ATL_CDN}{}", text(m, "url")),
                        "direct" | "browser" => text(m, "url").into(),
                        _ => bail!("{name}: unsupported download method"),
                    };
                    plan.files.push(FileSpec {
                        name: name.into(),
                        url,
                        hash: hash(m),
                        destination,
                        archive: false,
                        browser: download == "browser",
                    });
                }
                if raw["noConfigs"] != true {
                    plan.files.push(FileSpec {
                        name: "Configs.zip".into(),
                        url: format!("{ATL_CDN}packs/{project}/versions/{version}/Configs.zip"),
                        hash: hash(&raw["configs"]),
                        destination: String::new(),
                        archive: true,
                        browser: false,
                    });
                }
                if raw["libraries"].as_array().is_some_and(|a| !a.is_empty()) {
                    bail!("This ATLauncher pack requires custom Java libraries and cannot be installed safely by this build");
                }
            }
            "technic" => {
                let raw = self.technic_pack(project).await?;
                plan.mc = text(&raw, "minecraft").into();
                if let Some(solder) = raw["solder"].as_str().filter(|s| !s.is_empty()) {
                    let raw = self
                        .catalog_json(&solder_url(solder, project, Some(version))?)
                        .await?;
                    plan.mc = raw["minecraft"].as_str().unwrap_or(&plan.mc).into();
                    if let Some(v) = raw["forge"].as_str().filter(|v| !v.is_empty()) {
                        (plan.loader, plan.loader_version) = loader("forge", v, &plan.mc)?;
                    }
                    plan.ram = raw["memory"].as_u64().and_then(|n| u32::try_from(n).ok());
                    for m in raw["mods"]
                        .as_array()
                        .context("Missing Solder components")?
                    {
                        plan.files.push(FileSpec {
                            name: text(m, "name").into(),
                            url: text(m, "url").into(),
                            hash: Some(hash(m).context("Invalid Solder checksum")?),
                            destination: String::new(),
                            archive: true,
                            browser: false,
                        });
                    }
                } else {
                    if raw["version"] != version {
                        bail!("Technic pack version changed; refresh the project");
                    }
                    plan.files.push(FileSpec {
                        name: "Modpack.zip".into(),
                        url: raw["url"]
                            .as_str()
                            .context("Pack download unavailable")?
                            .into(),
                        hash: None,
                        destination: String::new(),
                        archive: true,
                        browser: false,
                    });
                }
            }
            _ => bail!("Unknown modpack source"),
        }
        crate::store::validate_version(&plan.mc)?;
        if plan.files.len() > 25_000 {
            bail!("Too many pack files");
        }
        let mut destinations: HashMap<String, (String, Option<(String, String)>)> = HashMap::new();
        let mut unique = vec![];
        for f in plan.files {
            if !f.archive {
                if let Some((url, hash)) = destinations.get(&f.destination.to_ascii_lowercase()) {
                    if url == &f.url && hash == &f.hash {
                        continue;
                    }
                    bail!("Conflicting pack destination: {}", f.destination);
                }
                destinations.insert(
                    f.destination.to_ascii_lowercase(),
                    (f.url.clone(), f.hash.clone()),
                );
            }
            if f.browser {
                if f.hash.is_none() {
                    bail!("{}: manual download has no checksum", f.name);
                }
            } else {
                public_download_url(&f.url)?;
            }
            unique.push(f);
        }
        plan.files = unique;
        Ok(plan)
    }

    pub async fn pack_requirements(
        &self,
        source: &str,
        project: &str,
        version: &str,
        options: &PackOptions,
    ) -> Result<PackRequirements> {
        let plan = self
            .platform_plan(source, project, version, options)
            .await?;
        Ok(PackRequirements {
            file_count: plan.files.len(),
            optional: plan.optional,
            manual_files: plan
                .files
                .into_iter()
                .filter(|f| f.browser)
                .map(|f| ManualFile {
                    id: f.destination.clone(),
                    name: f.destination,
                    url: f.url,
                })
                .collect(),
        })
    }

    pub async fn download_platform_pack(
        &self,
        source: &str,
        project: &str,
        version: &str,
        task: &Task,
    ) -> Result<String> {
        self.download_platform_pack_with_options(
            source,
            project,
            version,
            &PackOptions::default(),
            task,
        )
        .await
    }

    pub async fn download_platform_pack_with_options(
        &self,
        source: &str,
        project: &str,
        version: &str,
        options: &PackOptions,
        task: &Task,
    ) -> Result<String> {
        task.check()?;
        let preparing = self.platform_plan(source, project, version, options);
        tokio::pin!(preparing);
        let plan = loop {
            tokio::select! {
                result=&mut preparing=>break result?,
                _=tokio::time::sleep(std::time::Duration::from_millis(200))=>task.check()?,
            }
        };
        let detail = self.pack_catalog_detail(source, project, None).await?;
        crate::store::validate_name(&detail.project.title)?;
        let id = uuid::Uuid::new_v4().to_string();
        let staging = self
            .root
            .join("staging")
            .join(&task.id)
            .join("platform-pack");
        let game = staging.join("game");
        tokio::fs::create_dir_all(&game).await?;
        let result: Result<()> = async {
            let mut extracted_bytes = 0;
            let file_count = plan.files.len();
            let title = &detail.project.title;
            let completed=std::sync::atomic::AtomicU64::new(0);
            // Bounded parallel downloads substantially reduce large FTB install times.
            use futures_util::{stream, FutureExt, StreamExt, TryStreamExt};
            let requests: Vec<_> = plan.files.iter().enumerate().map(|(i,f)| {
                let game=&game; let staging=&staging; let completed=&completed;
                async move {
                    task.check()?;
                    let dest = if f.archive {staging.join(format!("archive-{i}.zip"))} else {crate::safe_join(game,&f.destination)?};
                    let hash = f.hash.as_ref().map(|(a,h)|(a.as_str(),h.as_str()));
                    if f.browser {
                        let local = options.manual_files.get(&f.destination).context(format!("Download {} on the publisher's site and choose the file before installing",f.name))?;
                        tokio::fs::create_dir_all(dest.parent().unwrap()).await?;
                        tokio::fs::copy(local,&dest).await.with_context(||format!("Could not copy {}",f.name))?;
                        if !crate::net::verify(&dest,hash).await? {bail!("Checksum mismatch: {}",f.name);}
                    } else {
                        self.download(&f.url,&dest,hash,task).await.with_context(||format!("Could not download {}",f.name))?;
                    }
                    let done=completed.fetch_add(1,std::sync::atomic::Ordering::Relaxed)+1;
                    task.progress("pack",format!("{title} · {}",f.name),done,file_count as u64);
                    Ok::<_,anyhow::Error>((i,dest))
                }.boxed()
            }).collect();
            let downloads: Vec<_> = stream::iter(requests).buffer_unordered(6).try_collect().await?;
            let mut downloads = downloads;
            downloads.sort_by_key(|(i,_)|*i);
            for (i,path) in downloads {
                if plan.files[i].archive {
                    task.check()?;
                    extract_archive(&path,&game,task,&mut extracted_bytes)?;
                }
            }
            task.check()?;
            let mut mc = plan.mc;
            let mut l = plan.loader;
            let mut lv = plan.loader_version;
            if plan.technic {
                if let Some((detected_mc,detected_l,detected_lv)) = detect_technic_loader(&game,&mc)? {
                    mc=detected_mc;l=detected_l;lv=detected_lv;
                } else if l == Loader::Vanilla && game.join("mods").exists() {
                    bail!("Technic pack contains mods but no recognizable loader metadata. Open its project page for a supported distribution.");
                }
                // Metadata is consumed above; Aurum installs official loader binaries itself.
                if game.join("bin").exists() {tokio::fs::remove_dir_all(game.join("bin")).await?;}
            }
            crate::store::validate_version(&mc)?;
            if let Some(v)=&lv {crate::store::validate_version(v)?;}
            let profile = Profile {id:id.clone(),name:detail.project.title,minecraft:mc,loader:l,loader_version:lv,installed_version:None,
                ram_mb:plan.ram.filter(|n|(512..=131072).contains(n)),jvm_args:String::new(),last_played:None,cover:0,icon:None,icon_style:None,content:vec![]};
            // Download and normalize a small icon through the existing image validator.
            let mut profile=profile;
            if let Some(icon)=detail.project.icon {
                if public_download_url(&icon).is_ok() {
                    if let Ok(response)=self.http.get(&icon).timeout(std::time::Duration::from_secs(5)).send().await {
                        if response.status().is_success() && response.content_length().is_some_and(|n|n<=2_000_000) {
                            if let Ok(bytes)=response.bytes().await {
                                if bytes.len()<=2_000_000 {
                                    let path=staging.join("icon");
                                    if tokio::fs::write(&path,&bytes).await.is_ok() {
                                        profile.icon=crate::store::prepare_profile_icon(&path).ok();
                                    }
                                }
                            }
                        }
                    }
                }
            }
            task.check()?;
            self.publish_profile(profile, Some(&game)).await.context("Could not save installed pack profile")
        }.await;
        let _ = tokio::fs::remove_dir_all(&staging).await;
        result?;
        Ok(id)
    }
}

fn public_download_url(url: &str) -> Result<()> {
    let url = reqwest::Url::parse(url)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("Pack downloads require public HTTPS URLs");
    }
    Ok(())
}

fn extract_archive(path: &Path, dest: &Path, task: &Task, total: &mut u64) -> Result<()> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    if archive.len() > 30_000 {
        bail!("Too many archive entries");
    }
    for i in 0..archive.len() {
        task.check()?;
        let mut file = archive.by_index(i)?;
        if file.is_dir() {
            continue;
        }
        if file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            bail!("Pack contains a symbolic link");
        }
        let relative = file.name().strip_prefix("./").unwrap_or(file.name());
        let output = crate::safe_join(dest, relative)?;
        *total = total
            .checked_add(file.size())
            .context("Archive size overflow")?;
        if *total > 4_000_000_000 {
            bail!("Pack archives are too large");
        }
        std::fs::create_dir_all(output.parent().unwrap())?;
        std::io::copy(&mut file, &mut std::fs::File::create(output)?)?;
    }
    Ok(())
}

fn detect_technic_loader(
    game: &Path,
    mc: &str,
) -> Result<Option<(String, Loader, Option<String>)>> {
    let jar = game.join("bin/modpack.jar");
    let version = game.join("bin/version.json");
    let raw: Option<Value> = if version.exists() {
        Some(serde_json::from_slice(&std::fs::read(version)?)?)
    } else if jar.exists() {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
        let result=match zip.by_name("version.json") {
            Ok(mut file)=>{
                if file.size()>2_000_000 {bail!("Loader metadata too large");}
                let mut bytes=Vec::new();file.read_to_end(&mut bytes)?;
                Some(serde_json::from_slice(&bytes)?)
            }
            Err(_)=>bail!("This legacy Technic pack requires custom jar patches unsupported by Aurum. Use its project page for alternatives."),
        };
        result
    } else {
        None
    };
    let Some(raw) = raw else {
        return Ok(None);
    };
    let mc = raw["inheritsFrom"].as_str().unwrap_or(mc).to_string();
    crate::store::validate_version(&mc)?;
    for lib in raw["libraries"].as_array().into_iter().flatten() {
        let coordinate = text(lib, "name");
        for (prefix, kind) in [
            ("net.minecraftforge:forge:", "forge"),
            ("net.minecraftforge:fmlloader:", "forge"),
            ("net.minecraftforge:minecraftforge:", "forge"),
            ("net.fabricmc:fabric-loader:", "fabric"),
            ("org.quiltmc:quilt-loader:", "quilt"),
            ("net.neoforged:neoforge:", "neoforge"),
        ] {
            if let Some(version) = coordinate.strip_prefix(prefix) {
                let (kind, version) =
                    loader(kind, version.split(':').next().unwrap_or(version), &mc)?;
                return Ok(Some((mc, kind, version)));
            }
        }
    }
    if raw["mainClass"]
        .as_str()
        .is_some_and(|s| s.contains("forge") || s.contains("launchwrapper") || s.contains("fabric"))
    {
        bail!("Unrecognized Technic mod loader metadata");
    }
    Ok(Some((mc, Loader::Vanilla, None)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{io::Write, time::Instant};

    async fn fixture() -> (tempfile::TempDir, Engine, Task) {
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/pack-catalog-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let mut engine = Engine::new(dir.path().into(), |_| {}).await.unwrap();
        engine.http = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap())
            .build()
            .unwrap();
        let task = engine
            .task(uuid::Uuid::new_v4().to_string(), None)
            .await
            .unwrap();
        (dir, engine, task)
    }
    async fn cache(engine: &Engine, url: &str, value: Value) {
        engine
            .catalog_cache
            .lock()
            .await
            .insert(url.into(), (Instant::now(), value));
    }
    fn zip(path: &Path, files: &[(&str, &[u8])]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut writer = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        for (name, data) in files {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }
    async fn atl(engine: &Engine, raw: Value) {
        cache(engine,&format!("{ATL}/packs/full/all"),json!({"data":[{"name":"Test pack","safeName":"TestPack","type":"public","versions":[{"version":"1.0","minecraft":"1.20.1"}]}]})).await;
        cache(
            engine,
            &format!("{ATL_CDN}packs/TestPack/versions/1.0/Configs.json"),
            raw,
        )
        .await;
    }
    fn mod_file(name: &str, optional: bool) -> Value {
        json!({"name":name,"file":format!("{name}.jar"),"url":"https://example.test/download","type":"mods","download":"browser","md5":"900150983cd24fb0d6963f7d28e17f72","optional":optional,"client":true})
    }

    #[tokio::test]
    async fn atl_optional_dependencies_manual_checksum_and_commit() {
        let (dir, e, t) = fixture().await;
        let mut optional = mod_file("optional", true);
        optional["depends"] = json!(["dependency"]);
        atl(&e,json!({"version":"1.0","minecraft":"1.20.1","noConfigs":true,"loader":{"type":"fabric","metadata":{"loader":"0.16.7"}},"mods":[mod_file("required",false),optional,mod_file("dependency",true)]})).await;
        let defaults = e
            .pack_requirements("atlauncher", "TestPack", "1.0", &PackOptions::default())
            .await
            .unwrap();
        assert_eq!(defaults.manual_files.len(), 1);
        let mut options = PackOptions {
            optional: Some(vec!["optional".into()]),
            ..Default::default()
        };
        let requirements = e
            .pack_requirements("atlauncher", "TestPack", "1.0", &options)
            .await
            .unwrap();
        assert_eq!(requirements.manual_files.len(), 3);
        assert!(requirements.optional.iter().all(|m| m.selected));
        let local = dir.path().join("chosen.jar");
        std::fs::write(&local, b"abc").unwrap();
        for f in requirements.manual_files {
            options
                .manual_files
                .insert(f.id, local.to_string_lossy().into());
        }
        let id = e
            .download_platform_pack_with_options("atlauncher", "TestPack", "1.0", &options, &t)
            .await
            .unwrap();
        let profile = e.profile(&id).await.unwrap();
        assert_eq!(profile.loader, Loader::Fabric);
        assert_eq!(profile.loader_version.as_deref(), Some("0.16.7"));
        assert_eq!(
            std::fs::read(e.instance(&id).unwrap().join("mods/dependency.jar")).unwrap(),
            b"abc"
        );
        assert!(!e
            .root
            .join("staging")
            .join(&t.id)
            .join("platform-pack")
            .exists());
    }

    #[tokio::test]
    async fn failed_manual_checksum_and_cancellation_publish_no_profile() {
        let (dir, e, t) = fixture().await;
        atl(&e,json!({"version":"1.0","minecraft":"1.20.1","noConfigs":true,"mods":[mod_file("required",false)]})).await;
        let local = dir.path().join("wrong.jar");
        std::fs::write(&local, b"wrong").unwrap();
        let options = PackOptions {
            manual_files: HashMap::from([(
                "mods/required.jar".into(),
                local.to_string_lossy().into(),
            )]),
            ..Default::default()
        };
        assert!(e
            .download_platform_pack_with_options("atlauncher", "TestPack", "1.0", &options, &t)
            .await
            .unwrap_err()
            .to_string()
            .contains("Checksum"));
        assert!(e.db.lock().await.profiles.is_empty());
        assert!(!e
            .root
            .join("staging")
            .join(&t.id)
            .join("platform-pack")
            .exists());
        e.cancel(&t.id).await.unwrap();
        assert!(e
            .download_platform_pack("atlauncher", "TestPack", "1.0", &t)
            .await
            .is_err());
        assert!(e.db.lock().await.profiles.is_empty());
    }

    #[tokio::test]
    async fn ftb_targets_server_only_paths_and_persist_rollback() {
        let (_dir, e, t) = fixture().await;
        let targets = json!([{"type":"game","name":"minecraft","version":"1.21.1"},{"type":"modloader","name":"neoforge","version":"21.1.72"}]);
        cache(&e,&format!("{FTB}/modpack/125"),json!({"id":125,"name":"FTB fixture","versions":[{"id":1,"name":"1.0","targets":targets}]})).await;
        let raw = json!({"id":1,"parent":125,"targets":targets,"files":[{"name":"example.jar","path":"./mods/","url":"https://example.test/example.jar","sha1":"a9993e364706816aba3e25717850c26c9cd0d89d"},{"name":"server.jar","serveronly":true}]});
        cache(&e, &format!("{FTB}/modpack/125/1"), raw.clone()).await;
        let plan = e
            .platform_plan("ftb", "125", "1", &PackOptions::default())
            .await
            .unwrap();
        assert_eq!(plan.loader, Loader::Neoforge);
        assert_eq!(plan.files.len(), 1);
        assert_eq!(plan.files[0].destination, "mods/example.jar");
        let staging = e
            .root
            .join("staging")
            .join(&t.id)
            .join("platform-pack/game/mods");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("example.jar"), b"abc").unwrap();
        // Force persistence to fail after publication; the instance must roll back.
        std::fs::create_dir(e.root.join("state.json.tmp")).unwrap();
        let error = e
            .download_platform_pack("ftb", "125", "1", &t)
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Could not save installed pack profile"),
            "{error:#}"
        );
        assert!(e.db.lock().await.profiles.is_empty());
        assert_eq!(
            std::fs::read_dir(e.root.join("instances")).unwrap().count(),
            0
        );
        let mut unsafe_raw = raw;
        unsafe_raw["files"][0]["path"] = json!("../../");
        cache(&e, &format!("{FTB}/modpack/125/1"), unsafe_raw).await;
        assert!(e
            .pack_requirements("ftb", "125", "1", &PackOptions::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn technic_solder_archives_detect_forge_and_install_content() {
        use md5::{Digest, Md5};
        let (_dir, e, t) = fixture().await;
        cache(&e,&format!("{TECHNIC}/modpack/test-pack?build=aurum"),json!({"name":"test-pack","displayName":"Technic fixture","minecraft":"1.12.2","solder":"https://solder.example.test/api/"})).await;
        cache(
            &e,
            "https://solder.example.test/api/modpack/test-pack",
            json!({"recommended":"1.0","builds":["0.9","1.0"]}),
        )
        .await;
        let archive = e
            .root
            .join("staging")
            .join(&t.id)
            .join("platform-pack/archive-0.zip");
        zip(&archive,&[("mods/example.jar",b"example"),("bin/version.json",br#"{"inheritsFrom":"1.12.2","libraries":[{"name":"net.minecraftforge:forge:1.12.2-14.23.5.2860"}]}"#)]);
        let md5 = format!("{:x}", Md5::digest(std::fs::read(&archive).unwrap()));
        cache(&e,"https://solder.example.test/api/modpack/test-pack/1.0",json!({"minecraft":"1.12.2","mods":[{"name":"fixture","md5":md5,"url":"https://example.test/fixture.zip"}]})).await;
        let id = e
            .download_platform_pack("technic", "test-pack", "1.0", &t)
            .await
            .unwrap();
        let profile = e.profile(&id).await.unwrap();
        assert_eq!(profile.loader, Loader::Forge);
        assert_eq!(profile.loader_version.as_deref(), Some("14.23.5.2860"));
        assert!(e.instance(&id).unwrap().join("mods/example.jar").exists());
        assert!(!e.instance(&id).unwrap().join("bin").exists());
        assert!(e
            .download_platform_pack("technic", "test-pack", "private-version", &t)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn archives_reject_traversal_and_unsupported_legacy_jars() {
        let (dir, e, t) = fixture().await;
        let archive = dir.path().join("bad.zip");
        zip(&archive, &[("../escaped.txt", b"no")]);
        assert!(extract_archive(&archive, &dir.path().join("game"), &t, &mut 0).is_err());
        assert!(!dir.path().join("escaped.txt").exists());
        let game = e.root.join("legacy");
        zip(&game.join("bin/modpack.jar"), &[("custom.class", b"no")]);
        assert!(detect_technic_loader(&game, "1.5.2")
            .unwrap_err()
            .to_string()
            .contains("legacy"));
        assert!(public_download_url("http://example.test/modpack.zip").is_err());
        assert!(solder_url("https://user:password@example.test/api", "pack", None).is_err());
    }
}
