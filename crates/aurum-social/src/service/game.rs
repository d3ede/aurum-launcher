use super::*;
use std::{
    io::ErrorKind,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
};
pub(super) struct OutgoingWorld {
    peer: [u8; 32],
    listener: Listener,
    offer: Offer,
    manifest: Vec<u8>,
    offset: usize,
}
pub(super) struct Bridge {
    peer: [u8; 32],
    tcp: Option<TcpStream>,
    pending: VecDeque<Vec<u8>>,
    queued: usize,
}
struct Guest {
    peer: [u8; 32],
    id: String,
    contact: GameContact,
    candidate: usize,
    dialing: bool,
    listener: Option<TcpListener>,
    available: VecDeque<u64>,
    waiting: VecDeque<TcpStream>,
}
pub(super) struct GameState {
    pub local: GameContact,
    authorized: HashMap<String, ([u8; 32], Listener)>,
    pub streams: HashMap<u64, Bridge>,
    guest: Option<Guest>,
    last_validation: Instant,
}
impl GameState {
    pub fn new(
        address: &str,
        certificate: Vec<u8>,
        port: u16,
        external: Option<SocketAddr>,
    ) -> Result<Self> {
        Ok(Self {
            local: Self::contact(address, certificate, port, external)?,
            authorized: HashMap::new(),
            streams: HashMap::new(),
            guest: None,
            last_validation: Instant::now(),
        })
    }
    pub fn contact(
        address: &str,
        certificate: Vec<u8>,
        port: u16,
        external: Option<SocketAddr>,
    ) -> Result<GameContact> {
        let address: serde_json::Value = serde_json::from_str(address)?;
        let mut candidates = Vec::new();
        if let Some(external) = external {
            candidates.push(external);
        }
        if let Some(addrs) = address["addrs"].as_array() {
            for a in addrs {
                if let Some(addr) = a["Ip"].as_str().and_then(|s| s.parse::<SocketAddr>().ok()) {
                    if addr.is_ipv4() && !addr.ip().is_loopback() && !addr.ip().is_unspecified() {
                        let mut addr = addr;
                        addr.set_port(port);
                        if !candidates.contains(&addr) && candidates.len() < 8 {
                            candidates.push(addr);
                        }
                    }
                }
            }
        }
        Ok(GameContact {
            certificate,
            candidates,
        })
    }
}
impl Actor {
    pub(super) fn revoke_game_peer(&mut self, peer: [u8; 32]) -> Result<()> {
        let hashes = self
            .game
            .authorized
            .iter()
            .filter(|(_, (p, _))| p == &peer)
            .map(|(h, _)| h.clone())
            .collect::<Vec<_>>();
        for hash in hashes {
            self.game.authorized.remove(&hash);
            self.worker.send(&Command::GameRevoke {
                certificate_hash: hash,
            })?;
        }
        let streams = self
            .game
            .streams
            .iter()
            .filter(|(_, b)| b.peer == peer)
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for stream in streams {
            self.game.streams.remove(&stream);
            self.worker.send(&Command::GameClose { stream })?;
        }
        if self.game.guest.as_ref().is_some_and(|g| g.peer == peer) {
            self.game.guest = None;
        }
        self.outgoing_worlds.retain(|_, w| w.peer != peer);
        self.assemblies.retain(|_, a| a.peer != peer);
        let id = identity::encode_id(&peer);
        self.update_live(|l| l.invitations.retain(|i| i.from != id));
        Ok(())
    }
    fn manifest_reservation(&self) -> usize {
        self.outgoing_worlds
            .values()
            .map(|w| w.manifest.len())
            .sum::<usize>()
            + self
                .live
                .lock()
                .map(|l| {
                    l.invitations
                        .iter()
                        .map(|i| i.offer.manifest_bytes)
                        .sum::<usize>()
                })
                .unwrap_or(8 * 1024 * 1024)
    }
    pub(super) fn offer_world(
        &mut self,
        peer: [u8; 32],
        world: WorldSpec,
        listener: Listener,
        manifest: Option<Manifest>,
    ) -> Result<()> {
        if self.store.state(&identity::encode_id(&peer))?.as_deref() != Some("friend") {
            bail!("Invite an accepted friend first");
        }
        if self.outgoing_worlds.len() >= 4 {
            bail!("Too many active invitations");
        }
        listener.revalidate()?;
        self.game.local.validate()?;
        let id = identity::random::<16>()?
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let (manifest, files, download_bytes) = if let Some(manifest) = manifest {
            manifest.validate()?;
            let count = manifest.files.len();
            let bytes = manifest.files.iter().map(|f| f.bytes).sum();
            (serde_json::to_vec(&manifest)?, count, bytes)
        } else {
            (Vec::new(), 0, 0)
        };
        if self.manifest_reservation() + manifest.len() > 8 * 1024 * 1024 {
            bail!("Shared manifest memory limit reached");
        }
        let offer = Offer {
            id: id.clone(),
            expires: identity::now() + 1800,
            world,
            manifest_hash: if manifest.is_empty() {
                None
            } else {
                Some(format!("{:x}", Sha256::digest(&manifest)))
            },
            manifest_bytes: manifest.len(),
            files,
            download_bytes,
        };
        offer.validate()?;
        self.outgoing_worlds.insert(
            id,
            OutgoingWorld {
                peer,
                listener,
                offer: offer.clone(),
                manifest,
                offset: 0,
            },
        );
        self.queue(peer, PeerAction::Invite { offer })
    }
    pub(super) fn join_world(&mut self, id: &str) -> Result<()> {
        let invitation = self
            .live
            .lock()
            .map_err(|_| anyhow::anyhow!("Social state unavailable"))?
            .invitations
            .iter()
            .find(|i| i.offer.id == id)
            .cloned()
            .context("Invitation not found")?;
        invitation.offer.validate()?;
        if invitation.offer.manifest_hash.is_some() && invitation.manifest.is_none() {
            bail!("Shared manifest is still loading");
        }
        if self.game.guest.is_some() {
            bail!("A shared-world connection is already active");
        }
        let peer = identity::decode_id(&invitation.from)?;
        self.game.local.validate()?;
        self.update_live(|l| {
            if let Some(i) = l.invitations.iter_mut().find(|i| i.offer.id == id) {
                i.status = "connecting".into();
            }
        });
        self.queue(
            peer,
            PeerAction::Join {
                id: id.into(),
                contact: self.game.local.clone(),
            },
        )
    }
    pub(super) fn world_action(
        &mut self,
        id: &str,
        peer: [u8; 32],
        action: PeerAction,
    ) -> Result<()> {
        match action {
            PeerAction::Invite { offer } => {
                offer.validate()?;
                if self.manifest_reservation() + offer.manifest_bytes > 8 * 1024 * 1024 {
                    bail!("Shared manifest memory limit reached");
                }
                let count = self
                    .live
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Social state unavailable"))?
                    .invitations
                    .len();
                if count >= 10 || self.assemblies.contains_key(&offer.id) {
                    bail!("Incoming invitation queue is full or duplicated");
                }
                if offer.manifest_hash.is_some() {
                    if self.assemblies.len() >= 4 {
                        bail!("Shared manifest buffer limit reached");
                    }
                    self.assemblies
                        .insert(offer.id.clone(), Assembly::new(peer, offer.clone())?);
                }
                let status = if offer.manifest_hash.is_some() {
                    "loading"
                } else {
                    "pending"
                }
                .into();
                self.update_live(|l| {
                    l.invitations.push(Invitation {
                        from: id.into(),
                        offer,
                        manifest: None,
                        status,
                        join_address: None,
                    })
                });
            }
            PeerAction::ManifestChunk { id, offset, bytes } => {
                let assembly = self
                    .assemblies
                    .get_mut(&id)
                    .context("Unrequested manifest fragment")?;
                if assembly.peer != peer {
                    bail!("Manifest sender mismatch");
                }
                let done = assembly.push(offset, &bytes)?;
                if let Some(manifest) = done {
                    self.assemblies.remove(&id);
                    self.update_live(|l| {
                        if let Some(i) = l.invitations.iter_mut().find(|i| i.offer.id == id) {
                            i.manifest = Some(manifest);
                            i.status = "pending".into();
                        }
                    });
                }
                if offset % (32 * 1024) == 0 {
                    self.send_action(peer, PeerAction::ManifestAck)?;
                }
            }
            PeerAction::ManifestAck => {}
            PeerAction::Join { id, contact } => {
                contact.validate()?;
                let world = self
                    .outgoing_worlds
                    .get(&id)
                    .context("Invitation is no longer shared")?;
                if world.peer != peer || world.offer.expires < identity::now() {
                    bail!("Invitation does not authorize this friend");
                }
                world.listener.revalidate()?;
                let listener = world.listener.clone();
                let hash = format!("{:x}", Sha256::digest(&contact.certificate));
                if self.game.authorized.len() >= 8 && !self.game.authorized.contains_key(&hash) {
                    bail!("Game certificate limit reached");
                }
                self.game.authorized.insert(hash, (peer, listener));
                self.worker.send(&Command::GameAuthorize {
                    certificate: contact.certificate,
                })?;
                for address in contact.candidates {
                    self.worker.send(&Command::GamePunch {
                        address,
                        nonce: identity::random()?,
                    })?;
                }
                self.send_action(
                    peer,
                    PeerAction::GameReady {
                        id,
                        contact: self.game.local.clone(),
                    },
                )?;
            }
            PeerAction::GameReady { id, contact } => {
                contact.validate()?;
                let approved = self
                    .live
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Social state unavailable"))?
                    .invitations
                    .iter()
                    .any(|i| {
                        i.offer.id == id
                            && i.from == identity::encode_id(&peer)
                            && i.status == "connecting"
                            && i.offer.expires >= identity::now()
                    });
                if !approved || self.game.guest.is_some() {
                    bail!("No local consent for this game connection");
                }
                self.game.guest = Some(Guest {
                    peer,
                    id,
                    contact,
                    candidate: 0,
                    dialing: true,
                    listener: None,
                    available: VecDeque::new(),
                    waiting: VecDeque::new(),
                });
                self.game_dial()?;
            }
            PeerAction::InviteRevoked { id } => {
                let owned = self
                    .outgoing_worlds
                    .get(&id)
                    .is_some_and(|w| w.peer == peer)
                    || self.live.lock().is_ok_and(|l| {
                        l.invitations
                            .iter()
                            .any(|i| i.offer.id == id && i.from == identity::encode_id(&peer))
                    });
                if !owned {
                    bail!("Invitation revocation does not belong to this friend");
                }
                self.revoke_game_peer(peer)?;
                if self.assemblies.get(&id).is_some_and(|a| a.peer == peer) {
                    self.assemblies.remove(&id);
                }
                if self
                    .outgoing_worlds
                    .get(&id)
                    .is_some_and(|w| w.peer == peer)
                {
                    self.outgoing_worlds.remove(&id);
                }
                let sender = identity::encode_id(&peer);
                self.update_live(|l| {
                    l.invitations
                        .retain(|i| i.offer.id != id || i.from != sender)
                });
            }
            _ => bail!("Invalid world action"),
        }
        Ok(())
    }
    fn game_dial(&mut self) -> Result<()> {
        let guest = self
            .game
            .guest
            .as_mut()
            .context("No pending game connection")?;
        let address = *guest
            .contact
            .candidates
            .get(guest.candidate)
            .context("Direct game route unavailable; use a compatible VPN")?;
        guest.dialing = true;
        self.worker.send(&Command::GamePunch {
            address,
            nonce: identity::random()?,
        })?;
        self.worker.send(&Command::GameConnect {
            address,
            certificate: guest.contact.certificate.clone(),
        })
    }
    pub(super) fn game_retry(&mut self) -> Result<bool> {
        let Some(guest) = &mut self.game.guest else {
            return Ok(false);
        };
        if !guest.dialing {
            return Ok(false);
        }
        guest.candidate += 1;
        if guest.candidate < guest.contact.candidates.len() {
            self.game_dial()?;
            return Ok(true);
        }
        let id = guest.id.clone();
        self.game.guest = None;
        self.update_live(|l| {
            if let Some(i) = l.invitations.iter_mut().find(|i| i.offer.id == id) {
                i.status = "unreachable".into();
            }
        });
        Ok(false)
    }
    pub(super) fn game_opened(&mut self, stream: u64, hash: &str) -> Result<()> {
        if self.game.streams.len() >= 8 {
            self.worker.send(&Command::GameClose { stream })?;
            bail!("Game bridge limit reached");
        }
        if let Some((peer, listener)) = self.game.authorized.get(hash).cloned() {
            if self.store.state(&identity::encode_id(&peer))?.as_deref() != Some("friend") {
                self.worker.send(&Command::GameClose { stream })?;
                return Ok(());
            }
            listener.revalidate()?;
            let tcp = TcpStream::connect_timeout(
                &listener.connect_address(),
                Duration::from_millis(500),
            )?;
            tcp.set_nonblocking(true)?;
            self.game.streams.insert(
                stream,
                Bridge {
                    peer,
                    tcp: Some(tcp),
                    pending: VecDeque::new(),
                    queued: 0,
                },
            );
            return Ok(());
        }
        if let Some(guest) = self.game.guest.as_mut() {
            if format!("{:x}", Sha256::digest(&guest.contact.certificate)) == hash && guest.dialing
            {
                guest.dialing = false;
                if guest.listener.is_none() {
                    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
                    listener.set_nonblocking(true)?;
                    let address = listener.local_addr()?.to_string();
                    let id = guest.id.clone();
                    guest.listener = Some(listener);
                    if let Ok(mut live) = self.live.lock() {
                        if let Some(i) = live.invitations.iter_mut().find(|i| i.offer.id == id) {
                            i.join_address = Some(address);
                            i.status = "readyToLaunch".into();
                        }
                    }
                    signal(&self.notify);
                }
                let tcp = guest.waiting.pop_front();
                if tcp.is_none() {
                    guest.available.push_back(stream);
                }
                self.game.streams.insert(
                    stream,
                    Bridge {
                        peer: guest.peer,
                        tcp,
                        pending: VecDeque::new(),
                        queued: 0,
                    },
                );
                return Ok(());
            }
        }
        self.worker.send(&Command::GameClose { stream })?;
        bail!("Unapproved game certificate; no TCP target was opened")
    }
    pub(super) fn game_data(&mut self, stream: u64, bytes: Vec<u8>) -> Result<()> {
        let bridge = self
            .game
            .streams
            .get_mut(&stream)
            .context("Game data has no authorized local bridge")?;
        if bytes.len() > 12 * 1024 || bridge.queued + bytes.len() > 256 * 1024 {
            self.worker.send(&Command::GameClose { stream })?;
            self.game.streams.remove(&stream);
            bail!("Game bridge buffer exceeded limit");
        }
        bridge.queued += bytes.len();
        bridge.pending.push_back(bytes);
        Ok(())
    }
    pub(super) fn game_tick(&mut self) -> Result<()> {
        self.assemblies
            .retain(|_, a| a.offer.expires >= identity::now());
        self.outgoing_worlds
            .retain(|_, w| w.offer.expires >= identity::now());
        self.update_expired_invites();
        if self.outbox.len() < 8 && self.inflight < 2 {
            let next = self
                .outgoing_worlds
                .values()
                .find(|w| {
                    w.offset < w.manifest.len()
                        && self.sessions.get(&w.peer).is_some_and(|s| s.ready)
                })
                .map(|w| {
                    (
                        w.offer.id.clone(),
                        w.peer,
                        w.offset,
                        w.manifest[w.offset..(w.offset + 1024).min(w.manifest.len())].to_vec(),
                    )
                });
            if let Some((id, peer, offset, bytes)) = next {
                let len = bytes.len();
                self.send_action(
                    peer,
                    PeerAction::ManifestChunk {
                        id: id.clone(),
                        offset,
                        bytes,
                    },
                )?;
                if let Some(w) = self.outgoing_worlds.get_mut(&id) {
                    w.offset += len;
                }
            }
        }
        if let Some(guest) = self.game.guest.as_mut() {
            if let Some(listener) = &guest.listener {
                if let Ok((tcp, _)) = listener.accept() {
                    tcp.set_nonblocking(true)?;
                    while guest
                        .available
                        .front()
                        .is_some_and(|id| !self.game.streams.contains_key(id))
                    {
                        guest.available.pop_front();
                    }
                    if let Some(stream) = guest.available.pop_front() {
                        if let Some(bridge) = self.game.streams.get_mut(&stream) {
                            bridge.tcp = Some(tcp);
                        }
                    } else if guest.waiting.len() < 2 && !guest.dialing {
                        guest.waiting.push_back(tcp);
                        self.game_dial()?;
                    }
                }
            }
        }
        let mut close = Vec::new();
        let mut outbound = Vec::new();
        for (stream, bridge) in &mut self.game.streams {
            if self
                .store
                .state(&identity::encode_id(&bridge.peer))?
                .as_deref()
                != Some("friend")
            {
                close.push(*stream);
                continue;
            }
            let Some(tcp) = bridge.tcp.as_mut() else {
                continue;
            };
            if let Some(front) = bridge.pending.front_mut() {
                match tcp.write(front) {
                    Ok(0) => close.push(*stream),
                    Ok(n) => {
                        bridge.queued -= n;
                        front.drain(..n);
                        if front.is_empty() {
                            bridge.pending.pop_front();
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(_) => close.push(*stream),
                }
            }
            let mut bytes = vec![0u8; 12 * 1024];
            match tcp.read(&mut bytes) {
                Ok(0) => close.push(*stream),
                Ok(n) => {
                    bytes.truncate(n);
                    outbound.push((*stream, bytes));
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                Err(_) => close.push(*stream),
            }
        }
        for (stream, bytes) in outbound {
            self.worker.send(&Command::GameWrite { stream, bytes })?;
        }
        for stream in close {
            self.game.streams.remove(&stream);
            self.worker.send(&Command::GameClose { stream })?;
        }
        if let Ok(mut live) = self.live.lock() {
            live.active_tunnels = self.game.streams.len();
        }
        if self.game.last_validation.elapsed() > Duration::from_secs(1) {
            self.game.last_validation = Instant::now();
            let revoked = self
                .game
                .authorized
                .iter()
                .filter(|(_, (peer, l))| {
                    l.revalidate().is_err()
                        || self
                            .store
                            .state(&identity::encode_id(peer))
                            .ok()
                            .flatten()
                            .as_deref()
                            != Some("friend")
                })
                .map(|(hash, _)| hash.clone())
                .collect::<Vec<_>>();
            for hash in revoked {
                self.worker.send(&Command::GameRevoke {
                    certificate_hash: hash.clone(),
                })?;
                if let Some((peer, _)) = self.game.authorized.remove(&hash) {
                    let streams = self
                        .game
                        .streams
                        .iter()
                        .filter(|(_, b)| b.peer == peer)
                        .map(|(id, _)| *id)
                        .collect::<Vec<_>>();
                    for stream in streams {
                        self.game.streams.remove(&stream);
                        self.worker.send(&Command::GameClose { stream })?;
                    }
                }
            }
        }
        Ok(())
    }
    fn update_expired_invites(&self) {
        if let Ok(mut live) = self.live.lock() {
            live.invitations
                .retain(|i| i.offer.expires >= identity::now() || i.status == "readyToLaunch");
        }
    }
}
