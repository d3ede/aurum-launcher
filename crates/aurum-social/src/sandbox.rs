//! Windows AppContainer creation and inherited-pipe process boundary.
//! No loopback exemption, shell, elevation or network service is installed here.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    ffi::c_void,
    fs::File,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, Isolation::*, *},
    Storage::FileSystem::{FILE_GENERIC_EXECUTE, FILE_GENERIC_READ},
    System::{JobObjects::*, Pipes::CreatePipe, Threading::*},
};

fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
fn checked(ok: i32, context: &str) -> Result<()> {
    if ok == 0 {
        bail!("{context}: {}", std::io::Error::last_os_error());
    }
    Ok(())
}
unsafe fn own(raw: HANDLE) -> OwnedHandle {
    OwnedHandle::from_raw_handle(raw)
}

pub struct Container {
    sid: PSID,
}
// The SID allocation is immutable, owned by this object and not a kernel handle.
unsafe impl Send for Container {}
unsafe impl Sync for Container {}
impl Drop for Container {
    fn drop(&mut self) {
        unsafe {
            FreeSid(self.sid);
        }
    }
}

impl Container {
    pub fn open(name: &str) -> Result<Self> {
        if !name.starts_with("Aurum.Social.")
            || name.len() > 64
            || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
        {
            bail!("Invalid Social container name");
        }
        let name = wide(name);
        let mut sid = null_mut();
        unsafe {
            let hr = CreateAppContainerProfile(
                name.as_ptr(),
                name.as_ptr(),
                name.as_ptr(),
                null(),
                0,
                &mut sid,
            );
            if hr < 0 {
                // An existing profile is expected. Derivation alone never substitutes for
                // the process token checks performed below.
                let hr = DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid);
                if hr < 0 {
                    bail!("AppContainer profile failed: 0x{hr:08x}");
                }
            }
        }
        if sid.is_null() {
            bail!("AppContainer returned an empty SID");
        }
        Ok(Self { sid })
    }

    pub fn sid_string(&self) -> Result<String> {
        unsafe { sid_string(self.sid) }
    }

    /// Grant RX only on the dedicated runtime, never on a game or user directory.
    pub fn allow_runtime_read(&self, path: &Path) -> Result<()> {
        let path = wide(path);
        unsafe {
            let mut old = null_mut();
            let mut descriptor = null_mut();
            let result = GetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                &mut old,
                null_mut(),
                &mut descriptor,
            );
            if result != 0 {
                bail!("Read runtime ACL: {result}");
            }
            let entry = EXPLICIT_ACCESS_W {
                grfAccessPermissions: FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
                grfAccessMode: GRANT_ACCESS,
                grfInheritance: 0,
                Trustee: TRUSTEE_W {
                    pMultipleTrustee: null_mut(),
                    MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                    TrusteeForm: TRUSTEE_IS_SID,
                    TrusteeType: TRUSTEE_IS_UNKNOWN,
                    ptstrName: self.sid.cast(),
                },
            };
            let mut acl = null_mut();
            let result = SetEntriesInAclW(1, &entry, old, &mut acl);
            LocalFree(descriptor);
            if result != 0 {
                bail!("Build runtime ACL: {result}");
            }
            let result = SetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl,
                null(),
            );
            LocalFree(acl.cast());
            if result != 0 {
                bail!("Set runtime ACL: {result}");
            }
        }
        Ok(())
    }

    pub fn spawn(&self, executable: &Path) -> Result<Worker> {
        let executable = executable
            .canonicalize()
            .context("Resolve worker executable")?;
        let executable_w = wide(&executable);
        let directory_w = wide(executable.parent().context("Missing runtime directory")?);
        let mut command = wide(format!("\"{}\" --broker", executable.display()));
        // No inherited user PATH, tokens, proxy configuration or application secrets.
        let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let mut entries = std::collections::BTreeMap::from([
            ("SystemRoot".to_owned(), system.clone()),
            ("WINDIR".to_owned(), system),
        ]);
        // Windows needs the profile locations to initialize the AppContainer.
        // These names do not grant access to those directories; the token/ACLs do.
        for name in [
            "APPDATA",
            "LOCALAPPDATA",
            "USERPROFILE",
            "ProgramData",
            "SystemDrive",
            "TEMP",
            "TMP",
        ] {
            if let Ok(value) = std::env::var(name) {
                entries.insert(name.into(), value);
            }
        }
        let mut environment: Vec<u16> = Vec::new();
        for (name, value) in entries {
            environment.extend(format!("{name}={value}\0").encode_utf16());
        }
        environment.push(0);
        unsafe {
            let sa = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 1,
            };
            let (mut input_read, mut input_write, mut output_read, mut output_write) =
                (null_mut(), null_mut(), null_mut(), null_mut());
            checked(
                CreatePipe(&mut input_read, &mut input_write, &sa, 65536),
                "Create input pipe",
            )?;
            let input_read = own(input_read);
            let input_write = own(input_write);
            checked(
                CreatePipe(&mut output_read, &mut output_write, &sa, 65536),
                "Create output pipe",
            )?;
            let output_read = own(output_read);
            let output_write = own(output_write);
            checked(
                SetHandleInformation(input_write.as_raw_handle(), HANDLE_FLAG_INHERIT, 0),
                "Protect broker input handle",
            )?;
            checked(
                SetHandleInformation(output_read.as_raw_handle(), HANDLE_FLAG_INHERIT, 0),
                "Protect broker output handle",
            )?;
            let handles = [input_read.as_raw_handle(), output_write.as_raw_handle()];
            let mut network_sids = [[0u32; 17]; 2];
            for (buf, kind) in network_sids.iter_mut().zip([
                WinCapabilityInternetClientServerSid,
                WinCapabilityPrivateNetworkClientServerSid,
            ]) {
                let mut len = size_of_val(buf) as u32;
                checked(
                    CreateWellKnownSid(kind, null_mut(), buf.as_mut_ptr().cast(), &mut len),
                    "Create network capability",
                )?;
            }
            let mut capabilities = network_sids
                .iter_mut()
                .map(|buf| SID_AND_ATTRIBUTES {
                    Sid: buf.as_mut_ptr().cast(),
                    Attributes: 4, /* SE_GROUP_ENABLED */
                })
                .collect::<Vec<_>>();
            let security = SECURITY_CAPABILITIES {
                AppContainerSid: self.sid,
                Capabilities: capabilities.as_mut_ptr(),
                CapabilityCount: capabilities.len() as u32,
                Reserved: 0,
            };
            let child_policy: u32 = 1; // PROCESS_CREATION_CHILD_PROCESS_RESTRICTED
            let mut bytes = 0;
            InitializeProcThreadAttributeList(null_mut(), 3, 0, &mut bytes);
            let mut attributes = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            let list = attributes.as_mut_ptr().cast();
            checked(
                InitializeProcThreadAttributeList(list, 3, 0, &mut bytes),
                "Initialize worker attributes",
            )?;
            struct Attributes(LPPROC_THREAD_ATTRIBUTE_LIST);
            impl Drop for Attributes {
                fn drop(&mut self) {
                    unsafe {
                        DeleteProcThreadAttributeList(self.0);
                    }
                }
            }
            let _attributes = Attributes(list);
            for (key, value, len) in [
                (
                    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                    (&security as *const SECURITY_CAPABILITIES).cast::<c_void>(),
                    size_of_val(&security),
                ),
                (
                    PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,
                    (&child_policy as *const u32).cast::<c_void>(),
                    size_of_val(&child_policy),
                ),
                (
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    handles.as_ptr().cast::<c_void>(),
                    size_of_val(&handles),
                ),
            ] {
                checked(
                    UpdateProcThreadAttribute(
                        list,
                        0,
                        key as usize,
                        value,
                        len,
                        null_mut(),
                        null(),
                    ),
                    "Set worker boundary",
                )?;
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit = 1;
            limits.ProcessMemoryLimit = 256 * 1024 * 1024;
            let job_raw = CreateJobObjectW(null(), null());
            if job_raw.is_null() {
                bail!("Create worker job: {}", std::io::Error::last_os_error());
            }
            let job = own(job_raw);
            checked(
                SetInformationJobObject(
                    job.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&limits) as u32,
                ),
                "Set worker resource limits",
            )?;
            let cpu = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
                ControlFlags: JOB_OBJECT_CPU_RATE_CONTROL_ENABLE
                    | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
                Anonymous: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION_0 { CpuRate: 2000 },
            };
            checked(
                SetInformationJobObject(
                    job.as_raw_handle(),
                    JobObjectCpuRateControlInformation,
                    (&cpu as *const JOBOBJECT_CPU_RATE_CONTROL_INFORMATION).cast(),
                    size_of_val(&cpu) as u32,
                ),
                "Set worker CPU limit",
            )?;
            let mut startup: STARTUPINFOEXW = zeroed();
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = input_read.as_raw_handle();
            startup.StartupInfo.hStdOutput = output_write.as_raw_handle();
            startup.StartupInfo.hStdError = output_write.as_raw_handle();
            startup.lpAttributeList = list;
            let mut process: PROCESS_INFORMATION = zeroed();
            checked(
                CreateProcessW(
                    executable_w.as_ptr(),
                    command.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    EXTENDED_STARTUPINFO_PRESENT
                        | CREATE_SUSPENDED
                        | CREATE_NO_WINDOW
                        | CREATE_UNICODE_ENVIRONMENT,
                    environment.as_ptr().cast(),
                    directory_w.as_ptr(),
                    &startup.StartupInfo,
                    &mut process,
                ),
                "Launch AppContainer worker",
            )?;
            let process_handle = own(process.hProcess);
            let thread = own(process.hThread);
            let secured = (|| -> Result<Isolation> {
                checked(
                    AssignProcessToJobObject(job.as_raw_handle(), process_handle.as_raw_handle()),
                    "Assign isolated worker job",
                )?;
                let isolation = isolation_for(process_handle.as_raw_handle())?;
                if !isolation.app_container
                    || isolation.integrity_rid > 4096
                    || isolation.container_sid != self.sid_string()?
                {
                    bail!("Worker token does not match the required sandbox");
                }
                Ok(isolation)
            })();
            let isolation = match secured {
                Ok(value) => value,
                Err(error) => {
                    TerminateProcess(process_handle.as_raw_handle(), 1);
                    return Err(error);
                }
            };
            if ResumeThread(thread.as_raw_handle()) == u32::MAX {
                TerminateProcess(process_handle.as_raw_handle(), 1);
                bail!("Resume worker failed");
            }
            Ok(Worker {
                process: process_handle,
                job,
                input: File::from(input_write),
                output: File::from(output_read),
                pid: process.dwProcessId,
                isolation,
            })
        }
    }
}

