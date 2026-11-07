//! Persistent identity primitives. Private material stays in the broker.
use anyhow::{bail, Context, Result};
use bech32::{Bech32m, Hrp};
use ring::{
    rand::{SecureRandom, SystemRandom},
    signature::{Ed25519KeyPair, KeyPair, UnparsedPublicKey, ED25519},
};
use std::{
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::{Zeroize, Zeroizing};

pub struct Identity {
    seed: Zeroizing<[u8; 32]>,
    key: Ed25519KeyPair,
}
impl Identity {
    pub fn generate() -> Result<Self> {
        Self::from_seed(random()?)
    }
    pub fn from_seed(seed: [u8; 32]) -> Result<Self> {
        let key = Ed25519KeyPair::from_seed_unchecked(&seed)
            .map_err(|_| anyhow::anyhow!("Invalid Ed25519 identity"))?;
        Ok(Self {
            seed: Zeroizing::new(seed),
            key,
        })
    }
    pub fn public_key(&self) -> [u8; 32] {
        self.key
            .public_key()
            .as_ref()
            .try_into()
            .expect("Ed25519 public key length")
    }
    pub fn id(&self) -> String {
        encode_id(&self.public_key())
    }
    pub fn sign(&self, bytes: &[u8]) -> Vec<u8> {
        self.key.sign(bytes).as_ref().to_vec()
    }
    pub fn discovery_packet(&self, contact: &str) -> Result<Vec<u8>> {
        if contact.len() > 700 {
            bail!("Contact exceeds DHT record limit");
        }
        let keypair = pkarr::Keypair::from_secret_key(&self.seed);
        let packet = pkarr::SignedPacket::builder()
            .txt("_aurum".try_into()?, contact.try_into()?, 300)
            .sign(&keypair)?;
        Ok(packet.as_bytes().to_vec())
    }
    #[cfg(windows)]
    pub fn save(&self, path: &Path) -> Result<()> {
        let bytes = protect(&self.seed[..], true)?;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let nonce = u64::from_le_bytes(random()?);
        let temporary = path.with_extension(format!("{nonce:016x}.pending"));
        let result = (|| -> Result<()> {
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            // No REPLACE_EXISTING: creation is atomic and cannot overwrite an identity.
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
                return Err(std::io::Error::last_os_error().into());
            }
            Ok(())
        })();
        let _ = std::fs::remove_file(temporary);
        result
    }
    #[cfg(windows)]
    pub fn load(path: &Path) -> Result<Self> {
        if std::fs::metadata(path)?.len() > 4096 {
            bail!("Identity file exceeds limit");
        }
        let bytes = Zeroizing::new(protect(&std::fs::read(path)?, false)?);
        Self::from_seed(
            bytes
                .as_slice()
                .try_into()
                .context("Invalid identity length")?,
        )
    }
    pub fn export(&self, password: &str) -> Result<Vec<u8>> {
        if password.chars().count() < 12 || password.len() > 1024 {
            bail!("Use a backup passphrase of at least 12 characters");
        }
        let encryptor = age::Encryptor::with_user_passphrase(password.to_owned().into());
        let mut output = Vec::new();
        let mut writer = encryptor.wrap_output(&mut output)?;
        writer.write_all(b"Aurum Social Identity v1\n")?;
        writer.write_all(&self.seed[..])?;
        writer.finish()?;
        Ok(output)
    }
    pub fn restore(bytes: &[u8], password: &str) -> Result<Self> {
        if bytes.len() > 4096 || password.len() > 1024 {
            bail!("Backup exceeds limit");
        }
        let decryptor = age::Decryptor::new(bytes)?;
        let mut identity = age::scrypt::Identity::new(password.to_owned().into());
        identity.set_max_work_factor(20);
        let mut reader = decryptor.decrypt(std::iter::once(&identity as &dyn age::Identity))?;
        let mut plain = Zeroizing::new(Vec::new());
        reader.by_ref().take(128).read_to_end(&mut plain)?;
        let prefix = b"Aurum Social Identity v1\n";
        if plain.len() != prefix.len() + 32 || !plain.starts_with(prefix) {
            bail!("Invalid Aurum identity backup");
        }
        Self::from_seed(plain[prefix.len()..].try_into()?)
    }
}
pub fn encode_id(key: &[u8; 32]) -> String {
    bech32::encode::<Bech32m>(Hrp::parse_unchecked("aur"), key)
        .expect("fixed ID is within Bech32m length")
}
pub fn qr(id: &str) -> Result<String> {
    decode_id(id)?;
    Ok(qrcode::QrCode::new(format!("aurum://social/add/{id}"))?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(256, 256)
        .build())
}
pub fn decode_id(value: &str) -> Result<[u8; 32]> {
    let value = value
        .trim()
        .strip_prefix("aurum://social/add/")
        .unwrap_or(value.trim());
    if value.len() > 100 || value.contains(['?', '#', '/', '\\']) {
        bail!("Invalid Aurum ID");
    }
    let checked = bech32::primitives::decode::CheckedHrpstring::new::<Bech32m>(value)
        .context("Aurum ID checksum is invalid")?;
    if checked.hrp() != Hrp::parse_unchecked("aur") {
        bail!("Not an Aurum ID");
    }
    let bytes: Vec<u8> = checked.byte_iter().collect();
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Aurum ID must contain a full public key"))
}
pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("System CSPRNG unavailable"))?;
    Ok(bytes)
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn verify(key: &[u8; 32], bytes: &[u8], signature: &[u8]) -> Result<()> {
    UnparsedPublicKey::new(&ED25519, key)
        .verify(bytes, signature)
        .map_err(|_| anyhow::anyhow!("Invalid identity signature"))
}

#[cfg(windows)]
pub(crate) fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 {
            bail!(
                "Windows identity protection failed: {}",
                std::io::Error::last_os_error()
            );
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        if !encrypt {
            std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize).zeroize();
        }
        LocalFree(output.pbData.cast());
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn id_full_key_checksum_and_deep_link() {
        let a = Identity::generate().unwrap();
        assert_eq!(decode_id(&a.id()).unwrap(), a.public_key());
        assert_eq!(
            decode_id(&format!("aurum://social/add/{}", a.id())).unwrap(),
            a.public_key()
        );
        let mut bad = a.id().into_bytes();
        bad[8] = if bad[8] == b'q' { b'p' } else { b'q' };
        assert!(decode_id(std::str::from_utf8(&bad).unwrap()).is_err());
    }
    #[test]
    fn signatures_reject_impersonation_and_tampering() {
        let a = Identity::generate().unwrap();
        let b = Identity::generate().unwrap();
        let s = a.sign(b"hello");
        assert!(verify(&a.public_key(), b"hello", &s).is_ok());
        assert!(verify(&b.public_key(), b"hello", &s).is_err());
        assert!(verify(&a.public_key(), b"hellO", &s).is_err());
    }
    #[test]
    fn encrypted_backup_roundtrip() {
        let a = Identity::generate().unwrap();
        let bytes = a.export("test passphrase only 123456").unwrap();
        assert_eq!(
            Identity::restore(&bytes, "test passphrase only 123456")
                .unwrap()
                .id(),
            a.id()
        );
        assert!(Identity::restore(&bytes, "wrong").is_err());
    }
    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("identity.dpapi");
        let a = Identity::generate().unwrap();
        a.save(&path).unwrap();
        assert_eq!(Identity::load(&path).unwrap().id(), a.id());
        assert!(a.save(&path).is_err());
    }
}
