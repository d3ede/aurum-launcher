//! Durable encrypted attachment objects. Network transport never receives a file path.
//! The same opaque ciphertext objects can later be carried by an offline relay.
use crate::identity;
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub const MAX_PHOTO: u64 = 25 * 1024 * 1024;
pub const MAX_BATCH: u64 = 100 * 1024 * 1024;
pub const MAX_STORAGE: u64 = 1024 * 1024 * 1024;
pub const CHUNK: usize = 8192;

pub struct NewPhoto {
    pub source_id: Option<String>,
    pub name: String,
    pub profile_name: String,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Offer {
    pub version: u8,
    pub id: String,
    pub batch: String,
    pub count: usize,
    pub sender: String,
    pub recipient: String,
    pub name: String,
    pub profile_name: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub sha256: String,
    // Content key is delivered only over the authenticated, encrypted peer channel.
    // On disk it is inside the DPAPI-encrypted index, never next to the ciphertext.
    pub key: String,
    pub nonce: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub decision: Option<bool>,
    pub offer: Offer,
    pub direction: String,
    pub status: String,
    pub created_at: u64,
    pub transferred: u64,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub source_id: Option<String>,
    pub decision: Option<bool>,
    pub count: usize,
    pub id: String,
    pub batch: String,
    pub peer: String,
    pub direction: String,
    pub status: String,
    pub name: String,
    pub profile_name: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub transferred: u64,
    pub created_at: u64,
    pub error: Option<String>,
}
impl Entry {
    fn stored(&self) -> bool {
        !matches!(
            self.status.as_str(),
            "delivered" | "cancelled" | "deleted" | "rejected"
        )
    }
    pub fn summary(&self) -> Summary {
        Summary {
            source_id: self.source_id.clone(),
            decision: self.decision,
            count: self.offer.count,
            id: self.offer.id.clone(),
            batch: self.offer.batch.clone(),
            peer: if self.direction == "outgoing" {
                self.offer.recipient.clone()
            } else {
                self.offer.sender.clone()
            },
            direction: self.direction.clone(),
            status: self.status.clone(),
            name: self.offer.name.clone(),
            profile_name: self.offer.profile_name.clone(),
            width: self.offer.width,
            height: self.offer.height,
            bytes: self.offer.bytes.saturating_sub(16),
            transferred: self.transferred.min(self.offer.bytes),
            created_at: self.created_at,
            error: self.error.clone(),
        }
    }
}
#[derive(Default, Serialize, Deserialize)]
struct Book {
    entries: Vec<Entry>,
}
impl Book {
    fn compact(&mut self) {
        self.entries
            .sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
        let mut receipts = 0;
        self.entries.retain(|entry| {
            if entry.stored() {
                return true;
            }
            receipts += 1;
            receipts <= 200
        });
    }
    fn bytes(&self) -> u64 {
        self.entries
            .iter()
            .filter(|entry| entry.stored())
            .map(|entry| entry.offer.bytes)
            .sum()
    }
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn new_id() -> Result<String> {
    Ok(identity::random::<16>()?
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn label(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.chars().count() <= limit && !value.chars().any(char::is_control)
}
impl Offer {
    pub fn validate(&self, sender: &str, recipient: &str) -> Result<()> {
        if self.version != 2
            || !valid_id(&self.id)
            || !valid_id(&self.batch)
            || !(1..=10).contains(&self.count)
            || self.sender != sender
            || self.recipient != recipient
            || self.bytes <= 16
            || self.bytes > MAX_PHOTO + 16
            || !label(&self.name, 240)
            || !label(&self.profile_name, 160)
            || self.width == 0
            || self.height == 0
            || self.width > 16384
            || self.height > 16384
            || u64::from(self.width) * u64::from(self.height) > 36_000_000
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || STANDARD.decode(&self.key)?.len() != 32
            || STANDARD.decode(&self.nonce)?.len() != 12
        {
            bail!("Invalid screenshot offer");
        }
        identity::decode_id(sender)?;
        identity::decode_id(recipient)?;
        Ok(())
    }
    fn aad(&self) -> Vec<u8> {
        format!(
            "Aurum screenshot v1\0{}\0{}\0{}",
            self.sender, self.recipient, self.id
        )
        .into_bytes()
    }
    fn cipher(&self) -> Result<(LessSafeKey, Nonce)> {
        let key = STANDARD.decode(&self.key)?;
        let cipher = LessSafeKey::new(
            UnboundKey::new(&aead::AES_256_GCM, &key)
                .map_err(|_| anyhow::anyhow!("Invalid screenshot key"))?,
        );
        let nonce: [u8; 12] = STANDARD
            .decode(&self.nonce)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Invalid screenshot nonce"))?;
        Ok((cipher, Nonce::assume_unique_for_key(nonce)))
    }
    pub fn decrypt(&self, mut bytes: Vec<u8>) -> Result<Vec<u8>> {
        if bytes.len() as u64 != self.bytes || hash(&bytes) != self.sha256 {
            bail!("Screenshot checksum mismatch");
        }
        let (cipher, nonce) = self.cipher()?;
        let len = cipher
            .open_in_place(nonce, Aad::from(self.aad()), &mut bytes)
            .map_err(|_| anyhow::anyhow!("Screenshot authentication failed"))?
            .len();
        bytes.truncate(len);
        Ok(bytes)
    }
}

#[derive(Clone)]
pub struct Store {
    root: PathBuf,
    lock: Arc<Mutex<()>>,
}
impl Store {
    pub fn new(root: PathBuf, lock: Arc<Mutex<()>>) -> Self {
        Self { root, lock }
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        if !valid_id(id) {
            bail!("Invalid screenshot ID");
        }
        Ok(self.root.join(format!("{id}.bin")))
    }
    pub fn partial(&self, id: &str) -> Result<PathBuf> {
        Ok(self.path(id)?.with_extension("part"))
    }
    fn load(&self) -> Result<Book> {
        let path = self.root.join("index.dpapi");
        if !path.try_exists()? {
            return Ok(Book::default());
        }
        if std::fs::metadata(&path)?.len() > 8 * 1024 * 1024 {
            bail!("Screenshot index exceeds limit");
        }
        Ok(serde_json::from_slice(&identity::protect(
            &std::fs::read(path)?,
            false,
        )?)?)
    }
    fn save(&self, book: &Book) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        let temporary = self.root.join(format!("index.{}.pending", new_id()?));
        let result = (|| -> Result<()> {
            use std::io::Write;
            let clear = serde_json::to_vec(book)?;
            if clear.len() > 8 * 1024 * 1024 - 4096 {
                bail!("Screenshot index exceeds limit");
            }
            let bytes = identity::protect(&clear, true)?;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, self.root.join("index.dpapi"))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    }
    pub fn entries(&self) -> Result<Vec<Entry>> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        Ok(self.load()?.entries)
    }
    pub fn entry(&self, id: &str) -> Result<Option<Entry>> {
        Ok(self.entries()?.into_iter().find(|e| e.offer.id == id))
    }
    pub fn verify_payload(&self, entry: &Entry) -> Result<()> {
        let path = self.path(&entry.offer.id)?;
        let metadata = std::fs::symlink_metadata(&path)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() != entry.offer.bytes
            || crate::manifest::hash_file(&path)? != entry.offer.sha256
        {
            bail!("Queued screenshot copy is damaged; select the screenshot again");
        }
        Ok(())
    }
    pub fn update(
        &self,
        id: &str,
        status: &str,
        transferred: u64,
        error: Option<String>,
    ) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        let entry = book
            .entries
            .iter_mut()
            .find(|e| e.offer.id == id)
            .context("Screenshot transfer no longer exists")?;
        if matches!(
            entry.status.as_str(),
            "cancelled" | "delivered" | "received" | "deleted" | "rejected"
        ) {
            return Ok(());
        }
        entry.status = status.into();
        entry.transferred = transferred;
        entry.error = error.map(|e| e.chars().take(180).collect());
        let disposable = entry.direction == "outgoing"
            && matches!(
                entry.status.as_str(),
                "delivered" | "cancelled" | "rejected"
            );
        self.save(&book)?;
        if disposable {
            let _ = std::fs::remove_file(self.path(id)?);
        }
        Ok(())
    }
    pub fn enqueue(
        &self,
        sender: &str,
        recipient: &str,
        images: Vec<NewPhoto>,
    ) -> Result<Vec<String>> {
        if images.is_empty() || images.len() > 10 {
            bail!("Select between 1 and 10 screenshots");
        }
        let batch = new_id()?;
        let count = images.len();
        let mut total = 0;
        let mut prepared = Vec::new();
        std::fs::create_dir_all(&self.root)?;
        for image in images {
            total += image.bytes.len() as u64;
            if total > MAX_BATCH || image.bytes.is_empty() || image.bytes.len() as u64 > MAX_PHOTO {
                bail!("Screenshot batch exceeds its size limit");
            }
            let mut offer = Offer {
                version: 2,
                id: new_id()?,
                batch: batch.clone(),
                count,
                sender: sender.into(),
                recipient: recipient.into(),
                name: image.name,
                profile_name: image.profile_name,
                width: image.width,
                height: image.height,
                bytes: image.bytes.len() as u64 + 16,
                sha256: "0".repeat(64),
                key: STANDARD.encode(identity::random::<32>()?),
                nonce: STANDARD.encode(identity::random::<12>()?),
            };
            offer.validate(sender, recipient)?;
            let (cipher, nonce) = offer.cipher()?;
            let mut bytes = image.bytes;
            cipher
                .seal_in_place_append_tag(nonce, Aad::from(offer.aad()), &mut bytes)
                .map_err(|_| anyhow::anyhow!("Screenshot encryption failed"))?;
            offer.sha256 = hash(&bytes);
            prepared.push((
                Entry {
                    source_id: image.source_id,
                    decision: None,
                    offer,
                    direction: "outgoing".into(),
                    status: "queued".into(),
                    created_at: identity::now() * 1000,
                    transferred: 0,
                    error: None,
                },
                bytes,
            ));
        }
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        book.compact();
        if book.bytes() + total > MAX_STORAGE
            || book.entries.iter().filter(|entry| entry.stored()).count() + prepared.len() > 2000
        {
            bail!("Screenshot storage is full");
        }
        let ids = prepared
            .iter()
            .map(|(entry, _)| entry.offer.id.clone())
            .collect::<Vec<_>>();
        let result = (|| -> Result<()> {
            for (entry, bytes) in prepared {
                let path = self.path(&entry.offer.id)?;
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)?;
                file.write_all(&bytes)?;
                file.sync_all()?;
                book.entries.push(entry);
            }
            self.save(&book)
        })();
        if result.is_err() {
            for id in &ids {
                let _ = std::fs::remove_file(self.path(id)?);
            }
        }
        result?;
        Ok(ids)
    }
    pub fn receive_offer(&self, offer: Offer, own: &str, friend: &str) -> Result<bool> {
        offer.validate(friend, own)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        book.compact();
        if let Some(existing) = book.entries.iter().find(|e| e.offer.id == offer.id) {
            if existing.offer != offer || existing.direction != "incoming" {
                bail!("Conflicting screenshot ID");
            }
            return Ok(matches!(existing.status.as_str(), "received" | "deleted"));
        }
        let same_batch: Vec<_> = book
            .entries
            .iter()
            .filter(|e| {
                e.direction == "incoming"
                    && e.offer.sender == friend
                    && e.offer.batch == offer.batch
            })
            .collect();
        if same_batch.len() >= offer.count
            || same_batch.iter().any(|e| e.offer.count != offer.count)
            || same_batch.iter().map(|e| e.offer.bytes).sum::<u64>() + offer.bytes > MAX_BATCH + 160
            || book.bytes() + offer.bytes > MAX_STORAGE
            || book.entries.iter().filter(|entry| entry.stored()).count() >= 2000
        {
            bail!("Screenshot storage or batch limit exceeded");
        }
        let decision = same_batch.iter().find_map(|e| e.decision);
        book.entries.push(Entry {
            source_id: None,
            decision,
            offer,
            direction: "incoming".into(),
            status: match decision {
                Some(true) => "accepted",
                Some(false) => "rejected",
                None => "requested",
            }
            .into(),
            created_at: identity::now() * 1000,
            transferred: 0,
            error: None,
        });
        self.save(&book)?;
        Ok(false)
    }
    pub fn commit_received(&self, id: &str) -> Result<()> {
        let entry = self.entry(id)?.context("Unknown incoming screenshot")?;
        if entry.direction != "incoming"
            || entry.decision != Some(true)
            || !matches!(entry.status.as_str(), "accepted" | "receiving")
        {
            bail!("Screenshot request has not been accepted");
        }
        // Verify AEAD as well as the transfer hash before exposing a received image.
        let bytes = std::fs::read(self.partial(id)?)?;
        entry.offer.decrypt(bytes)?;
        std::fs::rename(self.partial(id)?, self.path(id)?)?;
        self.update(id, "received", entry.offer.bytes, None)
    }
    pub fn read_received(&self, id: &str, own: &str) -> Result<Vec<u8>> {
        let entry = self.entry(id)?.context("Screenshot no longer exists")?;
        if entry.direction != "incoming"
            || entry.status != "received"
            || entry.offer.recipient != own
        {
            bail!("Screenshot has not been received");
        }
        entry.offer.decrypt(std::fs::read(self.path(id)?)?)
    }
    pub fn reset_interrupted(&self) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        for entry in &mut book.entries {
            // v2 adds mandatory consent; the encrypted content format is unchanged.
            entry.offer.version = 2;
            if entry.direction == "outgoing"
                && matches!(entry.status.as_str(), "connecting" | "sending")
            {
                entry.status = "queued".into();
                entry.transferred = 0;
            }
            if entry.direction == "incoming" && entry.status != "received" {
                let _ = std::fs::remove_file(self.partial(&entry.offer.id)?);
                if matches!(entry.status.as_str(), "receiving" | "accepted") {
                    entry.status = if entry.decision == Some(true) {
                        "accepted"
                    } else {
                        "requested"
                    }
                    .into();
                }
            }
        }
        if !book.entries.is_empty() {
            self.save(&book)?;
        }
        Ok(())
    }
    pub fn decide_batch(&self, batch: &str, own: &str, accept: bool) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        let entries: Vec<_> = book
            .entries
            .iter_mut()
            .filter(|e| {
                e.direction == "incoming" && e.offer.recipient == own && e.offer.batch == batch
            })
            .collect();
        if entries.is_empty()
            || entries
                .iter()
                .any(|e| e.status != "requested" || e.decision.is_some())
        {
            bail!("Screenshot request is no longer pending");
        }
        for entry in entries {
            entry.decision = Some(accept);
            entry.status = if accept { "accepted" } else { "rejected" }.into();
        }
        self.save(&book)
    }
    pub fn record_answer(&self, id: &str, accepted: bool) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        let entry = book
            .entries
            .iter_mut()
            .find(|e| e.offer.id == id && e.direction == "outgoing")
            .context("Unknown outgoing screenshot")?;
        if matches!(
            entry.status.as_str(),
            "cancelled" | "rejected" | "delivered"
        ) {
            return Ok(());
        }
        entry.decision = Some(accepted);
        entry.status = if accepted { "connecting" } else { "rejected" }.into();
        entry.error = None;
        self.save(&book)?;
        if !accepted {
            let _ = std::fs::remove_file(self.path(id)?);
        }
        Ok(())
    }
    pub fn cancel(&self, id: &str, own: &str) -> Result<()> {
        let entry = self
            .entry(id)?
            .context("Screenshot transfer no longer exists")?;
        if entry.direction != "outgoing" || entry.offer.sender != own {
            bail!("Cannot cancel this screenshot transfer");
        }
        self.update(id, "cancelled", entry.transferred, None)?;
        if entry.status != "delivered" {
            let _ = std::fs::remove_file(self.path(id)?);
        }
        Ok(())
    }
    pub fn retry(&self, id: &str, own: &str) -> Result<()> {
        let entry = self
            .entry(id)?
            .context("Screenshot transfer no longer exists")?;
        if entry.direction != "outgoing" || entry.offer.sender != own || entry.status != "failed" {
            bail!("Cannot retry this screenshot transfer");
        }
        self.update(id, "queued", 0, None)
    }
    pub fn remove_received(&self, id: &str, own: &str) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Screenshot store unavailable"))?;
        let mut book = self.load()?;
        let entry = book
            .entries
            .iter()
            .find(|e| e.offer.id == id)
            .context("Screenshot no longer exists")?;
        if entry.direction != "incoming"
            || entry.offer.recipient != own
            || entry.status != "received"
        {
            bail!("Cannot remove this screenshot");
        }
        let _ = std::fs::remove_file(self.path(id)?);
        let _ = std::fs::remove_file(self.partial(id)?);
        if let Some(entry) = book.entries.iter_mut().find(|entry| entry.offer.id == id) {
            entry.status = "deleted".into();
        }
        self.save(&book)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> tempfile::TempDir {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/photos");
        std::fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root).unwrap()
    }
    fn photo() -> NewPhoto {
        NewPhoto {
            source_id: Some("local-fixture".into()),
            name: "2026-11-07.png".into(),
            profile_name: "Vanilla".into(),
            width: 32,
            height: 32,
            bytes: b"private screenshot fixture".to_vec(),
        }
    }
    #[test]
    fn encrypted_queue_survives_restart_and_receipt_is_idempotent() {
        let from = identity::Identity::generate().unwrap().id();
        let to = identity::Identity::generate().unwrap().id();
        let root = root();
        let lock = Arc::new(Mutex::new(()));
        let store = Store::new(root.path().join("a"), lock.clone());
        let ids = store.enqueue(&from, &to, vec![photo()]).unwrap();
        let offer = store.entry(&ids[0]).unwrap().unwrap().offer;
        store
            .verify_payload(&store.entry(&ids[0]).unwrap().unwrap())
            .unwrap();
        let cipher = std::fs::read(store.path(&ids[0]).unwrap()).unwrap();
        assert!(!cipher.windows(7).any(|w| w == b"private"));
        assert!(!std::fs::read(root.path().join("a/index.dpapi"))
            .unwrap()
            .windows(7)
            .any(|w| w == b"private"));
        let reopened = Store::new(root.path().join("a"), lock.clone());
        assert_eq!(reopened.entries().unwrap()[0].status, "queued");
        let receiver = Store::new(root.path().join("b"), lock);
        assert!(!receiver.receive_offer(offer.clone(), &to, &from).unwrap());
        assert!(receiver.commit_received(&ids[0]).is_err());
        receiver.decide_batch(&offer.batch, &to, true).unwrap();
        std::fs::write(receiver.partial(&ids[0]).unwrap(), &cipher).unwrap();
        receiver.commit_received(&ids[0]).unwrap();
        assert_eq!(
            receiver.read_received(&ids[0], &to).unwrap(),
            b"private screenshot fixture"
        );
        assert!(receiver.receive_offer(offer.clone(), &to, &from).unwrap());
        assert_eq!(receiver.entries().unwrap().len(), 1);
        receiver.remove_received(&ids[0], &to).unwrap();
        assert!(receiver.read_received(&ids[0], &to).is_err());
        assert!(receiver.receive_offer(offer, &to, &from).unwrap());
        store.update(&ids[0], "delivered", 0, None).unwrap();
        assert!(!store.path(&ids[0]).unwrap().exists());
        assert_eq!(store.load().unwrap().bytes(), 0);
    }
    #[test]
    fn batch_consent_survives_restart_and_covers_later_offers() {
        let from = identity::Identity::generate().unwrap().id();
        let to = identity::Identity::generate().unwrap().id();
        let other = identity::Identity::generate().unwrap().id();
        let root = root();
        let lock = Arc::new(Mutex::new(()));
        let sender = Store::new(root.path().join("sender"), lock.clone());
        let receiver = Store::new(root.path().join("receiver"), lock.clone());
        let ids = sender.enqueue(&from, &to, vec![photo(), photo()]).unwrap();
        let first = sender.entry(&ids[0]).unwrap().unwrap().offer;
        let second = sender.entry(&ids[1]).unwrap().unwrap().offer;
        receiver.receive_offer(first.clone(), &to, &from).unwrap();
        assert_eq!(
            receiver.entry(&ids[0]).unwrap().unwrap().status,
            "requested"
        );
        let cipher = std::fs::read(sender.path(&ids[0]).unwrap()).unwrap();
        std::fs::write(receiver.partial(&ids[0]).unwrap(), cipher).unwrap();
        assert!(receiver.commit_received(&ids[0]).is_err());
        assert!(!receiver.path(&ids[0]).unwrap().exists());
        assert!(receiver.decide_batch(&first.batch, &other, true).is_err());
        receiver.decide_batch(&first.batch, &to, false).unwrap();
        let receiver = Store::new(root.path().join("receiver"), lock);
        receiver.reset_interrupted().unwrap();
        receiver.receive_offer(second, &to, &from).unwrap();
        assert!(receiver
            .entries()
            .unwrap()
            .iter()
            .all(|e| e.decision == Some(false) && e.status == "rejected"));
        assert!(receiver.decide_batch(&first.batch, &to, true).is_err());
        assert!(receiver.commit_received(&ids[0]).is_err());
        sender.record_answer(&ids[0], false).unwrap();
        assert!(!sender.path(&ids[0]).unwrap().exists());
        sender.record_answer(&ids[0], true).unwrap();
        assert_eq!(sender.entry(&ids[0]).unwrap().unwrap().status, "rejected");
        assert!(sender.retry(&ids[0], &from).is_err());
        let accepted = sender.enqueue(&from, &to, vec![photo(), photo()]).unwrap();
        let first = sender.entry(&accepted[0]).unwrap().unwrap().offer;
        receiver.receive_offer(first.clone(), &to, &from).unwrap();
        receiver.decide_batch(&first.batch, &to, true).unwrap();
        receiver.reset_interrupted().unwrap();
        receiver
            .receive_offer(
                sender.entry(&accepted[1]).unwrap().unwrap().offer,
                &to,
                &from,
            )
            .unwrap();
        assert!(receiver
            .entries()
            .unwrap()
            .iter()
            .filter(|e| e.offer.batch == first.batch)
            .all(|e| e.decision == Some(true) && e.status == "accepted"));
        let mut changed = first.clone();
        changed.name = "replaced.png".into();
        assert!(receiver.receive_offer(changed, &to, &from).is_err());
        let mut legacy = first;
        legacy.version = 1;
        assert!(receiver.receive_offer(legacy, &to, &from).is_err());
        assert_eq!(
            sender
                .entry(&accepted[0])
                .unwrap()
                .unwrap()
                .summary()
                .source_id
                .as_deref(),
            Some("local-fixture")
        );
    }
    #[test]
    fn rejects_tampering_wrong_recipient_and_too_many_photos() {
        let a = identity::Identity::generate().unwrap().id();
        let b = identity::Identity::generate().unwrap().id();
        let root = root();
        let store = Store::new(root.path().into(), Arc::new(Mutex::new(())));
        assert!(store
            .enqueue(&a, &b, (0..11).map(|_| photo()).collect())
            .is_err());
        let id = store.enqueue(&a, &b, vec![photo()]).unwrap().remove(0);
        let mut offer = store.entry(&id).unwrap().unwrap().offer;
        assert!(offer.validate(&a, &a).is_err());
        let mut bytes = std::fs::read(store.path(&id).unwrap()).unwrap();
        bytes[0] ^= 1;
        std::fs::write(store.path(&id).unwrap(), &bytes).unwrap();
        assert!(store
            .verify_payload(&store.entry(&id).unwrap().unwrap())
            .is_err());
        assert!(offer.decrypt(bytes.clone()).is_err());
        offer.sha256 = hash(&bytes);
        assert!(offer.decrypt(bytes).is_err());
        assert!(store.path("../outside").is_err());
        store.update(&id, "sending", 4, None).unwrap();
        store.reset_interrupted().unwrap();
        assert_eq!(store.entry(&id).unwrap().unwrap().status, "queued");
        store.cancel(&id, &a).unwrap();
        assert!(!store.path(&id).unwrap().exists());
    }
}