pub struct Worker {
    process: OwnedHandle,
    job: OwnedHandle,
    pub input: File,
    pub output: File,
    pub pid: u32,
    pub isolation: Isolation,
}
pub struct JobKiller(OwnedHandle);
impl JobKiller {
    pub fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.0.as_raw_handle(), 0);
        }
    }
}
impl Worker {
    pub fn killer(&self) -> Result<JobKiller> {
        Ok(JobKiller(self.job.try_clone()?))
    }
    pub fn exit_code(&self) -> u32 {
        unsafe {
            let mut code = 0;
            GetExitCodeProcess(self.process.as_raw_handle(), &mut code);
            code
        }
    }
    pub fn stop(&self) {
        unsafe {
            TerminateJobObject(self.job.as_raw_handle(), 0);
            WaitForSingleObject(self.process.as_raw_handle(), 5000);
        }
    }
    pub fn running(&self) -> bool {
        unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) == WAIT_TIMEOUT }
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Isolation {
    pub app_container: bool,
    pub integrity_rid: u32,
    pub container_sid: String,
}

unsafe fn sid_string(sid: PSID) -> Result<String> {
    let mut value = null_mut();
    checked(
        ConvertSidToStringSidW(sid, &mut value),
        "Format AppContainer SID",
    )?;
    let mut len = 0;
    while *value.add(len) != 0 {
        len += 1;
    }
    let result = String::from_utf16_lossy(std::slice::from_raw_parts(value, len));
    LocalFree(value.cast());
    Ok(result)
}
unsafe fn isolation_for(process: HANDLE) -> Result<Isolation> {
    let mut token = null_mut();
    checked(
        OpenProcessToken(process, TOKEN_QUERY, &mut token),
        "Inspect worker token",
    )?;
    let token = own(token);
    let mut needed = 0;
    let mut is_app: u32 = 0;
    checked(
        GetTokenInformation(
            token.as_raw_handle(),
            TokenIsAppContainer,
            (&mut is_app as *mut u32).cast(),
            4,
            &mut needed,
        ),
        "Inspect AppContainer flag",
    )?;
    let mut buffer = [0usize; 64];
    checked(
        GetTokenInformation(
            token.as_raw_handle(),
            TokenIntegrityLevel,
            buffer.as_mut_ptr().cast(),
            size_of_val(&buffer) as u32,
            &mut needed,
        ),
        "Inspect integrity level",
    )?;
    let label = &*(buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>());
    let count = *GetSidSubAuthorityCount(label.Label.Sid);
    if count == 0 {
        bail!("Invalid worker integrity SID");
    }
    let integrity_rid = *GetSidSubAuthority(label.Label.Sid, (count - 1) as u32);
    checked(
        GetTokenInformation(
            token.as_raw_handle(),
            TokenAppContainerSid,
            buffer.as_mut_ptr().cast(),
            size_of_val(&buffer) as u32,
            &mut needed,
        ),
        "Inspect container SID",
    )?;
    let container_sid = sid_string(*(buffer.as_ptr().cast::<PSID>()))?;
    Ok(Isolation {
        app_container: is_app == 1,
        integrity_rid,
        container_sid,
    })
}
pub fn current_isolation() -> Result<Isolation> {
    unsafe { isolation_for(GetCurrentProcess()) }
}

pub fn can_open_process_memory(pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            false
        } else {
            CloseHandle(handle);
            true
        }
    }
}
