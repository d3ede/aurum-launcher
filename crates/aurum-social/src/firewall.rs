//! One-shot COM configuration; no service, persistent privileged IPC or shell.
use crate::sandbox::Container;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;
use windows::{
    core::BSTR,
    Win32::{Foundation::VARIANT_TRUE, NetworkManagement::WindowsFirewall::*, System::Com::*},
};
pub const PORTS: [u16; 3] = [47631, 47632, 47633];
pub const GROUP: &str = "Aurum Social v1";
pub fn request_configuration(program: &Path) -> Result<()> {
    if status(program, false)?
        .iter()
        .all(|r| r.present && r.scoped)
    {
        return Ok(());
    }
    request_change(program, false)
}
pub fn request_removal(program: &Path) -> Result<()> {
    if status(program, false)?.iter().all(|r| !r.present) {
        return Ok(());
    }
    request_change(program, true)
}
fn request_change(program: &Path, remove: bool) -> Result<()> {
    let helper = program
        .with_file_name("aurum-social-firewall.exe")
        .canonicalize()?;
    elevate(&helper, if remove { "remove" } else { "install" })?;
    if !status(program, false)?.iter().all(|r| {
        if remove {
            !r.present
        } else {
            r.present && r.scoped
        }
    }) {
        bail!("Scoped Firewall rule could not be verified");
    }
    Ok(())
}

// Uninstall must also work after a launcher update, before the new optional
// worker has been downloaded. Only these fixed, owned rules can be removed.
pub fn request_cleanup() -> Result<()> {
    if owned_rules()?.is_empty() {
        return Ok(());
    }
    elevate(&std::env::current_exe()?, "--social-firewall-remove")?;
    if !owned_rules()?.is_empty() {
        bail!("Social Firewall cleanup failed");
    }
    Ok(())
}

fn owned_rules() -> Result<Vec<String>> {
    let _com = Com::new()?;
    let policy: INetFwPolicy2 =
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)? };
    let rules = unsafe { policy.Rules()? };
    let rule_name = name(false, 0);
    if let Ok(rule) = unsafe { rules.Item(&BSTR::from(&rule_name)) } {
        if unsafe { rule.Grouping()? } == GROUP {
            return Ok(vec![rule_name]);
        }
    }
    Ok(Vec::new())
}

pub fn remove_owned_rules() -> Result<()> {
    let names = owned_rules()?;
    let _com = Com::new()?;
    let policy: INetFwPolicy2 =
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)? };
    let rules = unsafe { policy.Rules()? };
    for name in names {
        unsafe {
            rules.Remove(&BSTR::from(name))?;
        }
    }
    Ok(())
}

fn elevate(helper: &Path, operation: &str) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{GetExitCodeProcess, WaitForSingleObject},
    };
    let file: Vec<u16> = helper.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();
    let args: Vec<u16> = operation.encode_utf16().chain(Some(0)).collect();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(args.as_ptr()),
        nShow: 0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info)?;
        if info.hProcess.is_invalid() {
            bail!("Firewall setup did not return a process handle");
        }
        let handle = info.hProcess.0;
        let waited = WaitForSingleObject(handle, 60000);
        let mut code = 1;
        GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        if waited != 0 || code != 0 {
            bail!("Firewall setup was cancelled or failed");
        }
    }
    Ok(())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleStatus {
    pub name: String,
    pub present: bool,
    pub scoped: bool,
}
struct Com;
impl Com {
    fn new() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
fn name(lab: bool, index: usize) -> String {
    format!(
        "Aurum Social v1 {} UDP",
        if lab {
            if index == 0 {
                "LabA"
            } else {
                "LabB"
            }
        } else {
            "Client"
        }
    )
}
fn containers(lab: bool) -> &'static [&'static str] {
    if lab {
        &["Aurum.Social.LabA.v1", "Aurum.Social.LabB.v1"]
    } else {
        &["Aurum.Social.Client.v1"]
    }
}
pub fn status(program: &Path, lab: bool) -> Result<Vec<RuleStatus>> {
    let _com = Com::new()?;
    let policy: INetFwPolicy2 =
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)? };
    let rules = unsafe { policy.Rules()? };
    let program = program
        .canonicalize()?
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_owned();
    containers(lab)
        .iter()
        .enumerate()
        .map(|(i, container)| {
            let name = name(lab, i);
            let sid = Container::open(container)?.sid_string()?;
            let existing = unsafe { rules.Item(&BSTR::from(&name)) };
            match existing {
                Ok(rule) => {
                    use windows::core::Interface;
                    let rule: INetFwRule3 = rule.cast()?;
                    let scoped = unsafe {
                        rule.ApplicationName()?
                            .to_string()
                            .eq_ignore_ascii_case(&program)
                            && rule.LocalAppPackageId()? == sid.as_str()
                            && rule.Protocol()? == 17
                            && rule.LocalPorts()? == "47631-47633"
                            && rule.Direction()? == NET_FW_RULE_DIR_IN
                            && rule.Action()? == NET_FW_ACTION_ALLOW
                            && rule.Enabled()? == VARIANT_TRUE
                    };
                    Ok(RuleStatus {
                        name,
                        present: true,
                        scoped,
                    })
                }
                Err(_) => Ok(RuleStatus {
                    name,
                    present: false,
                    scoped: false,
                }),
            }
        })
        .collect()
}
pub fn configure(program: &Path, lab: bool, remove: bool) -> Result<()> {
    let _com = Com::new()?;
    let program = program.canonicalize()?;
    if program.file_name().and_then(|n| n.to_str()) != Some("aurum-social-worker.exe") {
        bail!("Firewall target must be the bundled Social worker");
    }
    let path = program
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_owned();
    let policy: INetFwPolicy2 =
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)? };
    let rules = unsafe { policy.Rules()? };
    for (index, container) in containers(lab).iter().enumerate() {
        let name = BSTR::from(name(lab, index));
        if let Ok(existing) = unsafe { rules.Item(&name) } {
            if unsafe { existing.Grouping()? } != GROUP {
                bail!("Refusing to replace a firewall rule not owned by Aurum Social");
            }
            unsafe {
                rules.Remove(&name)?;
            }
        }
        if remove {
            continue;
        }
        let sid = Container::open(container)?.sid_string()?;
        let rule: INetFwRule3 =
            unsafe { CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER)? };
        unsafe {
            rule.SetName(&name)?;
            rule.SetGrouping(&BSTR::from(GROUP))?;
            rule.SetDescription(&BSTR::from(
                "Aurum Social isolated worker; no Java, TCP, UPnP or loopback exemption",
            ))?;
            rule.SetApplicationName(&BSTR::from(&path))?;
            rule.SetLocalAppPackageId(&BSTR::from(sid))?;
            rule.SetProtocol(17)?;
            rule.SetLocalPorts(&BSTR::from("47631-47633"))?;
            rule.SetDirection(NET_FW_RULE_DIR_IN)?;
            rule.SetAction(NET_FW_ACTION_ALLOW)?;
            rule.SetProfiles(NET_FW_PROFILE2_ALL.0)?;
            rule.SetEnabled(VARIANT_TRUE)?;
            rules
                .Add(&rule)
                .context("Windows rejected the scoped Firewall rule; Social remains disabled")?;
        }
    }
    Ok(())
}
