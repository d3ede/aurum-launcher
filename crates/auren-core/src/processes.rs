//! Recover Minecraft processes by their exact game directory, without storing command lines.
use crate::{model::Event, Engine};
use anyhow::{bail, Result};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Clone, Debug)]
pub(crate) struct RecoveredProcess {
    pid: u32,
    started: u64,
    executable: PathBuf,
    directory: PathBuf,
    #[cfg(windows)]
    creation_time: u64,
}

fn java_executable(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        matches!(
            name.to_string_lossy().to_ascii_lowercase().as_str(),
            "java" | "javaw" | "java.exe" | "javaw.exe"
        )
    })
}

fn game_directory(process: &Process) -> Option<PathBuf> {
    let mut args = process.cmd().iter();
    while let Some(arg) = args.next() {
        if arg == "--gameDir" {
            return std::fs::canonicalize(Path::new(args.next()?)).ok();
        }
        if let Some(value) = arg.to_str().and_then(|arg| arg.strip_prefix("--gameDir=")) {
            return std::fs::canonicalize(value).ok();
        }
    }
    None
}

fn matches(process: &Process, identity: &RecoveredProcess) -> bool {
    process.start_time() == identity.started
        && process
            .exe()
            .and_then(|exe| std::fs::canonicalize(exe).ok())
            .as_ref()
            == Some(&identity.executable)
        && game_directory(process).as_ref() == Some(&identity.directory)
        && platform_alive(identity)
}

fn process_system(pids: &[Pid]) -> System {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(pids),
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    system
}

fn discover(directories: HashMap<PathBuf, String>) -> HashMap<String, Vec<RecoveredProcess>> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    let pids: Vec<_> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            process
                .exe()
                .filter(|exe| java_executable(exe))
                .map(|_| *pid)
        })
        .collect();
    let system = process_system(&pids);
    let mut recovered: HashMap<String, Vec<RecoveredProcess>> = HashMap::new();
    for (pid, process) in system.processes() {
        let Some(directory) = game_directory(process) else {
            continue;
        };
        let Some(profile) = directories.get(&directory) else {
            continue;
        };
        let Some(executable) = process
            .exe()
            .filter(|exe| java_executable(exe))
            .and_then(|exe| std::fs::canonicalize(exe).ok())
        else {
            continue;
        };
        #[cfg(windows)]
        let Some(creation_time) = windows::creation_time(pid.as_u32()) else {
            continue;
        };
        recovered
            .entry(profile.clone())
            .or_default()
            .push(RecoveredProcess {
                pid: pid.as_u32(),
                started: process.start_time(),
                executable,
                directory,
                #[cfg(windows)]
                creation_time,
            });
    }
    recovered
}

pub(crate) fn directories_running(paths: Vec<PathBuf>) -> bool {
    let directories = paths
        .into_iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .map(|p| (p, String::new()))
        .collect::<HashMap<_, _>>();
    !directories.is_empty() && !discover(directories).is_empty()
}

impl Engine {
    pub(crate) async fn recover_running(&self) -> Result<()> {
        let mut directories = HashMap::new();
        for profile in &self.db.lock().await.profiles {
            if let Ok(directory) = self
                .instance(&profile.id)
                .and_then(|path| Ok(std::fs::canonicalize(path)?))
            {
                directories.insert(directory, profile.id.clone());
            }
        }
        if directories.is_empty() {
            return Ok(());
        }
        let recovered = tokio::task::spawn_blocking(move || discover(directories)).await?;
        for id in recovered.keys() {
            self.running
                .lock()
                .await
                .insert(id.clone(), Arc::new(AtomicBool::new(false)));
        }
        *self.recovered.lock().await = recovered;
        Ok(())
    }

