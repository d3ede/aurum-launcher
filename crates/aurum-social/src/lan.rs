//! Minecraft's ordinary LAN discovery, advertised only to this computer.
//! The remote world still requires the approved, authenticated QUIC/TCP bridge.
use anyhow::{bail, Result};
use std::{
    net::{Ipv4Addr, SocketAddr, UdpSocket},
    time::{Duration, Instant},
};
pub fn packet(address: SocketAddr, title: &str) -> Result<Vec<u8>> {
    if address.ip() != Ipv4Addr::LOCALHOST || address.port() == 0 {
        bail!("LAN advertisement must name the owned loopback bridge");
    }
    let name = title
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '[' | ']'))
        .take(80)
        .collect::<String>();
    Ok(format!("[MOTD]Aurum: {name}[/MOTD][AD]{}[/AD]", address.port()).into_bytes())
}
pub struct Advertisement {
    socket: UdpSocket,
    bytes: Vec<u8>,
    last: Option<Instant>,
}
impl Advertisement {
    pub fn new(address: SocketAddr, title: &str) -> Result<Self> {
        Ok(Self {
            socket: UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?,
            bytes: packet(address, title)?,
            last: None,
        })
    }
    pub fn tick(&mut self) -> Result<()> {
        if self
            .last
            .is_none_or(|at| at.elapsed() >= Duration::from_secs(1))
        {
            self.last = Some(Instant::now());
            // Unicast reaches Minecraft's native wildcard-bound LAN detector. Never
            // multicast the world or listener onto a physical network interface.
            match self
                .socket
                .send_to(&self.bytes, (Ipv4Addr::LOCALHOST, 4445))
            {
                Ok(_) => {}
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionRefused
                    ) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn only_loopback_and_safe_lan_delimiters() {
        let packet =
            super::packet("127.0.0.1:32123".parse().unwrap(), "World[/MOTD]\n[AD]80").unwrap();
        let text = String::from_utf8(packet).unwrap();
        assert!(text.ends_with("[AD]32123[/AD]"));
        assert_eq!(text.matches("[AD]").count(), 1);
        assert!(!text.contains('\n'));
        for address in ["192.168.1.5:32123", "0.0.0.0:12345", "127.0.0.1:0"] {
            assert!(super::packet(address.parse().unwrap(), "test").is_err());
        }
    }
}
