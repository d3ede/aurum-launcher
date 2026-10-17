use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::{
    aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN},
    rand::{SecureRandom, SystemRandom},
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

const SERVICE: &str = "app.auren.launcher";
const PREFIX: &str = "aurum-vault-v1:";
static LOCK: Mutex<()> = Mutex::new(());

trait Vault {
    fn get(&self, id: &str) -> Result<Option<String>>;
    fn set(&self, id: &str, value: &str) -> Result<()>;
    fn delete(&self, id: &str) -> Result<()>;
}

struct OsVault;

impl Vault for OsVault {
    fn get(&self, id: &str) -> Result<Option<String>> {
        match keyring::Entry::new(SERVICE, id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error).context("Не удалось открыть хранилище учётных данных ОС"),
        }
    }

    fn set(&self, id: &str, value: &str) -> Result<()> {
        keyring::Entry::new(SERVICE, id)?
            .set_password(value)
            .context("Не удалось сохранить ключ в хранилище ОС")
    }

    fn delete(&self, id: &str) -> Result<()> {
        keyring::Entry::new(SERVICE, id)?
            .delete_credential()
            .map_err(Into::into)
    }
}

struct Reference {
    revision: Uuid,
    key: [u8; 32],
}

impl Reference {
    fn parse(value: &str) -> Result<Option<Self>> {
        let Some(encoded) = value.strip_prefix(PREFIX) else {
            return Ok(None);
        };
        let (revision, key) = encoded
            .split_once(':')
            .context("Повреждена ссылка на зашифрованные данные входа")?;
        let revision = Uuid::parse_str(revision)
            .context("Повреждён идентификатор зашифрованных данных входа")?;
        let mut bytes = [0; 32];
        let length = STANDARD
            .decode_slice(key, &mut bytes)
            .map_err(|_| anyhow::anyhow!("Повреждён ключ данных входа"))?;
        if length != bytes.len() {
            bail!("Повреждён ключ данных входа")
        }
        Ok(Some(Self {
            revision,
            key: bytes,
        }))
    }

    fn encode(&self) -> String {
        format!("{PREFIX}{}:{}", self.revision, STANDARD.encode(self.key))
    }

    fn path(&self, root: &Path, id: &str) -> PathBuf {
        let account = Sha256::digest(id.as_bytes());
        root.join(format!("{account:x}-{}.bin", self.revision))
    }

    fn cipher(&self) -> Result<LessSafeKey> {
        UnboundKey::new(&AES_256_GCM, &self.key)
            .map(LessSafeKey::new)
            .map_err(|_| anyhow::anyhow!("Не удалось подготовить шифрование данных входа"))
    }
}

struct SecretStore<V> {
    root: PathBuf,
    vault: V,
}

