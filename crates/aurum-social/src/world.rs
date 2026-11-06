//! Signed invitation data, never launcher commands, Java arguments or filesystem paths.
use crate::manifest::Manifest;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldSpec {
    pub name: String,
    pub minecraft: String,
    pub loader: String,
    pub loader_version: Option<String>,
}
impl WorldSpec {
    pub fn validate(&self) -> Result<()> {
        Manifest {
            version: 1,
            name: self.name.clone(),
            minecraft: self.minecraft.clone(),
            loader: self.loader.clone(),
            loader_version: self.loader_version.clone(),
            files: Vec::new(),
        }
        .validate()
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Offer {
    pub id: String,
    pub expires: u64,
    pub world: WorldSpec,
    pub manifest_hash: Option<String>,
    pub manifest_bytes: usize,
    pub files: usize,
    pub download_bytes: u64,
}
impl Offer {
    pub fn validate(&self) -> Result<()> {
        self.world.validate()?;
        let now = crate::identity::now();
        if self.id.len() != 32
            || !self.id.bytes().all(|b| b.is_ascii_hexdigit())
            || self.expires <= now
            || self.expires > now + 1800
            || self.manifest_bytes > crate::manifest::MAX_MANIFEST
            || self.files > 2000
            || self.download_bytes > 32 * 1024 * 1024 * 1024
        {
            bail!("Invalid or expired world invitation");
        }
        match &self.manifest_hash {
            Some(hash)
                if hash.len() == 64
                    && hash.bytes().all(|b| b.is_ascii_hexdigit())
                    && self.manifest_bytes > 0 => {}
            None if self.manifest_bytes == 0 => {}
            _ => bail!("Invalid shared manifest descriptor"),
        };
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameContact {
    pub certificate: Vec<u8>,
    pub candidates: Vec<std::net::SocketAddr>,
}
impl GameContact {
    pub fn validate(&self) -> Result<()> {
        if self.certificate.is_empty()
            || self.certificate.len() > 2048
            || self.candidates.is_empty()
            || self.candidates.len() > 8
        {
            bail!("Invalid game endpoint description");
        }
        for address in &self.candidates {
            if address.is_ipv6() {
                bail!("This direct game transport requires an IPv4 route or IPv4 VPN");
            }
            let ip = address.ip();
            if address.port() == 0 || ip.is_unspecified() || ip.is_multicast() || ip.is_loopback() {
                bail!("Invalid peer game address");
            }
            if let std::net::IpAddr::V4(ip) = ip {
                if ip.is_link_local() || ip.is_broadcast() || ip.octets()[0] == 0 {
                    bail!("Reserved peer game address");
                }
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub from: String,
    pub offer: Offer,
    pub manifest: Option<Manifest>,
    pub status: String,
    pub join_address: Option<String>,
}
pub struct Assembly {
    pub peer: [u8; 32],
    pub offer: Offer,
    bytes: Vec<u8>,
}
impl Assembly {
    pub fn new(peer: [u8; 32], offer: Offer) -> Result<Self> {
        offer.validate()?;
        Ok(Self {
            peer,
            offer,
            bytes: Vec::new(),
        })
    }
    pub fn push(&mut self, offset: usize, chunk: &[u8]) -> Result<Option<Manifest>> {
        if offset != self.bytes.len()
            || chunk.is_empty()
            || chunk.len() > 1024
            || self.bytes.len() + chunk.len() > self.offer.manifest_bytes
        {
            bail!("Invalid shared manifest fragment");
        }
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() != self.offer.manifest_bytes {
            return Ok(None);
        }
        use sha2::{Digest, Sha256};
        if Some(format!("{:x}", Sha256::digest(&self.bytes))) != self.offer.manifest_hash {
            bail!("Shared manifest digest mismatch");
        }
        let manifest = Manifest::decode(&self.bytes)?;
        if manifest.minecraft != self.offer.world.minecraft
            || manifest.loader != self.offer.world.loader
            || manifest.loader_version != self.offer.world.loader_version
            || manifest.files.len() != self.offer.files
            || manifest.files.iter().map(|f| f.bytes).sum::<u64>() != self.offer.download_bytes
        {
            bail!("Shared manifest differs from the invitation");
        }
        Ok(Some(manifest))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn assembly() -> (Assembly, Vec<u8>) {
        use sha2::{Digest, Sha256};
        let manifest = Manifest {
            version: 1,
            name: "fixture".into(),
            minecraft: "1.21.1".into(),
            loader: "vanilla".into(),
            loader_version: None,
            files: Vec::new(),
        };
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let offer = Offer {
            id: "a".repeat(32),
            expires: crate::identity::now() + 120,
            world: WorldSpec {
                name: "fixture".into(),
                minecraft: manifest.minecraft.clone(),
                loader: manifest.loader.clone(),
                loader_version: None,
            },
            manifest_hash: Some(format!("{:x}", Sha256::digest(&bytes))),
            manifest_bytes: bytes.len(),
            files: 0,
            download_bytes: 0,
        };
        (Assembly::new([1; 32], offer).unwrap(), bytes)
    }
    #[test]
    fn assembly_rejects_reordering_tampering_metadata_and_expiry() {
        let (mut a, bytes) = assembly();
        assert!(a.push(1, &bytes[..1]).is_err());
        assert!(a.push(0, &bytes[..3]).unwrap().is_none());
        assert!(a.push(0, &bytes[3..]).is_err());
        assert!(a.push(3, &bytes[3..]).unwrap().is_some());
        let (mut a, mut bytes) = assembly();
        bytes[0] ^= 1;
        assert!(a.push(0, &bytes).is_err());
        let (mut a, bytes) = assembly();
        a.offer.world.minecraft = "1.20.1".into();
        assert!(a.push(0, &bytes).is_err());
        let (mut a, _) = assembly();
        a.offer.expires = crate::identity::now() - 1;
        assert!(a.offer.validate().is_err());
    }
    #[test]
    fn rejects_reserved_targets() {
        for address in [
            "127.0.0.1:80",
            "169.254.169.254:80",
            "224.0.0.1:123",
            "0.0.0.0:80",
        ] {
            assert!(GameContact {
                certificate: vec![1],
                candidates: vec![address.parse().unwrap()]
            }
            .validate()
            .is_err());
        }
    }
}