    pub(crate) async fn refresh_recovered(&self) {
        let records = self.recovered.lock().await.clone();
        if records.is_empty() {
            return;
        }
        let Ok(live) = tokio::task::spawn_blocking(move || {
            let pids: Vec<_> = records
                .values()
                .flatten()
                .map(|record| Pid::from_u32(record.pid))
                .collect();
            let system = process_system(&pids);
            records
                .into_iter()
                .map(|(id, processes)| {
                    (
                        id,
                        processes
                            .into_iter()
                            .filter(|record| {
                                system
                                    .process(Pid::from_u32(record.pid))
                                    .is_some_and(|process| matches(process, record))
                            })
                            .collect::<Vec<_>>(),
                    )
                })
                .collect::<HashMap<_, _>>()
        })
        .await
        else {
            return;
        };
        for (id, processes) in live {
            if processes.is_empty() {
                if self.recovered.lock().await.remove(&id).is_some() {
                    self.running.lock().await.remove(&id);
                    (self.emit)(Event {
                        id: uuid::Uuid::new_v4().to_string(),
                        profile_id: Some(id),
                        pack_name: None,
                        phase: "exited".into(),
                        message: "Minecraft завершён".into(),
                        done: 0,
                        total: 0,
                    });
                }
            } else if let Some(current) = self.recovered.lock().await.get_mut(&id) {
                *current = processes;
            }
        }
    }

    pub(crate) async fn stop_recovered(&self, id: &str) -> Result<bool> {
        let Some(records) = self.recovered.lock().await.get(id).cloned() else {
            return Ok(false);
        };
        tokio::task::spawn_blocking(move || -> Result<()> {
            let pids: Vec<_> = records
                .iter()
                .map(|record| Pid::from_u32(record.pid))
                .collect();
            let system = process_system(&pids);
            for record in records {
                let Some(process) = system
                    .process(Pid::from_u32(record.pid))
                    .filter(|process| matches(process, &record))
                else {
                    continue;
                };
                #[cfg(windows)]
                windows::stop(&record)?;
                #[cfg(not(windows))]
                if !process.kill() {
                    bail!("Не удалось остановить Minecraft")
                }
                #[cfg(windows)]
                let _ = process;
            }
            Ok(())
        })
        .await??;
        self.refresh_recovered().await;
        Ok(true)
    }
}

#[cfg(not(windows))]
fn platform_alive(_: &RecoveredProcess) -> bool {
    true
}
#[cfg(windows)]
fn platform_alive(record: &RecoveredProcess) -> bool {
    windows::creation_time(record.pid) == Some(record.creation_time)
}

#[cfg(windows)]
mod windows {
    use super::*;
    use anyhow::Context;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_TIMEOUT},
        System::Threading::{
            GetProcessTimes, OpenProcess, TerminateProcess, WaitForSingleObject,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
        },
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    fn open(pid: u32, stop: bool) -> Option<Handle> {
        let access = PROCESS_QUERY_LIMITED_INFORMATION
            | PROCESS_SYNCHRONIZE
            | if stop { PROCESS_TERMINATE } else { 0 };
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            None
        } else {
            Some(Handle(handle))
        }
    }
    fn birth(handle: &Handle) -> Option<u64> {
        if unsafe { WaitForSingleObject(handle.0, 0) } != WAIT_TIMEOUT {
            return None;
        }
        let mut times = [FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        }; 4];
        let [created, exited, kernel, user] = &mut times;
        let success = unsafe { GetProcessTimes(handle.0, created, exited, kernel, user) };
        (success != 0).then_some(
            (u64::from(times[0].dwHighDateTime) << 32) | u64::from(times[0].dwLowDateTime),
        )
    }
    pub(super) fn creation_time(pid: u32) -> Option<u64> {
        birth(&open(pid, false)?)
    }
    pub(super) fn stop(record: &RecoveredProcess) -> Result<()> {
        let Some(handle) = open(record.pid, true) else {
            if creation_time(record.pid).is_none() {
                return Ok(());
            }
            bail!("Не удалось получить доступ к процессу Minecraft")
        };
        // Verify the birth time on the SAME handle used to terminate: PID reuse cannot hit another process.
        if birth(&handle) != Some(record.creation_time) {
            return Ok(());
        }
        if unsafe { TerminateProcess(handle.0, 0) } == 0 {
            return Err(std::io::Error::last_os_error()).context("Не удалось остановить Minecraft");
        }
        unsafe {
            WaitForSingleObject(handle.0, 5000);
        }
        Ok(())
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn different_creation_time_never_terminates_the_process() {
            let pid = std::process::id();
            let created = creation_time(pid).unwrap();
            let record = RecoveredProcess {
                pid,
                started: 0,
                executable: PathBuf::new(),
                directory: PathBuf::new(),
                creation_time: created + 1,
            };
            stop(&record).unwrap();
            assert_eq!(creation_time(pid), Some(created));
        }
    }
}