impl<V: Vault> SecretStore<V> {
    fn get(&self, id: &str) -> Result<String> {
        let value = self
            .vault
            .get(id)?
            .context("Данные не найдены в хранилище учётных данных ОС")?;
        let Some(reference) = Reference::parse(&value)? else {
            self.save(id, &value, None)?;
            return Ok(value);
        };
        let mut data = fs::read(reference.path(&self.root, id))
            .context("Не удалось прочитать зашифрованные данные; войдите в аккаунт снова")?;
        if data.len() < NONCE_LEN + AES_256_GCM.tag_len() {
            bail!("Повреждены зашифрованные данные; войдите в аккаунт снова")
        }
        let (nonce, ciphertext) = data.split_at_mut(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(nonce)
            .map_err(|_| anyhow::anyhow!("Повреждены параметры шифрования данных входа"))?;
        let plaintext = reference
            .cipher()?
            .open_in_place(nonce, Aad::from(id.as_bytes()), ciphertext)
            .map_err(|_| {
                anyhow::anyhow!("Не удалось расшифровать данные; войдите в аккаунт снова")
            })?;
        String::from_utf8(plaintext.to_vec()).context("Повреждён формат данных входа")
    }

    fn set(&self, id: &str, value: &str) -> Result<()> {
        let previous = self.vault.get(id)?;
        let previous = previous
            .as_deref()
            .and_then(|value| Reference::parse(value).ok().flatten());
        self.save(id, value, previous.as_ref())
    }

    fn save(&self, id: &str, value: &str, previous: Option<&Reference>) -> Result<()> {
        let random = SystemRandom::new();
        let mut reference = Reference {
            revision: Uuid::new_v4(),
            key: [0; 32],
        };
        let mut nonce = [0; NONCE_LEN];
        random
            .fill(&mut reference.key)
            .and_then(|()| random.fill(&mut nonce))
            .map_err(|_| anyhow::anyhow!("Не удалось создать ключ шифрования данных входа"))?;
        let mut ciphertext = value.as_bytes().to_vec();
        reference
            .cipher()?
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(id.as_bytes()),
                &mut ciphertext,
            )
            .map_err(|_| anyhow::anyhow!("Не удалось зашифровать данные входа"))?;
        fs::create_dir_all(&self.root).context("Не удалось создать папку данных входа")?;
        let path = reference.path(&self.root, id);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .context("Не удалось создать зашифрованный файл данных входа")?;
        let written = file
            .write_all(&nonce)
            .and_then(|()| file.write_all(&ciphertext))
            .and_then(|()| file.sync_all());
        drop(file);
        if let Err(error) = written {
            let _ = fs::remove_file(&path);
            return Err(error).context("Не удалось сохранить зашифрованные данные входа");
        }
        if let Err(error) = self.vault.set(id, &reference.encode()) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        if let Some(previous) = previous {
            let _ = fs::remove_file(previous.path(&self.root, id));
        }
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<()> {
        let previous = self.vault.get(id)?;
        let reference = previous
            .as_deref()
            .and_then(|value| Reference::parse(value).ok().flatten());
        self.vault.delete(id)?;
        if let Some(reference) = reference {
            match fs::remove_file(reference.path(&self.root, id)) {
                Ok(()) => (),
                Err(error) if error.kind() == ErrorKind::NotFound => (),
                Err(error) => return Err(error).context("Не удалось удалить зашифрованные данные"),
            }
        }
        Ok(())
    }
}

fn store() -> Result<SecretStore<OsVault>> {
    Ok(SecretStore {
        root: dirs::data_local_dir()
            .context("Не найдена папка данных пользователя")?
            .join(SERVICE)
            .join("secrets"),
        vault: OsVault,
    })
}

pub(crate) fn get(id: &str) -> Result<String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("Хранилище занято"))?;
    store()?.get(id)
}

pub(crate) fn set(id: &str, value: &str) -> Result<()> {
    let _guard = LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("Хранилище занято"))?;
    store()?.set(id, value)
}

