use super::*;
use crate::photos::{self as media, Entry, NewPhoto, Summary};
use std::{
    fs::File,
    io::{Read, Write},
};

pub(super) struct State {
    store: media::Store,
    active: HashMap<u64, Active>,
    offered: HashMap<String, Instant>,
    connecting: HashMap<String, Instant>,
    retry: HashMap<String, Instant>,
    answers: HashMap<String, bool>,
    last_tick: Instant,
}
struct Active {
    entry: Entry,
    file: Option<File>,
    incoming: bool,
    offset: u64,
    confirmed: u64,
    checkpoint: u64,
    pending: usize,
    finishing: bool,
    last: Instant,
}
impl State {
    pub fn new(store: media::Store) -> Result<Self> {
        store.reset_interrupted()?;
        Ok(Self {
            store,
            active: HashMap::new(),
            offered: HashMap::new(),
            connecting: HashMap::new(),
            retry: HashMap::new(),
            answers: HashMap::new(),
            last_tick: Instant::now() - Duration::from_secs(1),
        })
    }
}
impl Service {
    fn photo_store(&self) -> media::Store {
        media::Store::new(self.root.join("photos"), self.photo_lock.clone())
    }
    pub fn queue_screenshots(&self, friend: &str, images: Vec<NewPhoto>) -> Result<Vec<String>> {
        let store = self.store()?;
        if store.state(friend)?.as_deref() != Some("friend") {
            bail!("Screenshots can only be sent to an accepted friend");
        }
        let own = store
            .value("publicId")?
            .context("Enable Social before sharing screenshots")?;
        if !self.root.join("identity.dpapi").is_file() {
            bail!("Restore your Social identity before sharing screenshots");
        }
        let ids = self.photo_store().enqueue(&own, friend, images)?;
        signal(&self.notify);
        Ok(ids)
    }
    pub fn screenshot_transfers(&self) -> Result<Vec<Summary>> {
        let Some(own) = self.store()?.value("publicId")? else {
            return Ok(Vec::new());
        };
        let mut entries: Vec<_> = self
            .photo_store()
            .entries()?
            .into_iter()
            .filter(|e| {
                e.status != "deleted"
                    && ((e.direction == "outgoing" && e.offer.sender == own)
                        || (e.direction == "incoming" && e.offer.recipient == own))
            })
            .map(|e| e.summary())
            .collect();
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(entries)
    }
    pub fn received_screenshot(&self, id: &str) -> Result<Vec<u8>> {
        let own = self
            .store()?
            .value("publicId")?
            .context("No Social identity")?;
        self.photo_store().read_received(id, &own)
    }
    pub fn decide_screenshots(&self, batch: &str, accept: bool) -> Result<()> {
        let own = self
            .store()?
            .value("publicId")?
            .context("No Social identity")?;
        let entries = self.photo_store().entries()?;
        let entry = entries
            .iter()
            .find(|e| {
                e.direction == "incoming" && e.offer.batch == batch && e.offer.recipient == own
            })
            .context("Unknown screenshot request")?;
        if accept && self.store()?.state(&entry.offer.sender)?.as_deref() != Some("friend") {
            bail!("This identity is no longer a friend");
        }
        self.photo_store().decide_batch(batch, &own, accept)?;
        signal(&self.notify);
        Ok(())
    }
    pub fn cancel_screenshot(&self, id: &str) -> Result<()> {
        let own = self
            .store()?
            .value("publicId")?
            .context("No Social identity")?;
        self.photo_store().cancel(id, &own)?;
        signal(&self.notify);
        Ok(())
    }
    pub fn retry_screenshot(&self, id: &str) -> Result<()> {
        let own = self
            .store()?
            .value("publicId")?
            .context("No Social identity")?;
        let entry = self
            .photo_store()
            .entry(id)?
            .context("Unknown screenshot transfer")?;
        if self.store()?.state(&entry.offer.recipient)?.as_deref() != Some("friend") {
            bail!("This identity is no longer a friend");
        }
        self.photo_store().retry(id, &own)?;
        signal(&self.notify);
        Ok(())
    }
    pub fn remove_received_screenshot(&self, id: &str) -> Result<()> {
        let own = self
            .store()?
            .value("publicId")?
            .context("No Social identity")?;
        self.photo_store().remove_received(id, &own)?;
        signal(&self.notify);
        Ok(())
    }
}
impl Actor {
    pub(super) fn photo_tick(&mut self) -> Result<()> {
        if self.photos.last_tick.elapsed() < Duration::from_millis(500) {
            return Ok(());
        }
        self.photos.last_tick = Instant::now();
        let mut entries = self.photos.store.entries()?;
        entries.sort_by_key(|entry| entry.created_at);
        let known: std::collections::HashSet<_> =
            entries.iter().map(|e| e.offer.id.as_str()).collect();
        self.photos
            .answers
            .retain(|id, _| known.contains(id.as_str()));
        let mut answered = 0;
        for entry in entries.iter().filter(|e| {
            e.direction == "incoming" && matches!(e.status.as_str(), "accepted" | "rejected")
        }) {
            let Some(accepted) = entry.decision else {
                continue;
            };
            if self.photos.answers.get(&entry.offer.id) == Some(&accepted)
                || entry.offer.recipient != self.identity.id()
                || self.store.state(&entry.offer.sender)?.as_deref() != Some("friend")
            {
                continue;
            }
            let peer = identity::decode_id(&entry.offer.sender)?;
            if !self
                .sessions
                .get(&peer)
                .is_some_and(|s| s.ready && s.expires > Instant::now())
            {
                continue;
            }
            self.queue(
                peer,
                if accepted {
                    PeerAction::PhotoReady {
                        id: entry.offer.id.clone(),
                        approved: true,
                    }
                } else {
                    PeerAction::PhotoDeclined {
                        id: entry.offer.id.clone(),
                    }
                },
            )?;
            self.photos.answers.insert(entry.offer.id.clone(), accepted);
            answered += 1;
            if answered >= 10 {
                break;
            }
        }
        let close: Vec<_> = self
            .photos
            .active
            .iter()
            .filter_map(|(stream, active)| {
                let peer = if active.incoming {
                    &active.entry.offer.sender
                } else {
                    &active.entry.offer.recipient
                };
                let cancelled = entries
                    .iter()
                    .find(|e| e.offer.id == active.entry.offer.id)
                    .is_none_or(|e| e.status == "cancelled");
                (cancelled
                    || self.store.state(peer).ok().flatten().as_deref() != Some("friend")
                    || active.last.elapsed() > Duration::from_secs(100))
                .then_some(*stream)
            })
            .collect();
        for stream in close {
            if let Some(active) = self.photos.active.remove(&stream) {
                let _ = self.worker.send(&Command::PhotoClose { stream });
                if !active.incoming {
                    self.photo_failed(&active.entry.offer.id, "Screenshot transfer interrupted")?;
                }
            }
        }
        self.photos
            .offered
            .retain(|_, at| at.elapsed() < Duration::from_secs(15));
        let expired: Vec<_> = self
            .photos
            .connecting
            .iter()
            .filter(|(_, at)| at.elapsed() > Duration::from_secs(25))
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            self.photo_failed(&id, "Waiting for your friend to reconnect")?;
        }
        for entry in entries.into_iter().filter(|e| {
            e.direction == "outgoing"
                && matches!(e.status.as_str(), "queued" | "connecting" | "awaiting")
        }) {
            let id = &entry.offer.id;
            if self.store.state(&entry.offer.recipient)?.as_deref() != Some("friend")
                || entry.offer.sender != self.identity.id()
            {
                self.photos.store.cancel(id, &entry.offer.sender)?;
                continue;
            }
            if self.photos.offered.contains_key(id)
                || self.photos.connecting.contains_key(id)
                || self.photos.active.values().any(|a| a.entry.offer.id == *id)
                || self
                    .photos
                    .retry
                    .get(id)
                    .is_some_and(|at| *at > Instant::now())
            {
                continue;
            }
            if self.photos.active.values().filter(|a| !a.incoming).count()
                + self.photos.connecting.len()
                >= 2
            {
                break;
            }
            let peer = identity::decode_id(&entry.offer.recipient)?;
            if !self
                .sessions
                .get(&peer)
                .is_some_and(|s| s.ready && s.expires > Instant::now())
            {
                let _ = self.queue(peer, PeerAction::Ping);
                self.photos
                    .retry
                    .insert(id.clone(), Instant::now() + Duration::from_secs(10));
                continue;
            }
            self.queue(
                peer,
                PeerAction::PhotoOffer {
                    offer: entry.offer.clone(),
                },
            )?;
            self.photos.offered.insert(id.clone(), Instant::now());
            self.photos.store.update(id, "awaiting", 0, None)?;
        }
        Ok(())
    }
    pub(super) fn photo_action(
        &mut self,
        friend: &str,
        peer: [u8; 32],
        action: PeerAction,
    ) -> Result<()> {
        match action {
            PeerAction::PhotoOffer { offer } => {
                let id = offer.id.clone();
                match self
                    .photos
                    .store
                    .receive_offer(offer, &self.identity.id(), friend)
                {
                    Ok(true) => {
                        let approved = self
                            .photos
                            .store
                            .entry(&id)?
                            .is_some_and(|e| e.decision == Some(true));
                        self.queue(peer, PeerAction::PhotoReceipt { id, approved })?;
                    }
                    Ok(false) => {
                        if let Some(entry) = self.photos.store.entry(&id)? {
                            match entry.decision {
                                Some(true) => {
                                    self.queue(peer, PeerAction::PhotoReady { id, approved: true })?
                                }
                                Some(false) => {
                                    self.queue(peer, PeerAction::PhotoDeclined { id })?
                                }
                                None => (),
                            }
                        }
                    }
                    Err(error) => {
                        if media::valid_id(&id) {
                            self.queue(
                                peer,
                                PeerAction::PhotoRejected {
                                    id,
                                    reason: error.to_string().chars().take(120).collect(),
                                },
                            )?;
                        }
                    }
                }
            }
            PeerAction::PhotoReady { id, approved } => {
                if !approved {
                    return Ok(());
                }
                let Some(entry) = self.photos.store.entry(&id)? else {
                    return Ok(());
                };
                if entry.direction != "outgoing"
                    || entry.offer.recipient != friend
                    || !matches!(entry.status.as_str(), "queued" | "connecting" | "awaiting")
                    || self.photos.connecting.contains_key(&id)
                    || self.photos.active.values().any(|a| a.entry.offer.id == id)
                {
                    return Ok(());
                }
                self.photos.store.record_answer(&id, true)?;
                if self.photos.active.values().filter(|a| !a.incoming).count()
                    + self.photos.connecting.len()
                    >= 2
                {
                    return Ok(());
                }
                let address = self
                    .sessions
                    .get(&peer)
                    .context("No screenshot peer session")?
                    .address
                    .clone();
                if let Err(error) = self.photos.store.verify_payload(&entry) {
                    self.photos
                        .store
                        .update(&id, "failed", 0, Some(error.to_string()))?;
                    self.photos.offered.remove(&id);
                    signal(&self.notify);
                    return Ok(());
                }
                self.worker.send(&Command::PhotoConnect {
                    address,
                    id: id.clone(),
                })?;
                self.photos.connecting.insert(id, Instant::now());
            }
            PeerAction::PhotoReceipt { id, approved } => {
                if self
                    .photos
                    .store
                    .entry(&id)?
                    .is_some_and(|e| e.direction == "outgoing" && e.offer.recipient == friend)
                {
                    if approved {
                        self.photos.store.record_answer(&id, true)?;
                    }
                    self.photos.store.update(&id, "delivered", 0, None)?;
                    self.photos.connecting.remove(&id);
                    self.photos.offered.remove(&id);
                }
            }
            PeerAction::PhotoDeclined { id } => {
                if self.photos.store.entry(&id)?.is_some_and(|e| {
                    e.direction == "outgoing"
                        && e.offer.recipient == friend
                        && e.decision != Some(true)
                }) {
                    self.photos.store.record_answer(&id, false)?;
                    self.photos.connecting.remove(&id);
                    self.photos.offered.remove(&id);
                }
            }
            PeerAction::PhotoRejected { id, reason } => {
                if self
                    .photos
                    .store
                    .entry(&id)?
                    .is_some_and(|e| e.direction == "outgoing" && e.offer.recipient == friend)
                {
                    self.photos.store.update(&id, "failed", 0, Some(reason))?;
                    self.photos.connecting.remove(&id);
                    self.photos.offered.remove(&id);
                }
            }
            _ => bail!("Invalid screenshot action"),
        }
        signal(&self.notify);
        Ok(())
    }
    fn photo_failed(&mut self, id: &str, message: &str) -> Result<()> {
        self.photos.connecting.remove(id);
        self.photos.offered.remove(id);
        self.photos
            .retry
            .insert(id.into(), Instant::now() + Duration::from_secs(15));
        let streams: Vec<_> = self
            .photos
            .active
            .iter()
            .filter(|(_, a)| a.entry.offer.id == id)
            .map(|(s, _)| *s)
            .collect();
        for stream in streams {
            self.photos.active.remove(&stream);
            let _ = self.worker.send(&Command::PhotoClose { stream });
        }
        if let Some(entry) = self.photos.store.entry(id)? {
            if entry.direction == "outgoing" {
                self.photos
                    .store
                    .update(id, "queued", 0, Some(message.into()))?;
            } else {
                let _ = std::fs::remove_file(self.photos.store.partial(id)?);
            }
        }
        signal(&self.notify);
        Ok(())
    }
    fn photo_pump(&mut self, stream: u64) -> Result<()> {
        let active = self
            .photos
            .active
            .get_mut(&stream)
            .context("Unknown screenshot stream")?;
        while active.pending < 4 && active.offset < active.entry.offer.bytes {
            let mut bytes =
                vec![0; media::CHUNK.min((active.entry.offer.bytes - active.offset) as usize)];
            active
                .file
                .as_mut()
                .context("Screenshot file closed")?
                .read_exact(&mut bytes)?;
            active.offset += bytes.len() as u64;
            active.pending += 1;
            self.worker.send(&Command::PhotoWrite { stream, bytes })?;
        }
        if active.offset == active.entry.offer.bytes && active.pending == 0 && !active.finishing {
            active.finishing = true;
            self.worker.send(&Command::PhotoFinish { stream })?;
        }
        Ok(())
    }
    pub(super) fn photo_response(&mut self, response: Response) -> Result<()> {
        match response {
            Response::PhotoOpened {
                id,
                stream,
                transport_key,
                incoming,
            } => {
                let Some(entry) = self.photos.store.entry(&id)? else {
                    self.worker.send(&Command::PhotoClose { stream })?;
                    return Ok(());
                };
                let friend = if incoming {
                    &entry.offer.sender
                } else {
                    &entry.offer.recipient
                };
                let peer = identity::decode_id(friend)?;
                let valid = self.store.state(friend)?.as_deref() == Some("friend")
                    && self
                        .sessions
                        .get(&peer)
                        .is_some_and(|s| s.ready && s.transport == transport_key)
                    && if incoming {
                        entry.direction == "incoming"
                            && entry.offer.recipient == self.identity.id()
                            && entry.decision == Some(true)
                            && matches!(entry.status.as_str(), "accepted" | "receiving")
                    } else {
                        entry.direction == "outgoing"
                            && entry.offer.sender == self.identity.id()
                            && entry.decision == Some(true)
                            && matches!(entry.status.as_str(), "queued" | "connecting")
                    };
                if !valid
                    || self.photos.active.len() >= 6
                    || self.photos.active.values().any(|a| a.entry.offer.id == id)
                {
                    self.worker.send(&Command::PhotoClose { stream })?;
                    return Ok(());
                }
                self.photos.connecting.remove(&id);
                self.photos.offered.remove(&id);
                let file = if incoming {
                    File::create(self.photos.store.partial(&id)?)?
                } else {
                    File::open(self.photos.store.path(&id)?)?
                };
                self.photos.store.update(
                    &id,
                    if incoming { "receiving" } else { "sending" },
                    0,
                    None,
                )?;
                self.photos.active.insert(
                    stream,
                    Active {
                        entry,
                        file: Some(file),
                        incoming,
                        offset: 0,
                        confirmed: 0,
                        checkpoint: 0,
                        pending: 0,
                        finishing: false,
                        last: Instant::now(),
                    },
                );
                if incoming {
                    self.worker.send(&Command::PhotoAccept { stream })?;
                } else {
                    self.photo_pump(stream)?;
                }
            }
            Response::PhotoData { stream, bytes } => {
                let Some(active) = self.photos.active.get_mut(&stream) else {
                    self.worker.send(&Command::PhotoClose { stream })?;
                    return Ok(());
                };
                if !active.incoming
                    || bytes.is_empty()
                    || bytes.len() > media::CHUNK
                    || active.offset + bytes.len() as u64 > active.entry.offer.bytes
                {
                    self.worker.send(&Command::PhotoClose { stream })?;
                    return Ok(());
                }
                active
                    .file
                    .as_mut()
                    .context("Screenshot file closed")?
                    .write_all(&bytes)?;
                active.offset += bytes.len() as u64;
                active.last = Instant::now();
                if active.offset - active.checkpoint >= 256 * 1024 {
                    active.checkpoint = active.offset;
                    self.photos.store.update(
                        &active.entry.offer.id,
                        "receiving",
                        active.offset,
                        None,
                    )?;
                }
            }
            Response::PhotoWritten { stream, bytes } => {
                let Some(active) = self.photos.active.get_mut(&stream) else {
                    return Ok(());
                };
                active.pending = active.pending.saturating_sub(1);
                active.confirmed += bytes as u64;
                active.last = Instant::now();
                if active.confirmed - active.checkpoint >= 256 * 1024 {
                    active.checkpoint = active.confirmed;
                    self.photos.store.update(
                        &active.entry.offer.id,
                        "sending",
                        active.confirmed,
                        None,
                    )?;
                }
                self.photo_pump(stream)?;
            }
            Response::PhotoEnd { stream } => {
                let Some(mut active) = self.photos.active.remove(&stream) else {
                    return Ok(());
                };
                if !active.incoming || active.offset != active.entry.offer.bytes {
                    self.worker.send(&Command::PhotoClose { stream })?;
                    return Ok(());
                }
                if let Some(file) = active.file.take() {
                    file.sync_all()?;
                    drop(file);
                }
                let result = self.photos.store.commit_received(&active.entry.offer.id);
                if result.is_ok() {
                    self.worker.send(&Command::PhotoComplete { stream })?;
                } else {
                    self.worker.send(&Command::PhotoClose { stream })?;
                    let _ =
                        std::fs::remove_file(self.photos.store.partial(&active.entry.offer.id)?);
                }
                result?;
            }
            Response::PhotoDelivered { stream } => {
                if let Some(active) = self.photos.active.remove(&stream) {
                    if !active.incoming
                        && active.offset == active.entry.offer.bytes
                        && active.finishing
                    {
                        self.photos.store.update(
                            &active.entry.offer.id,
                            "delivered",
                            active.entry.offer.bytes,
                            None,
                        )?;
                    }
                }
                self.worker.send(&Command::PhotoClose { stream })?;
            }
            Response::PhotoFailed { id, message } => self.photo_failed(&id, &message)?,
            _ => unreachable!(),
        }
        signal(&self.notify);
        Ok(())
    }
}
