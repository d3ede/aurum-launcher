use anyhow::{bail, Context, Result};
use aurum_social::{identity::random, wire::GAME_ALPN};
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use std::{
    net::{Ipv4Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{net::UdpSocket, time::timeout};

pub struct GameEndpoint {
    pub endpoint: noq::Endpoint,
    pub certificate: Vec<u8>,
    key: Vec<u8>,
    punch_socket: std::net::UdpSocket,
    pub mapping: super::udp_mux::Mapping,
    pub stun_error: Option<String>,
    authorized: Mutex<std::collections::BTreeMap<String, Vec<u8>>>,
}
impl GameEndpoint {
    pub async fn bind(port: u16, public: bool) -> Result<Self> {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, port)).await?;
        let local = socket.local_addr()?;
        let (external, stun_error) = if public {
            match timeout(Duration::from_secs(5), stun(&socket)).await {
                Ok(Ok(addr)) => (Some(addr), None),
                Ok(Err(e)) => (None, Some(e.to_string())),
                Err(_) => (None, Some("STUN timed out".into())),
            }
        } else {
            (None, None)
        };
        // Transfer this exact socket, not another socket with a different NAT mapping.
        let socket = socket.into_std()?;
        if socket.local_addr()? != local {
            bail!("Game UDP socket changed during discovery");
        }
        let cert = rcgen::generate_simple_self_signed(vec!["aurum.invalid".into()])?;
        let certificate = cert.cert.der().to_vec();
        let key = cert.signing_key.serialize_der();
        let punch_socket = socket.try_clone()?;
        let (socket, mapping) = super::udp_mux::wrap(socket, external)?;
        let endpoint = noq::Endpoint::new_with_abstract_socket(
            noq::EndpointConfig::default(),
            None,
            socket,
            Arc::new(noq::TokioRuntime),
        )?;
        Ok(Self {
            endpoint,
            certificate,
            key,
            punch_socket,
            mapping,
            stun_error,
            authorized: Mutex::new(std::collections::BTreeMap::new()),
        })
    }
    pub fn external(&self) -> Option<SocketAddr> {
        self.mapping.address()
    }
    pub fn punch(&self, address: SocketAddr, nonce: [u8; 16]) -> Result<()> {
        if address.port() == 0 || address.ip().is_unspecified() || address.ip().is_multicast() {
            bail!("Invalid punch candidate");
        }
        // This clone is used only for sends. QUIC remains the only socket reader.
        // No router mapping, port prediction, scan or amplification protocol.
        let mut bytes = b"AurumUDP".to_vec();
        bytes.extend(nonce);
        for _ in 0..3 {
            self.punch_socket.send_to(&bytes, address)?;
        }
        Ok(())
    }
    fn roots(certificate: &[u8]) -> Result<Arc<rustls::RootCertStore>> {
        if certificate.len() > 2048 {
            bail!("Peer certificate exceeds limit");
        }
        let mut roots = rustls::RootCertStore::empty();
        roots.add(CertificateDer::from(certificate.to_vec()))?;
        Ok(Arc::new(roots))
    }
    pub fn authorize(&self, certificate: &[u8]) -> Result<()> {
        use sha2::{Digest, Sha256};
        Self::roots(certificate)?;
        let hash = format!("{:x}", Sha256::digest(certificate));
        let mut authorized = self
            .authorized
            .lock()
            .map_err(|_| anyhow::anyhow!("Game trust store unavailable"))?;
        if authorized.len() >= 8 && !authorized.contains_key(&hash) {
            bail!("Game trust limit reached");
        }
        authorized.insert(hash, certificate.to_vec());
        self.apply_authorized(&authorized)
    }
    pub fn revoke(&self, hash: &str) -> Result<()> {
        let mut authorized = self
            .authorized
            .lock()
            .map_err(|_| anyhow::anyhow!("Game trust store unavailable"))?;
        authorized.remove(hash);
        self.apply_authorized(&authorized)
    }
    fn apply_authorized(
        &self,
        authorized: &std::collections::BTreeMap<String, Vec<u8>>,
    ) -> Result<()> {
        if authorized.is_empty() {
            self.endpoint.set_server_config(None);
            return Ok(());
        }
        let mut roots = rustls::RootCertStore::empty();
        for certificate in authorized.values() {
            roots.add(CertificateDer::from(certificate.clone()))?;
        }
        let verifier = rustls::server::WebPkiClientVerifier::builder(Arc::new(roots)).build()?;
        let mut tls = rustls::ServerConfig::builder()
            .with_client_cert_verifier(verifier)
            .with_single_cert(
                vec![self.certificate.clone().into()],
                PrivatePkcs8KeyDer::from(self.key.clone()).into(),
            )?;
        tls.alpn_protocols = vec![GAME_ALPN.to_vec()];
        let mut config = noq::ServerConfig::with_crypto(Arc::new(
            noq::crypto::rustls::QuicServerConfig::try_from(tls)?,
        ));
        config.transport_config(transport_config());
        self.endpoint.set_server_config(Some(config));
        Ok(())
    }
    pub async fn connect(
        &self,
        address: SocketAddr,
        certificate: &[u8],
    ) -> Result<noq::Connection> {
        if address.port() == 0 || address.ip().is_unspecified() || address.ip().is_multicast() {
            bail!("Invalid game candidate");
        }
        let mut tls = rustls::ClientConfig::builder()
            .with_root_certificates(Self::roots(certificate)?)
            .with_client_auth_cert(
                vec![self.certificate.clone().into()],
                PrivatePkcs8KeyDer::from(self.key.clone()).into(),
            )?;
        tls.alpn_protocols = vec![GAME_ALPN.to_vec()];
        let mut config = noq::ClientConfig::new(Arc::new(
            noq::crypto::rustls::QuicClientConfig::try_from(tls)?,
        ));
        config.transport_config(transport_config());
        Ok(timeout(
            Duration::from_secs(10),
            self.endpoint
                .connect_with(config, address, "aurum.invalid")?,
        )
        .await
        .context("Direct game connection timed out; try LAN or VPN")??)
    }
}
fn transport_config() -> Arc<noq::TransportConfig> {
    let mut config = noq::TransportConfig::default();
    config.max_concurrent_bidi_streams(8u8.into());
    config.max_concurrent_uni_streams(0u8.into());
    config.max_idle_timeout(Some(
        Duration::from_secs(30).try_into().expect("fixed duration"),
    ));
    config.keep_alive_interval(Some(Duration::from_secs(10)));
    config.receive_window((1024 * 1024u32).into());
    config.stream_receive_window((256 * 1024u32).into());
    config.send_window(1024 * 1024);
    Arc::new(config)
}
async fn stun(socket: &UdpSocket) -> Result<SocketAddr> {
    let target = tokio::net::lookup_host(("stun.cloudflare.com", 3478))
        .await?
        .find(|a| a.is_ipv4())
        .context("No IPv4 STUN address")?;
    let transaction: [u8; 12] = random()?;
    let mut packet = [0u8; 20];
    packet[1] = 1;
    packet[4..8].copy_from_slice(&[0x21, 0x12, 0xa4, 0x42]);
    packet[8..].copy_from_slice(&transaction);
    socket.send_to(&packet, target).await?;
    let mut response = [0u8; 1024];
    loop {
        let (len, source) = socket.recv_from(&mut response).await?;
        if source == target {
            return parse_stun(&response[..len], &transaction);
        }
    }
}
pub fn parse_stun(bytes: &[u8], transaction: &[u8; 12]) -> Result<SocketAddr> {
    if bytes.len() < 20
        || bytes[..2] != [1, 1]
        || bytes[4..8] != [0x21, 0x12, 0xa4, 0x42]
        || &bytes[8..20] != transaction
    {
        bail!("Invalid STUN response");
    }
    let end = 20 + u16::from_be_bytes([bytes[2], bytes[3]]) as usize;
    if end != bytes.len() || !end.is_multiple_of(4) {
        bail!("Invalid STUN length");
    }
    let mut pos = 20;
    while pos + 4 <= end {
        let kind = u16::from_be_bytes([bytes[pos], bytes[pos + 1]]);
        let len = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
        pos += 4;
        if pos + len > end {
            bail!("Truncated STUN attribute");
        }
        if kind == 0x0020 && len == 8 && bytes[pos + 1] == 1 {
            let port = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) ^ 0x2112;
            let ip = Ipv4Addr::new(
                bytes[pos + 4] ^ 0x21,
                bytes[pos + 5] ^ 0x12,
                bytes[pos + 6] ^ 0xa4,
                bytes[pos + 7] ^ 0x42,
            );
            if port == 0 || ip.is_unspecified() || ip.is_multicast() || ip.is_loopback() {
                bail!("Invalid STUN mapped address");
            }
            return Ok(SocketAddr::from((ip, port)));
        }
        pos += len.div_ceil(4) * 4;
    }
    bail!("No IPv4 XOR-MAPPED-ADDRESS in STUN response")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stun_xor_address_and_transaction_validation() {
        let id = [7u8; 12];
        let mut b = vec![1, 1, 0, 12, 0x21, 0x12, 0xa4, 0x42];
        b.extend(id);
        b.extend([0, 0x20, 0, 8, 0, 1, 0x32, 0x9a, 0x22, 0x13, 0xa5, 0x43]);
        assert_eq!(
            parse_stun(&b, &id).unwrap(),
            "3.1.1.1:5000".parse().unwrap()
        );
        assert!(parse_stun(&b, &[0; 12]).is_err());
        b.pop();
        assert!(parse_stun(&b, &id).is_err());
    }
}
