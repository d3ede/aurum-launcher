use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Loader {
    Vanilla,
    Fabric,
    Forge,
    Neoforge,
    Quilt,
}
impl Loader {
    pub fn key(&self) -> &'static str {
        match self {
            Self::Vanilla => "vanilla",
            Self::Fabric => "fabric",
            Self::Forge => "forge",
            Self::Neoforge => "neoforge",
            Self::Quilt => "quilt",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIconStyle {
    pub symbol: String,
    pub color: String,
    pub background: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub minecraft: String,
    pub loader: Loader,
    pub loader_version: Option<String>,
    pub installed_version: Option<String>,
    pub ram_mb: Option<u32>,
    pub jvm_args: String,
    pub last_played: Option<u64>,
    pub cover: u8,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub icon_style: Option<ProfileIconStyle>,
    #[serde(default)]
    pub content: Vec<Content>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Content {
    pub id: String,
    pub source: String,
    pub project_id: String,
    pub version_id: String,
    pub name: String,
    pub filename: String,
    pub kind: String,
    pub enabled: bool,
    #[serde(flatten)]
    pub info: ContentInfo,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ContentInfo {
    pub version_name: String,
    pub icon: Option<String>,
    pub author: String,
    pub project_url: Option<String>,
    pub modified_at: u64,
    pub sha1: String,
    pub date_published: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentUpdate {
    pub content_id: String,
    pub version_id: String,
    pub version_name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentInspection {
    pub content: Vec<Content>,
    pub updates: Vec<ContentUpdate>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentUpdateResult {
    pub updated: usize,
    pub failed: Vec<ContentUpdateFailure>,
    pub cancelled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentUpdateFailure {
    pub name: String,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub uuid: String,
    pub skin_model: String,
    pub has_skin: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "legacy_language")]
    pub language: String,
    pub theme: String,
    pub java_path: String,
    pub ram_mb: u32,
    pub jvm_args: String,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub show_snapshots: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "system".into(),
            theme: "light".into(),
            java_path: String::new(),
            ram_mb: 4096,
            jvm_args: String::new(),
            resolution_width: 1280,
            resolution_height: 720,
            show_snapshots: false,
        }
    }
}
fn legacy_language() -> String {
    "ru".into()
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub instance_directories: std::collections::HashMap<String, String>,
    pub accounts: Vec<Account>,
    pub selected_account: Option<String>,
    pub settings: Settings,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub database: Database,
    pub data_dir: String,
    pub running: Vec<String>,
    pub curseforge_configured: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub profile_id: Option<String>,
    pub phase: String,
    pub message: String,
    pub done: u64,
    pub total: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub source: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon: Option<String>,
    pub downloads: u64,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVersion {
    pub id: String,
    pub name: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Search {
    pub query: String,
    pub source: String,
    pub kind: String,
    pub minecraft: Option<String>,
    pub loader: Option<String>,
    pub offset: u32,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub category: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub projects: Vec<Project>,
    pub total: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub body: String,
    pub gallery: Vec<String>,
    pub versions: Vec<ProjectVersion>,
    pub url: String,
}
