//! Root-signed contact records: validation is repeated outside the network worker.
use crate::identity::{now, Identity};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contact {
    pub version: u8,
    pub expires: u64,
    pub endpoint: String,
}
pub fn sign(identity: &Identity, endpoint: String) -> Result<Vec<u8>> {
    let contact = Contact {
        version: 1,
        expires: now() + 300,
        endpoint,
    };
    identity.discovery_packet(&serde_json::to_string(&contact)?)
}
pub fn verify(expected: &[u8; 32], bytes: &[u8]) -> Result<Contact> {
    if !(104..=1104).contains(&bytes.len()) || !bytes.starts_with(expected) {
        bail!("Discovery identity or size mismatch");
    }
    let key = pkarr::PublicKey::try_from(&expected[..])?;
    // Unlike SignedPacket::deserialize, this verifies the Ed25519 signature.
    let packet = pkarr::SignedPacket::from_relay_payload(&key, &bytes[32..].to_vec().into())?;
    let records = packet.resource_records("_aurum").collect::<Vec<_>>();
    if records.len() != 1 {
        bail!("Invalid Aurum discovery records");
    }
    let pkarr::dns::rdata::RData::TXT(text) = &records[0].rdata else {
        bail!("Invalid contact record type");
    };
    let text: String = text.clone().try_into()?;
    if text.len() > 700 {
        bail!("Contact exceeds limit");
    }
    let contact: Contact = serde_json::from_str(&text)?;
    let now = now();
    if contact.version != 1
        || contact.expires < now
        || contact.expires > now + 360
        || contact.endpoint.len() > 600
    {
        bail!("Unsupported or expired Aurum contact");
    }
    let endpoint: serde_json::Value = serde_json::from_str(&contact.endpoint)?;
    let id = endpoint["id"]
        .as_str()
        .context("Missing endpoint identity")?;
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("Invalid transport identity");
    }
    Ok(contact)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_root_and_forgery() {
        let a = Identity::generate().unwrap();
        let b = Identity::generate().unwrap();
        let endpoint = format!("{{\"id\":\"{}\",\"addrs\":[]}}", "a".repeat(64));
        let mut packet = sign(&a, endpoint).unwrap();
        assert!(verify(&a.public_key(), &packet).is_ok());
        assert!(verify(&b.public_key(), &packet).is_err());
        packet[40] ^= 1;
        assert!(verify(&a.public_key(), &packet).is_err());
    }
}
