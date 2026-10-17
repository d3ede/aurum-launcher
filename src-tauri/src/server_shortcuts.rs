use auren_core::{servers::ServerAddress, Engine};
use serde::Serialize;
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerLaunch {
    pub profile_id: String,
    pub address: String,
}

#[derive(Default)]
pub struct Shortcuts {
    pending: Mutex<VecDeque<ServerLaunch>>,
    error: Mutex<Option<String>>,
}

impl Shortcuts {
    pub fn enqueue(&self, arguments: &[String]) -> bool {
        match parse(arguments) {
            Ok(Some(request)) => {
                let mut pending = self.pending.lock().unwrap();
                if pending.len() < 8 {
                    pending.push_back(request);
                }
                true
            }
            Err(error) => {
                *self.error.lock().unwrap() = Some(error);
                true
            }
            Ok(None) => false,
        }
    }
    pub fn take(&self) -> Result<Option<ServerLaunch>, String> {
        if let Some(error) = self.error.lock().unwrap().take() {
            return Err(error);
        }
        Ok(self.pending.lock().unwrap().pop_front())
    }
}

fn parse(arguments: &[String]) -> Result<Option<ServerLaunch>, String> {
    if !arguments
        .iter()
        .any(|argument| argument == "--profile" || argument == "--server")
    {
        return Ok(None);
    }
    let mut profile = None;
    let mut server = None;
    let mut index = 1;
    while index < arguments.len() {
        let value = arguments
            .get(index + 1)
            .ok_or("Неполные параметры ярлыка сервера")?;
        match arguments[index].as_str() {
            "--profile" if profile.is_none() => profile = Some(value.clone()),
            "--server" if server.is_none() => server = Some(value.clone()),
            _ => return Err("Некорректные параметры ярлыка сервера".into()),
        }
        index += 2;
    }
    let profile = profile.ok_or("В ярлыке не указана сборка")?;
    if profile.len() != 36
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err("Некорректный идентификатор сборки в ярлыке".into());
    }
    let address = ServerAddress::parse(&server.ok_or("В ярлыке не указан сервер")?)
        .map_err(|error| error.to_string())?
        .address;
    Ok(Some(ServerLaunch {
        profile_id: profile,
        address,
    }))
}

pub fn receive(app: &tauri::AppHandle, arguments: &[String]) {
    if app.state::<Shortcuts>().enqueue(arguments) {
        let _ = app.emit("auren:event", serde_json::json!({"id":"server-shortcut","profileId":null,"phase":"server-shortcut","message":"","done":0,"total":0}));
    }
}

pub async fn create(app: &tauri::AppHandle, engine: &Engine, id: &str) -> Result<PathBuf, String> {
    let server = engine
        .recent_server(id)
        .await
        .map_err(|error| error.to_string())?;
    let profile = engine
        .profile(&server.profile_id)
        .await
        .map_err(|error| error.to_string())?;
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        create_link(&desktop, &executable, &server, &profile.name)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn create_link(
    desktop: &Path,
    executable: &Path,
    server: &auren_core::model::RecentServer,
    profile: &str,
) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let address = ServerAddress::parse(&server.address).map_err(|error| error.to_string())?;
        let title = format!("{} — {profile}", server.name)
            .chars()
            .filter(|character| !character.is_control() && !"<>:\"/\\|?*".contains(*character))
            .take(80)
            .collect::<String>();
        let suffix: String = server
            .id
            .chars()
            .filter(|character| character.is_ascii_hexdigit())
            .take(8)
            .collect();
        let path = desktop.join(format!(
            "Aurum — {} ({suffix}).lnk",
            title.trim().trim_end_matches('.')
        ));
        let arguments = format!(
            "--profile {} --server {}",
            server.profile_id, address.address
        );
        let powershell =
            PathBuf::from(std::env::var_os("SystemRoot").ok_or("Не найдена папка Windows")?)
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let output = std::process::Command::new(powershell)
            .args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $shell=New-Object -ComObject WScript.Shell; $link=$shell.CreateShortcut($env:AURUM_SERVER_LINK); $link.TargetPath=$env:AURUM_SERVER_EXE; $link.Arguments=$env:AURUM_SERVER_ARGS; $link.WorkingDirectory=[IO.Path]::GetDirectoryName($env:AURUM_SERVER_EXE); $link.IconLocation=$env:AURUM_SERVER_EXE+',0'; $link.Description='Join Minecraft server with Aurum Launcher'; $link.Save()"])
            .env("AURUM_SERVER_LINK", &path).env("AURUM_SERVER_EXE", executable).env("AURUM_SERVER_ARGS", arguments)
            .creation_flags(0x08000000).output().map_err(|error| error.to_string())?;
        if !output.status.success() || !path.is_file() {
            return Err("Не удалось создать ярлык на рабочем столе".into());
        }
        Ok(path)
    }
    #[cfg(not(windows))]
    {
        let _ = (desktop, executable, server, profile);
        Err("Создание ярлыков серверов пока доступно только в Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_arguments_are_validated_and_consumed_once() {
        let state = Shortcuts::default();
        let arguments = [
            "aurum.exe",
            "--profile",
            "95698e6a-9ac5-4418-b773-4346121b0220",
            "--server",
            "Example.org:25566",
        ]
        .map(String::from);
        assert!(state.enqueue(&arguments));
        let launch = state.take().unwrap().unwrap();
        assert_eq!(launch.address, "example.org:25566");
        assert!(state.take().unwrap().is_none());
        assert!(parse(&["aurum.exe".into()]).unwrap().is_none());
        for address in [
            "host & calc",
            "https://example.org",
            "host:0",
            "host\n--profile",
        ] {
            let mut invalid = arguments.clone();
            invalid[4] = address.into();
            assert!(parse(&invalid).is_err());
        }
        assert!(parse(&arguments[..4]).is_err());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "creates and reads a Windows .lnk only inside .test-data"]
    fn windows_link_points_to_the_launcher_with_profile_and_server_arguments() {
        use std::os::windows::process::CommandExt;
        let directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-data/server-shortcuts");
        std::fs::create_dir_all(&directory).unwrap();
        let root = tempfile::tempdir_in(directory).unwrap();
        let executable = std::env::current_exe().unwrap();
        let profile_id = "95698e6a-9ac5-4418-b773-4346121b0220";
        let server = auren_core::model::RecentServer {
            id: "abcdef0123456789".into(),
            profile_id: profile_id.into(),
            name: "Test <server> \"quoted\"".into(),
            address: "example.org:25566".into(),
            last_played: 0,
            icon: None,
        };
        let path = create_link(root.path(), &executable, &server, "Fixture profile").unwrap();
        assert!(path.starts_with(root.path()));
        let output = std::process::Command::new(PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/WindowsPowerShell/v1.0/powershell.exe"))
            .args(["-NoProfile", "-NonInteractive", "-Command", "$link=(New-Object -ComObject WScript.Shell).CreateShortcut($env:AURUM_TEST_LINK); @{target=$link.TargetPath;arguments=$link.Arguments} | ConvertTo-Json -Compress"])
            .env("AURUM_TEST_LINK", path).creation_flags(0x08000000).output().unwrap();
        assert!(output.status.success());
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(PathBuf::from(value["target"].as_str().unwrap()), executable);
        assert_eq!(
            value["arguments"],
            format!("--profile {profile_id} --server example.org:25566")
        );
    }
}
