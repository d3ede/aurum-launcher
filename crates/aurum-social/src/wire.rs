//! Length-bounded IPC. Neither this transport nor a peer can select a launcher RPC.
use anyhow::{bail, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::io::{Read, Write};
// JSON byte arrays need up to four bytes per payload byte. Leave room for
// a maximal 16 KiB Social frame and its bounded endpoint/IPC metadata.
pub const MAX_FRAME: usize = 96 * 1024;
pub const SOCIAL_ALPN: &[u8] = b"aurum/social/1";
pub const PHOTO_ALPN: &[u8] = b"aurum/photos/1";
pub const GAME_ALPN: &[u8] = b"aurum/game/1";
pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let body = serde_json::to_vec(value)?;
    if body.len() > MAX_FRAME {
        bail!("Social frame exceeds limit");
    }
    let mut bytes = Vec::with_capacity(body.len() + 8);
    bytes.extend_from_slice(b"AUS1");
    bytes.extend_from_slice(&(body.len() as u32).to_be_bytes());
    bytes.extend_from_slice(&body);
    Ok(bytes)
}
pub fn write<T: Serialize>(writer: &mut impl Write, value: &T) -> Result<()> {
    writer.write_all(&encode(value)?)?;
    writer.flush()?;
    Ok(())
}
pub fn read<T: DeserializeOwned>(reader: &mut impl Read) -> Result<T> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header)?;
    if &header[..4] != b"AUS1" {
        bail!("Invalid Social protocol");
    }
    let len = u32::from_be_bytes(header[4..].try_into()?) as usize;
    if len == 0 || len > MAX_FRAME {
        bail!("Social frame exceeds limit");
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    Ok(serde_json::from_slice(&body)?)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    PhotoConnect { address: String, id: String },
    PhotoAccept { stream: u64 },
    PhotoWrite { stream: u64, bytes: Vec<u8> },
    PhotoFinish { stream: u64 },
    PhotoComplete { stream: u64 },
    PhotoClose { stream: u64 },
    Start {
        public_relays: bool,
        ports: [u16; 3],
    },
    Refresh,
    ProbeSandbox {
        canary: String,
        parent_pid: u32,
    },
    Publish {
        packet: Vec<u8>,
    },
    Resolve {
        public_key: [u8; 32],
    },
    Send {
        address: String,
        bytes: Vec<u8>,
    },
    GameAuthorize {
        certificate: Vec<u8>,
    },
    GameRevoke {
        certificate_hash: String,
    },
    GameConnect {
        address: std::net::SocketAddr,
        certificate: Vec<u8>,
    },
    GamePunch {
        address: std::net::SocketAddr,
        nonce: [u8; 16],
    },
    GameWrite {
        stream: u64,
        bytes: Vec<u8>,
    },
    GameClose {
        stream: u64,
    },
    Stop,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Response {
    PhotoOpened { id: String, stream: u64, transport_key: [u8;32], incoming: bool },
    PhotoData { stream: u64, bytes: Vec<u8> },
    PhotoWritten { stream: u64, bytes: usize },
    PhotoEnd { stream: u64 },
    PhotoDelivered { stream: u64 },
    PhotoFailed { id: String, message: String },
    GameAddress {
        address: String,
        certificate: Vec<u8>,
        port: u16,
        external: Option<std::net::SocketAddr>,
    },
    Ready {
        address: String,
        game_certificate: Vec<u8>,
        game_port: u16,
        game_external: Option<std::net::SocketAddr>,
        stun_error: Option<String>,
    },
    SandboxProbe {
        app_container: bool,
        integrity_rid: u32,
        canary_denied: bool,
        child_denied: bool,
        parent_memory_denied: bool,
    },
    Published {
        nodes: usize,
    },
    Resolved {
        packet: Vec<u8>,
    },
    Received {
        transport_key: [u8; 32],
        bytes: Vec<u8>,
    },
    Sent,
    GameAuthorized,
    GameOpened {
        stream: u64,
        certificate_hash: String,
    },
    GameData {
        stream: u64,
        bytes: Vec<u8>,
    },
    GameClosed {
        stream: u64,
    },
    Stopped,
    Error {
        operation: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedMessage {
    pub sender: [u8; 32],
    pub recipient: [u8; 32],
    pub session: [u8; 32],
    pub sequence: u64,
    pub expires: u64,
    pub body: Vec<u8>,
    pub signature: Vec<u8>,
}
impl SignedMessage {
    fn signable(&self) -> Result<Vec<u8>> {
        if self.body.len() > 16 * 1024 {
            bail!("Message body exceeds limit");
        }
        let mut bytes = b"Aurum Social signed message v1\0".to_vec();
        bytes.extend(self.sender);
        bytes.extend(self.recipient);
        bytes.extend(self.session);
        bytes.extend(self.sequence.to_be_bytes());
        bytes.extend(self.expires.to_be_bytes());
        bytes.extend((self.body.len() as u32).to_be_bytes());
        bytes.extend(&self.body);
        Ok(bytes)
    }
    pub fn new(
        identity: &crate::identity::Identity,
        recipient: [u8; 32],
        session: [u8; 32],
        sequence: u64,
        body: Vec<u8>,
    ) -> Result<Self> {
        let mut message = Self {
            sender: identity.public_key(),
            recipient,
            session,
            sequence,
            expires: crate::identity::now() + 120,
            body,
            signature: Vec::new(),
        };
        message.signature = identity.sign(&message.signable()?);
        Ok(message)
    }
    pub fn verify(
        &self,
        recipient: &[u8; 32],
        session: &[u8; 32],
        last_sequence: u64,
    ) -> Result<()> {
        let now = crate::identity::now();
        if &self.recipient != recipient
            || &self.session != session
            || self.sequence <= last_sequence
            || self.expires < now
            || self.expires > now + 180
        {
            bail!("Expired, replayed or misdirected message");
        }
        crate::identity::verify(&self.sender, &self.signable()?, &self.signature)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oversized_rejected_before_reading_body() {
        let bytes = [b'A', b'U', b'S', b'1', 255, 255, 255, 255];
        assert!(read::<Command>(&mut bytes.as_slice()).is_err());
    }
    #[test]
    fn unknown_privileged_command_rejected() {
        let body = encode(&serde_json::json!({"type":"launch","path":"cmd.exe"})).unwrap();
        assert!(read::<Command>(&mut body.as_slice()).is_err());
    }
    #[test]
    fn maximum_byte_array_fits_the_bounded_ipc_envelope() {
        let encoded = encode(&Response::Received {
            transport_key: [255; 32],
            bytes: vec![255; 16384],
        })
        .unwrap();
        assert!(encoded.len() <= MAX_FRAME + 8);
        let decoded = read::<Response>(&mut encoded.as_slice()).unwrap();
        assert!(matches!(decoded,Response::Received{bytes,..}if bytes.len()==16384));
        let mut header = b"AUS1".to_vec();
        header.extend(((MAX_FRAME + 1) as u32).to_be_bytes());
        assert!(read::<Command>(&mut header.as_slice()).is_err());
    }
    #[test]
    fn replay_recipient_session_and_signature() {
        let a = crate::identity::Identity::generate().unwrap();
        let b = crate::identity::Identity::generate().unwrap();
        let session = [7u8; 32];
        let mut message = SignedMessage::new(&a, b.public_key(), session, 1, vec![1]).unwrap();
        assert!(message.verify(&b.public_key(), &session, 0).is_ok());
        assert!(message.verify(&b.public_key(), &session, 1).is_err());
        assert!(message.verify(&a.public_key(), &session, 0).is_err());
        assert!(message.verify(&b.public_key(), &[0; 32], 0).is_err());
        message.body.push(3);
        assert!(message.verify(&b.public_key(), &session, 0).is_err());
        let mut expired = SignedMessage::new(&a, b.public_key(), session, 2, vec![]).unwrap();
        expired.expires = crate::identity::now() - 1;
        assert!(expired.verify(&b.public_key(), &session, 0).is_err());
        let mut impersonated = SignedMessage::new(&a, b.public_key(), session, 3, vec![]).unwrap();
        impersonated.sender = b.public_key();
        assert!(impersonated.verify(&b.public_key(), &session, 0).is_err());
    }
    proptest::proptest! { #[test] fn parser_never_panics(bytes in proptest::collection::vec(proptest::num::u8::ANY, 0..70000)) { let _ = read::<Command>(&mut bytes.as_slice()); } }
}