pub(crate) fn delete(id: &str) -> Result<()> {
    let _guard = LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("Хранилище занято"))?;
    store()?.delete(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryVault {
        values: RefCell<HashMap<String, String>>,
        fail_write: Cell<bool>,
        fail_read: Cell<bool>,
        fail_delete: Cell<bool>,
    }

    impl Vault for MemoryVault {
        fn get(&self, id: &str) -> Result<Option<String>> {
            if self.fail_read.get() {
                bail!("vault unavailable")
            }
            Ok(self.values.borrow().get(id).cloned())
        }

        fn set(&self, id: &str, value: &str) -> Result<()> {
            if self.fail_write.get() {
                bail!("vault unavailable")
            }
            assert!(value.encode_utf16().count() * 2 <= 2560);
            self.values.borrow_mut().insert(id.into(), value.into());
            Ok(())
        }

        fn delete(&self, id: &str) -> Result<()> {
            if self.fail_delete.get() {
                bail!("vault unavailable")
            }
            self.values.borrow_mut().remove(id);
            Ok(())
        }
    }

    fn temporary_directory() -> tempfile::TempDir {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data");
        fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root).unwrap()
    }

    fn fixture(root: &Path) -> SecretStore<MemoryVault> {
        SecretStore {
            root: root.join("secrets"),
            vault: MemoryVault::default(),
        }
    }

    fn reference<V: Vault>(store: &SecretStore<V>, id: &str) -> Reference {
        Reference::parse(&store.vault.get(id).unwrap().unwrap())
            .unwrap()
            .unwrap()
    }

    #[test]
    fn large_credentials_use_a_short_vault_entry_and_encrypted_file() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        let value = serde_json::json!({
            "refresh_token": "refresh-token".repeat(1000),
            "access_token": "access-token".repeat(1000),
            "client_id": "application", "expires_at": 123, "xuid": "player"
        })
        .to_string();
        store.set("account", &value).unwrap();
        let entry = store.vault.get("account").unwrap().unwrap();
        assert_eq!(entry.len(), 96);
        assert!(!entry.contains("refresh-token"));
        let saved = reference(&store, "account");
        let encrypted = fs::read(saved.path(&store.root, "account")).unwrap();
        assert!(!encrypted.windows(12).any(|part| part == b"access-token"));
        assert!(!encrypted.windows(13).any(|part| part == b"refresh-token"));
        assert_eq!(store.get("account").unwrap(), value);
        let restarted = SecretStore {
            root: store.root.clone(),
            vault: store.vault,
        };
        assert_eq!(restarted.get("account").unwrap(), value);
        restarted.delete("account").unwrap();
        assert!(restarted.get("account").is_err());
        assert!(!saved.path(&restarted.root, "account").exists());
    }

    #[test]
    fn old_vault_records_migrate_on_read() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.vault.set("account", "legacy-credentials").unwrap();
        assert_eq!(store.get("account").unwrap(), "legacy-credentials");
        assert!(store
            .vault
            .get("account")
            .unwrap()
            .unwrap()
            .starts_with(PREFIX));
        assert_eq!(store.get("account").unwrap(), "legacy-credentials");
    }

    #[test]
    fn failed_vault_write_preserves_previous_data_and_removes_candidate() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.set("account", "previous").unwrap();
        let old = store.vault.get("account").unwrap();
        store.vault.fail_write.set(true);
        assert!(store.set("account", "replacement").is_err());
        assert_eq!(store.vault.get("account").unwrap(), old);
        assert_eq!(store.get("account").unwrap(), "previous");
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 1);
    }

    #[test]
    fn failed_migration_preserves_legacy_record() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.vault.set("account", "legacy").unwrap();
        store.vault.fail_write.set(true);
        assert!(store.get("account").is_err());
        assert_eq!(store.vault.get("account").unwrap().unwrap(), "legacy");
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 0);
    }

    #[test]
    fn rotation_replaces_the_key_and_removes_old_ciphertext() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.set("account", "previous").unwrap();
        let old = reference(&store, "account");
        store.set("account", "refreshed").unwrap();
        let current = reference(&store, "account");
        assert_ne!(old.key, current.key);
        assert_ne!(old.revision, current.revision);
        assert!(!old.path(&store.root, "account").exists());
        assert_eq!(store.get("account").unwrap(), "refreshed");
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 1);
    }

    #[test]
    fn tampering_wrong_keys_and_account_swaps_are_rejected() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.set("account", "private-data").unwrap();
        let original = reference(&store, "account");
        let path = original.path(&store.root, "account");
        let encrypted = fs::read(&path).unwrap();
        let mut damaged = encrypted.clone();
        damaged[NONCE_LEN] ^= 1;
        fs::write(&path, damaged).unwrap();
        assert!(store.get("account").is_err());
        fs::write(&path, &encrypted).unwrap();
        let mut wrong = reference(&store, "account");
        wrong.key[0] ^= 1;
        store.vault.set("account", &wrong.encode()).unwrap();
        assert!(store.get("account").is_err());
        store.vault.set("other", &original.encode()).unwrap();
        fs::write(original.path(&store.root, "other"), &encrypted).unwrap();
        assert!(store.get("other").is_err());
        store.vault.set("account", &original.encode()).unwrap();
        assert_eq!(store.get("account").unwrap(), "private-data");
    }

    #[test]
    fn missing_and_truncated_files_do_not_overwrite_the_key() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.set("account", "private-data").unwrap();
        let entry = store.vault.get("account").unwrap();
        let saved = reference(&store, "account");
        let path = saved.path(&store.root, "account");
        fs::write(&path, [0; NONCE_LEN]).unwrap();
        assert!(store.get("account").is_err());
        fs::remove_file(&path).unwrap();
        assert!(store.get("account").is_err());
        assert_eq!(store.vault.get("account").unwrap(), entry);
        store.delete("account").unwrap();
        assert!(store.vault.get("account").unwrap().is_none());
    }

    #[test]
    fn file_and_vault_failures_preserve_existing_credentials() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store.vault.set("account", "legacy").unwrap();
        fs::write(&store.root, "blocked").unwrap();
        assert!(store.set("account", "replacement").is_err());
        assert_eq!(store.vault.get("account").unwrap().unwrap(), "legacy");
        fs::remove_file(&store.root).unwrap();
        store.set("account", "previous").unwrap();
        let entry = store.vault.get("account").unwrap();
        store.vault.fail_read.set(true);
        assert!(store.set("account", "replacement").is_err());
        store.vault.fail_read.set(false);
        store.vault.fail_delete.set(true);
        assert!(store.delete("account").is_err());
        assert_eq!(store.vault.get("account").unwrap(), entry);
        assert_eq!(store.get("account").unwrap(), "previous");
    }

    #[test]
    fn references_and_file_names_cannot_escape_the_store() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        let id = "../../somewhere";
        store.set(id, "value").unwrap();
        let saved = reference(&store, id);
        assert_eq!(
            saved.path(&store.root, id).parent(),
            Some(store.root.as_path())
        );
        assert_eq!(store.get(id).unwrap(), "value");
        for invalid in [
            format!("{PREFIX}../../escape:{}", STANDARD.encode([0; 32])),
            format!("{PREFIX}{}:invalid", Uuid::new_v4()),
            format!("{PREFIX}{}:{}", Uuid::new_v4(), STANDARD.encode([0; 31])),
            format!("{PREFIX}{}:{}", Uuid::new_v4(), STANDARD.encode([0; 33])),
        ] {
            assert!(Reference::parse(&invalid).is_err());
        }
    }

    #[test]
    fn signing_in_again_and_deleting_can_recover_from_invalid_references() {
        let directory = temporary_directory();
        let store = fixture(directory.path());
        store
            .vault
            .set("account", &format!("{PREFIX}broken"))
            .unwrap();
        assert!(store.get("account").is_err());
        store.set("account", "new-session").unwrap();
        assert_eq!(store.get("account").unwrap(), "new-session");
        store.delete("account").unwrap();
        store
            .vault
            .set("account", &format!("{PREFIX}broken"))
            .unwrap();
        store.delete("account").unwrap();
        assert!(store.vault.get("account").unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "creates and removes a temporary Windows Credential Manager entry"]
    fn windows_vault_large_secret_round_trip() {
        let directory = temporary_directory();
        let store = SecretStore {
            root: directory.path().join("secrets"),
            vault: OsVault,
        };
        let id = format!("test-encrypted-vault-{}", Uuid::new_v4());
        let result = (|| -> Result<()> {
            store.vault.set(&id, "legacy-session")?;
            assert_eq!(store.get(&id)?, "legacy-session");
            let value = "synthetic-session-token-".repeat(1024);
            store.set(&id, &value)?;
            assert_eq!(store.vault.get(&id)?.unwrap().len(), 96);
            assert_eq!(store.get(&id)?, value);
            store.set(&id, "refreshed-session")?;
            assert_eq!(store.get(&id)?, "refreshed-session");
            Ok(())
        })();
        let cleanup = store.delete(&id);
        result.unwrap();
        cleanup.unwrap();
        assert!(store.vault.get(&id).unwrap().is_none());
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 0);
    }
}
