use super::{
    network::script_trust,
    process::{read_output, Control, Runtime},
    HostingProfile,
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, sync::mpsc};
use windows_sys::Win32::{Foundation::HANDLE, System::JobObjects::*};

struct Job(OwnedHandle);
impl Job {
    fn attach(child: &tokio::process::Child) -> Result<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle) });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job.handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let process = child
            .raw_handle()
            .context("Нет дескриптора стартового процесса")?;
        if unsafe { AssignProcessToJobObject(job.handle(), process as HANDLE) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(job)
    }
    fn handle(&self) -> HANDLE {
        self.0.as_raw_handle() as HANDLE
    }
    fn accounting(&self) -> Result<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION> {
        let mut information = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        if unsafe {
            QueryInformationJobObject(
                self.handle(),
                JobObjectBasicAccountingInformation,
                (&mut information as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                std::mem::size_of_val(&information) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(information)
    }
    fn terminate(&self) -> Result<()> {
        if unsafe { TerminateJobObject(self.handle(), 1) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
    fn process_ids(&self) -> Result<Vec<sysinfo::Pid>> {
        #[repr(C)]
        struct ProcessList {
            assigned: u32,
            count: u32,
            ids: [usize; 1024],
        }
        let mut list = ProcessList {
            assigned: 0,
            count: 0,
            ids: [0; 1024],
        };
        if unsafe {
            QueryInformationJobObject(
                self.handle(),
                JobObjectBasicProcessIdList,
                (&mut list as *mut ProcessList).cast(),
                std::mem::size_of_val(&list) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(list.ids[..(list.count as usize).min(list.ids.len())]
            .iter()
            .map(|id| sysinfo::Pid::from_u32(*id as u32))
            .collect())
    }
}

pub(super) async fn spawn(
    profile: &HostingProfile,
    runtime: Arc<Runtime>,
    mut receiver: mpsc::Receiver<Control>,
) -> Result<()> {
    let trust = script_trust(profile)?;
    if !trust.trusted {
        bail!("Сначала подтвердите запуск выбранного скрипта");
    }
    let script = std::path::PathBuf::from(&trust.path);
    let folder = script.parent().context("Нет папки стартового скрипта")?;
    let wrapper = r#"$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding; if ([Console]::ReadLine() -ne 'AURUM_START') { exit 125 }; try { Set-Location -LiteralPath $env:AURUM_NETWORK_CWD; if ([IO.Path]::GetExtension($env:AURUM_NETWORK_ENTRY) -eq '.ps1') { & $env:AURUM_NETWORK_ENTRY; if (-not $?) { exit 1 } } else { & ($env:SystemRoot + '\System32\cmd.exe') /d /s /c '""%AURUM_NETWORK_ENTRY%""'; exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"#;
    let encoded = STANDARD.encode(
        wrapper
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let powershell =
        std::path::PathBuf::from(std::env::var_os("SystemRoot").context("Нет SystemRoot")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = tokio::process::Command::new(powershell);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded,
        ])
        .env("AURUM_NETWORK_ENTRY", &script)
        .env("AURUM_NETWORK_CWD", folder)
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::minecraft::hide(&mut command);
    let mut child = command
        .spawn()
        .context("Не удалось запустить скрипт сети")?;
    let job = match Job::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill().await;
            return Err(error.context("Не удалось изолировать процессы сети; скрипт не запущен"));
        }
    };
    let mut input = child.stdin.take().context("Нет канала запуска")?;
    let stdout = child.stdout.take().context("Нет stdout скрипта")?;
    let stderr = child.stderr.take().context("Нет stderr скрипта")?;
    let mut output_task = tokio::spawn(read_output(stdout, runtime.clone(), "info"));
    let mut error_task = tokio::spawn(read_output(stderr, runtime.clone(), "error"));
    {
        let mut output = runtime.output.lock().unwrap();
        output.live.pid = child.id();
        output.live.started_at = Some(crate::now());
    }
    input.write_all(b"AURUM_START\n").await?;
    input.flush().await?;
    runtime.line(
        &format!(
            "Запуск сети: {}",
            profile
                .network
                .as_ref()
                .unwrap()
                .startup_script
                .as_ref()
                .unwrap()
        ),
        "system",
    );
    let stop_command = profile.network.as_ref().unwrap().stop_command.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        let mut exit = None;
        let mut killed = false;
        let mut stop_requested = false;
        let mut previous_cpu = 0;
        let mut system = sysinfo::System::new();
        loop {
            tokio::select! {
                control = receiver.recv() => {
                    match control {
                        Some(Control::Kill) => {
                            match job.terminate() { Ok(()) => { killed = true; runtime.output.lock().unwrap().live.status = "stopping".into(); }, Err(error) => runtime.line(&error.to_string(), "error") }
                        },
                        Some(Control::Stop) => {
                            if stop_command.is_empty() { runtime.line("Команда остановки не настроена. Завершите сеть обычным способом или используйте принудительное завершение", "warn"); }
                            else if let Err(error) = input.write_all(format!("{stop_command}\n").as_bytes()).await { runtime.line(&format!("Команда остановки не доставлена: {error}. Процессы не завершены принудительно"), "warn"); }
                            else { let _ = input.flush().await; stop_requested = true; runtime.output.lock().unwrap().live.status = "stopping".into(); runtime.line("Команда остановки отправлена скрипту. Ожидаем завершение сети…", "system"); }
                        },
                        _ => {},
                    }
                },
                _ = interval.tick() => {
                    if exit.is_none() { if let Ok(Some(status)) = child.try_wait() { exit = Some(status); } }
                    match job.accounting() {
                        Ok(accounting) => {
                            if accounting.ActiveProcesses == 0 { break; }
                            let cpu = accounting.TotalUserTime + accounting.TotalKernelTime;
                            let memory = job.process_ids().ok().map(|ids| {
                                system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&ids), true, sysinfo::ProcessRefreshKind::nothing().with_memory());
                                ids.iter().filter_map(|id| system.process(*id)).map(|process| process.memory()).sum()
                            });
                            let mut output = runtime.output.lock().unwrap();
                            output.live.memory_bytes = memory;
                            output.live.cpu = Some(((cpu - previous_cpu).max(0) as f32 / 100000.0) / std::thread::available_parallelism().map_or(1, usize::from) as f32);
                            previous_cpu = cpu;
                        },
                        Err(error) => runtime.line(&error.to_string(), "error"),
                    }
                }
            }
        }
        drop(input);
        let _ = child.wait().await;
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            let _ = (&mut output_task).await;
            let _ = (&mut error_task).await;
        })
        .await;
        output_task.abort();
        error_task.abort();
        runtime.line(if killed { "Сеть завершена принудительно по запросу пользователя" } else if stop_requested { "Сеть завершила работу после команды остановки" } else { "Процессы сети завершили работу самостоятельно. Проверьте предыдущие сообщения скрипта" }, "system");
        let mut output = runtime.output.lock().unwrap();
        output.live.status = if killed || exit.is_some_and(|status| status.success()) {
            "stopped"
        } else {
            "crashed"
        }
        .into();
        output.live.pid = None;
        output.live.cpu = None;
        output.live.memory_bytes = None;
        output.live.players.clear();
        output.live.player_count = Some(0);
        output.live.exit_code = exit.and_then(|status| status.code());
    });
    Ok(())
}
