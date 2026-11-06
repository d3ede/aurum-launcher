//! Kernel-owned listening sockets, bound to process creation time to prevent PID reuse.
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::{
    mem::{size_of, zeroed},
    net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV6},
    ptr::{null_mut, read_unaligned},
};
use windows_sys::Win32::{Foundation::*, NetworkManagement::IpHelper::*, System::Threading::*};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Listener {
    pub pid: u32,
    pub creation_time: u64,
    pub address: SocketAddr,
}
impl Listener {
    pub fn revalidate(&self) -> Result<()> {
        if creation_time(self.pid)? != self.creation_time || !for_pid(self.pid)?.contains(self) {
            bail!("Minecraft listener changed or its process exited");
        }
        Ok(())
    }
    pub fn connect_address(&self) -> SocketAddr {
        let mut address = self.address;
        if address.ip().is_unspecified() {
            address.set_ip(if address.is_ipv4() {
                Ipv4Addr::LOCALHOST.into()
            } else {
                Ipv6Addr::LOCALHOST.into()
            });
        }
        address
    }
}
pub fn creation_time(pid: u32) -> Result<u64> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            bail!(
                "Cannot inspect process owner: {}",
                std::io::Error::last_os_error()
            );
        }
        let (mut created, mut exit, mut kernel, mut user) =
            (zeroed(), zeroed(), zeroed(), zeroed());
        let ok = GetProcessTimes(process, &mut created, &mut exit, &mut kernel, &mut user);
        CloseHandle(process);
        if ok == 0 {
            bail!("Cannot inspect process creation time");
        }
        Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
    }
}
pub fn for_pid(pid: u32) -> Result<Vec<Listener>> {
    let created = creation_time(pid)?;
    let mut result = Vec::new();
    for row in table::<MIB_TCPROW_OWNER_PID>(2)? {
        if row.dwOwningPid == pid && row.dwState == 2 {
            result.push(Listener {
                pid,
                creation_time: created,
                address: SocketAddr::from((
                    Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()),
                    u16::from_be(row.dwLocalPort as u16),
                )),
            });
        }
    }
    for row in table::<MIB_TCP6ROW_OWNER_PID>(23)? {
        if row.dwOwningPid == pid && row.dwState == 2 {
            result.push(Listener {
                pid,
                creation_time: created,
                address: SocketAddr::V6(SocketAddrV6::new(
                    Ipv6Addr::from(row.ucLocalAddr),
                    u16::from_be(row.dwLocalPort as u16),
                    0,
                    row.dwLocalScopeId,
                )),
            });
        }
    }
    if creation_time(pid)? != created {
        bail!("Process was replaced during listener discovery");
    }
    result.sort_by_key(|r| r.address);
    result.dedup();
    Ok(result)
}
fn table<T: Copy>(family: u32) -> Result<Vec<T>> {
    unsafe {
        let mut bytes = 0u32;
        let first = GetExtendedTcpTable(
            null_mut(),
            &mut bytes,
            0,
            family,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        if first != ERROR_INSUFFICIENT_BUFFER && first != 0 {
            bail!("Cannot size kernel listener table: {first}");
        }
        for _ in 0..3 {
            if !(4..=4 * 1024 * 1024).contains(&bytes) {
                bail!("Kernel listener table exceeds bounds");
            }
            let mut buffer = vec![0usize; (bytes as usize).div_ceil(size_of::<usize>())];
            let result = GetExtendedTcpTable(
                buffer.as_mut_ptr().cast(),
                &mut bytes,
                0,
                family,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            );
            if result == ERROR_INSUFFICIENT_BUFFER {
                continue;
            }
            if result != 0 {
                bail!("Cannot read kernel listener table: {result}");
            }
            let pointer = buffer.as_ptr().cast::<u8>();
            let count = read_unaligned(pointer.cast::<u32>()) as usize;
            if count > 65536
                || 4 + count * size_of::<T>() > bytes as usize
                || bytes as usize > buffer.len() * size_of::<usize>()
            {
                bail!("Invalid kernel listener table");
            }
            return Ok((0..count)
                .map(|i| read_unaligned(pointer.add(4 + i * size_of::<T>()).cast::<T>()))
                .collect());
        }
        bail!("Kernel listener table changed repeatedly")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kernel_listener_is_bound_to_creation_time() {
        let tcp = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = tcp.local_addr().unwrap();
        let found = for_pid(std::process::id())
            .unwrap()
            .into_iter()
            .find(|r| r.address == address)
            .unwrap();
        found.revalidate().unwrap();
        let mut replaced = found.clone();
        replaced.creation_time += 1;
        assert!(replaced.revalidate().is_err());
        drop(tcp);
        assert!(found.revalidate().is_err());
    }
}
