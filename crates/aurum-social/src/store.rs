//! Local, transactional contacts and privacy. This module never opens a socket.
use crate::identity::{decode_id, encode_id, now};
use anyhow::{bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
fn default_notifications() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Privacy {
    #[serde(default)]
    pub invisible: bool,
    #[serde(default = "default_notifications")]
    pub notifications: bool,
    pub incoming_requests: bool,
    pub share_activity: bool,
    pub public_relays: bool,
}
impl Default for Privacy {
    fn default() -> Self {
        Self {
            invisible: false,
            notifications: true,
            incoming_requests: true,
            share_activity: false,
            public_relays: true,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub state: String,
    pub updated: u64,
    pub avatar: Option<String>,
}
pub struct Store {
    db: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('outgoing','incoming','friend','blocked')),updated INTEGER NOT NULL); PRAGMA user_version=1;")?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS contact_profiles(id TEXT PRIMARY KEY,avatar TEXT);",
        )?;
        Ok(Self { db })
    }
    #[cfg(test)]
    fn memory() -> Self {
        Self::open(Path::new(":memory:")).unwrap()
    }
    pub fn value(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
            .optional()?)
    }
    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        self.db.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;
        Ok(())
    }
    pub fn privacy(&self) -> Result<Privacy> {
        Ok(self
            .value("privacy")?
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .unwrap_or_default())
    }
    pub fn set_privacy(&self, privacy: &Privacy) -> Result<()> {
        self.set("privacy", &serde_json::to_string(privacy)?)
    }
    pub fn people(&self) -> Result<Vec<Person>> {
        let mut stmt = self.db.prepare(
            "SELECT c.id,c.name,c.state,c.updated,p.avatar FROM contacts c LEFT JOIN contact_profiles p ON p.id=c.id ORDER BY c.updated DESC,c.id LIMIT 2304",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Person {
                id: r.get(0)?,
                name: r.get(1)?,
                state: r.get(2)?,
                updated: r.get(3)?,
                avatar: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
    pub fn state(&self, id: &str) -> Result<Option<String>> {
        let id = encode_id(&decode_id(id)?);
        Ok(self
            .db
            .query_row("SELECT state FROM contacts WHERE id=?1", [id], |r| r.get(0))
            .optional()?)
    }
    pub fn blocked(&self, id: &str) -> bool {
        self.state(id).ok().flatten().as_deref() == Some("blocked")
    }
    pub fn set_profile(&self, id: &str, name: &str, avatar: &Option<String>) -> Result<()> {
        validate_name(name)?;
        crate::profile::validate_avatar(avatar)?;
        let id = encode_id(&decode_id(id)?);
        if !matches!(
            self.state(&id)?.as_deref(),
            Some("friend" | "incoming" | "outgoing")
        ) {
            return Ok(());
        }
        self.db
            .execute("UPDATE contacts SET name=?2 WHERE id=?1", params![id, name])?;
        self.db.execute("INSERT INTO contact_profiles(id,avatar) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET avatar=excluded.avatar",params![id,avatar])?;
        Ok(())
    }
    fn count(&self, state: &str) -> Result<u32> {
        Ok(self.db.query_row(
            "SELECT count(*) FROM contacts WHERE state=?1",
            [state],
            |r| r.get(0),
        )?)
    }
    fn put(&self, id: &str, name: &str, state: &str) -> Result<()> {
        let id = encode_id(&decode_id(id)?);
        validate_name(name)?;
        self.db.execute("INSERT INTO contacts(id,name,state,updated) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,state=excluded.state,updated=excluded.updated",params![id,name,state,now()])?;
        Ok(())
    }
    pub fn request(&self, id: &str, name: &str) -> Result<()> {
        if self.state(id)?.is_some() {
            bail!("This identity already has a relationship; unblock or remove it first");
        }
        if self.count("outgoing")? >= 100 {
            bail!("Too many pending requests");
        }
        self.put(id, name, "outgoing")
    }
    pub fn incoming(&self, id: &str, name: &str) -> Result<bool> {
        if !self.privacy()?.incoming_requests || self.state(id)?.is_some() {
            return Ok(false);
        }
        if self.count("incoming")? >= 100 {
            bail!("Incoming request queue is full");
        }
        self.put(id, name, "incoming")?;
        Ok(true)
    }
    pub fn accept(&self, id: &str) -> Result<()> {
        let id = encode_id(&decode_id(id)?);
        if self.count("friend")? >= 128 {
            bail!("Friend limit reached");
        }
        let changed = self.db.execute(
            "UPDATE contacts SET state='friend',updated=?2 WHERE id=?1 AND state='incoming'",
            params![id, now()],
        )?;
        if changed != 1 {
            bail!("No incoming request from this identity");
        }
        Ok(())
    }
    pub fn accepted_by_peer(&self, id: &str, name: &str) -> Result<bool> {
        if self.state(id)?.as_deref() != Some("outgoing") {
            return Ok(false);
        }
        if self.count("friend")? >= 128 {
            bail!("Friend limit reached");
        }
        self.put(id, name, "friend")?;
        Ok(true)
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        let id = encode_id(&decode_id(id)?);
        self.db.execute(
            "DELETE FROM contacts WHERE id=?1 AND state!='blocked'",
            [&id],
        )?;
        if self.state(&id)?.is_none() {
            self.db
                .execute("DELETE FROM contact_profiles WHERE id=?1", [&id])?;
        }
        Ok(())
    }
    pub fn block(&self, id: &str) -> Result<()> {
        if self.count("blocked")? >= 2048 && !self.blocked(id) {
            bail!("Block list limit reached");
        }
        let name = self
            .db
            .query_row(
                "SELECT name FROM contacts WHERE id=?1",
                [encode_id(&decode_id(id)?)],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_default();
        self.put(id, &name, "blocked")
    }
    pub fn unblock(&self, id: &str) -> Result<()> {
        let id = encode_id(&decode_id(id)?);
        self.db.execute(
            "DELETE FROM contacts WHERE id=?1 AND state='blocked'",
            [&id],
        )?;
        if self.state(&id)?.is_none() {
            self.db
                .execute("DELETE FROM contact_profiles WHERE id=?1", [&id])?;
        }
        Ok(())
    }
}
pub fn validate_name(name: &str) -> Result<()> {
    if name.chars().count() > 48
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
    {
        bail!("Nickname contains unsupported characters or exceeds 48 characters");
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::Identity;
    #[test]
    fn case_cannot_bypass_a_block() {
        let store = Store::memory();
        let id = Identity::generate().unwrap().id();
        store.block(&id.to_uppercase()).unwrap();
        assert!(store.blocked(&id));
        assert!(!store.incoming(&id, "attacker").unwrap());
    }
    #[test]
    fn privacy_and_contacts_are_local_and_blocked_cannot_be_reaccepted() {
        let s = Store::memory();
        assert!(s.value("enabled").unwrap().is_none());
        let id = Identity::generate().unwrap().id();
        assert!(!s.accepted_by_peer(&id, "remote").unwrap());
        assert!(s.incoming(&id, "remote").unwrap());
        s.accept(&id).unwrap();
        s.block(&id).unwrap();
        assert!(!s.incoming(&id, "remote").unwrap());
        assert!(!s.accepted_by_peer(&id, "remote").unwrap());
        assert!(s.accept(&id).is_err());
        s.remove(&id).unwrap();
        assert!(s.blocked(&id));
        s.unblock(&id).unwrap();
        assert_eq!(s.state(&id).unwrap(), None);
    }
    #[test]
    fn unsolicited_accept_and_requests_disabled() {
        let s = Store::memory();
        let id = Identity::generate().unwrap().id();
        assert!(s.accept(&id).is_err());
        s.set_privacy(&Privacy {
            incoming_requests: false,
            ..Default::default()
        })
        .unwrap();
        assert!(!s.incoming(&id, "remote").unwrap());
        s.request(&id, "remote").unwrap();
        assert!(s.accepted_by_peer(&id, "remote").unwrap());
    }
}
