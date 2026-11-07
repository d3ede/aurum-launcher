//! Local broker. Only this process owns persistent keys, contacts and user intent.
use crate::{
    discovery,
    identity::{self, Identity},
    sandbox::Container,
    store::{Person, Privacy, Store},
    wire::{Command, Response, SignedMessage},
    worker::WorkerClient,
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
mod game;
mod photos;
use crate::{
    listeners::Listener,
    manifest::Manifest,
    world::{Assembly, GameContact, Invitation, Offer, WorldSpec},
};
use sha2::{Digest, Sha256};

const CONTACT_PREFIX: &str = "aurum://social/contact/";
fn visible_default() -> bool {
    true
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub enabled: bool,
    pub status: String,
    pub error: Option<String>,
    pub id: Option<String>,
    pub name: String,
    pub avatar: Option<String>,
    pub contact_link: Option<String>,
    pub privacy: Privacy,
    pub people: Vec<Person>,
    pub online: Vec<String>,
    pub activity: HashMap<String, WorldSpec>,
    pub active_tunnels: usize,
    pub invitations: Vec<Invitation>,
    pub deliveries: HashMap<String, bool>,
    pub outgoing: Vec<crate::world::OutgoingInvitation>,
}
#[derive(Default)]
struct Live {
    enabled: bool,
    status: String,
    error: Option<String>,
    id: Option<String>,
    contact_link: Option<String>,
    seen: HashMap<String, u64>,
    activity: HashMap<String, WorldSpec>,
    active_tunnels: usize,
    invitations: Vec<Invitation>,
    deliveries: HashMap<String, bool>,
    outgoing: Vec<crate::world::OutgoingInvitation>,
    visible: HashMap<String, bool>,
    local_activity: Option<WorldSpec>,
    // Previously authenticated routes survive a worker restart; every new
    // connection still requires a fresh signed challenge and delegation.
    known_contacts: HashMap<[u8; 32], String>,
}
type Notify = Arc<dyn Fn() + Send + Sync>;
struct Notification {
    callback: Notify,
    last: Instant,
}
type Notifications = Arc<Mutex<Option<Notification>>>;
struct Runtime {
    stop: Arc<AtomicBool>,
    commands: SyncSender<Local>,
    join: std::thread::JoinHandle<()>,
    kill: Arc<Mutex<Option<crate::sandbox::JobKiller>>>,
}
struct ActorInit {
    photo_lock: Arc<Mutex<()>>,
    root: PathBuf,
    executable: PathBuf,
    identity: Arc<Identity>,
    stop: Arc<AtomicBool>,
    commands: Arc<Mutex<mpsc::Receiver<Local>>>,
    live: Arc<Mutex<Live>>,
    notify: Notifications,
    lab: Option<u8>,
    kill: Arc<Mutex<Option<crate::sandbox::JobKiller>>>,
}
pub struct Service {
    photo_lock: Arc<Mutex<()>>,
    root: PathBuf,
    runtime: Mutex<Option<Runtime>>,
    live: Arc<Mutex<Live>>,
    notify: Notifications,
    lab: Option<u8>,
}
#[derive(Debug)]
enum Local {
    CancelOffer(String),
    CancelJoin(String),
    Add(String),
    Accept(String),
    Retry(String),
    Remove(String),
    Block(String),
    Unblock(String),
    Privacy(Privacy),
    Activity(Option<WorldSpec>),
    Profile,
    Invite {
        peer: [u8; 32],
        world: WorldSpec,
        listener: Listener,
        manifest: Box<Option<Manifest>>,
        reply: SyncSender<std::result::Result<String, String>>,
    },
    Join {
        id: String,
        reply: SyncSender<std::result::Result<(), String>>,
    },
    Dismiss(String),
    Stop,
}
impl Service {
    pub fn new(root: PathBuf) -> Self {
        Self {
            photo_lock: Arc::new(Mutex::new(())),
            root,
            runtime: Mutex::new(None),
            live: Arc::new(Mutex::new(Live::default())),
            notify: Arc::new(Mutex::new(None)),
            lab: None,
        }
    }
    #[cfg(feature = "lab")]
    pub fn laboratory(root: PathBuf, slot: u8) -> Result<Self> {
        if slot > 1 {
            bail!("Only two independent lab slots are supported");
        }
        let mut service = Self::new(root);
        service.lab = Some(slot);
        Ok(service)
    }
    pub fn set_notifier(&self, callback: Notify) {
        *self.notify.lock().unwrap_or_else(|p| p.into_inner()) = Some(Notification {
            callback,
            last: Instant::now() - Duration::from_secs(1),
        });
    }
    pub fn is_enabled(&self) -> bool {
        self.live.lock().is_ok_and(|l| l.enabled)
    }
    fn store(&self) -> Result<Store> {
        Store::open(&self.root.join("social.sqlite"))
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let s = self.store()?;
        let live = self
            .live
            .lock()
            .map_err(|_| anyhow::anyhow!("Social state unavailable"))?;
        let id = live.id.clone().or(s.value("publicId")?);
        Ok(Snapshot {
            enabled: live.enabled,
            status: if !live.enabled && id.is_some() && !self.root.join("identity.dpapi").exists() {
                "identity_missing".into()
            } else if live.status.is_empty() {
                "disabled".into()
            } else {
                live.status.clone()
            },
            error: live.error.clone(),
            id,
            name: s.value("name")?.unwrap_or_else(|| "Player".into()),
            avatar: s.value("avatar")?.filter(|s| !s.is_empty()),
            contact_link: live.contact_link.clone(),
            privacy: s.privacy()?,
            people: s.people()?,
            online: live
                .seen
                .iter()
                .filter(|(id, seen)| {
                    identity::now().saturating_sub(**seen) < 90
                        && live.visible.get(*id).copied().unwrap_or(false)
                })
                .map(|(id, _)| id.clone())
                .collect(),
            invitations: live.invitations.clone(),
            deliveries: live.deliveries.clone(),
            outgoing: live.outgoing.clone(),
            activity: live
                .activity
                .iter()
                .filter(|(id, _)| {
                    live.seen
                        .get(*id)
                        .is_some_and(|seen| identity::now().saturating_sub(*seen) < 90)
                })
                .map(|(id, world)| (id.clone(), world.clone()))
                .collect(),
            active_tunnels: live.active_tunnels,
        })
    }
    pub fn enabled_previously(&self) -> bool {
        self.store()
            .ok()
            .and_then(|s| s.value("enabled").ok().flatten())
            .as_deref()
            == Some("true")
    }
    pub fn enable(&self, executable: PathBuf, name: String, accepted: bool) -> Result<()> {
        if !accepted {
            bail!("Explicit Social consent is required");
        }
        crate::store::validate_name(&name)?;
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("Social runtime unavailable"))?;
        if runtime.as_ref().is_some_and(|r| !r.join.is_finished()) {
            return Ok(());
        }
        let store = self.store()?;
        let path = self.root.join("identity.dpapi");
        let identity = if path.exists() {
            Identity::load(&path).map_err(|error| {
                if let Ok(mut live) = self.live.lock() { live.status = "identity_missing".into(); }
                anyhow::anyhow!("Social identity key cannot be read. Restore your backup: {error}")
            })?
        } else if store.value("publicId")?.is_some() || !store.people()?.is_empty() {
            if let Ok(mut live) = self.live.lock() { live.status = "identity_missing".into(); }
            bail!("Social identity key is missing. Restore your backup.");
        } else {
            let identity = Identity::generate()?;
            identity.save(&path)?;
            identity
        };
        if store.value("publicId")?.is_some_and(|id| id != identity.id()) {
            if let Ok(mut live) = self.live.lock() { live.status = "identity_missing".into(); }
            bail!("Social identity does not match saved contacts. Restore your backup.");
        }
        store.set("name", &name)?;
        store.set("enabled", "true")?;
        store.set("publicId", &identity.id())?;
        let stop = Arc::new(AtomicBool::new(false));
        let (commands, receiver) = mpsc::sync_channel(32);
        let receiver = Arc::new(Mutex::new(receiver));
        let identity = Arc::new(identity);
        {
            let mut live = self
                .live
                .lock()
                .map_err(|_| anyhow::anyhow!("Social state unavailable"))?;
            live.enabled = true;
            live.status = "connecting".into();
            live.error = None;
            live.id = Some(identity.id());
        }
        let root = self.root.clone();
        let live = self.live.clone();
        let notify = self.notify.clone();
        let stopping = stop.clone();
        let lab = self.lab;
        let photo_lock = self.photo_lock.clone();
        let kill = Arc::new(Mutex::new(None));
        let actor_kill = kill.clone();
        let join = std::thread::spawn(move || {
            let mut delay = 1u64;
            while !stopping.load(Ordering::Acquire) {
                // This is the same in-memory key, never a regenerated identity.
                let key_path = root.join("identity.dpapi");
                if !key_path.exists() { let _ = identity.save(&key_path); }
                let started = Instant::now();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| Actor::run(ActorInit {
                    photo_lock: photo_lock.clone(),
                    root: root.clone(), executable: executable.clone(), identity: identity.clone(),
                    stop: stopping.clone(), commands: receiver.clone(), live: live.clone(),
                    notify: notify.clone(), lab, kill: actor_kill.clone(),
                }))).unwrap_or_else(|_| Err(anyhow::anyhow!("Social worker stopped unexpectedly")));
                if stopping.load(Ordering::Acquire) { break; }
                if let Ok(mut state) = live.lock() {
                    state.enabled = true;
                    state.status = "reconnecting".into();
                    state.error = Some(result.err().map(|e| e.to_string().chars().take(300).collect()).unwrap_or_else(|| "Social worker stopped unexpectedly".into()));
                    state.contact_link = None;
                    state.seen.clear(); state.activity.clear(); state.visible.clear();
                    state.active_tunnels = 0; state.deliveries.clear();
                    for invitation in &mut state.invitations {
                        invitation.status = "failed".into(); invitation.join_address = None;
                        invitation.error = Some("Social connection interrupted. Please retry the invitation.".into());
                    }
                    for outgoing in &mut state.outgoing { outgoing.status = "failed".into(); }
                }
                signal(&notify);
                if started.elapsed() >= Duration::from_secs(60) { delay = 1; }
                let deadline = Instant::now() + Duration::from_secs(delay);
                while !stopping.load(Ordering::Acquire) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(50));
                }
                delay = (delay * 2).min(30);
            }
            if let Ok(mut state) = live.lock() {
                state.enabled = false; state.status = "disabled".into(); state.error = None;
                state.contact_link = None; state.seen.clear(); state.activity.clear();
                state.active_tunnels = 0; state.invitations.clear(); state.outgoing.clear();
                state.deliveries.clear(); state.visible.clear(); state.local_activity = None; state.known_contacts.clear();
            }
            signal(&notify);
        });
        *runtime = Some(Runtime {
            stop,
            commands,
            join,
            kill,
        });
        signal(&self.notify);
        Ok(())
    }
    pub fn disable(&self) -> Result<()> {
        self.shutdown()?;
        self.store()?.set("enabled", "false")?;
        signal(&self.notify);
        Ok(())
    }
    pub fn shutdown(&self) -> Result<()> {
        if let Some(runtime) = self
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("Social runtime unavailable"))?
            .take()
        {
            runtime.stop.store(true, Ordering::Release);
            let _ = runtime.commands.try_send(Local::Stop);
            let started = Instant::now();
            while !runtime.join.is_finished() && started.elapsed() < Duration::from_secs(5) {
                if started.elapsed() > Duration::from_secs(1) {
                    if let Ok(kill) = runtime.kill.lock() {
                        if let Some(kill) = kill.as_ref() {
                            kill.terminate();
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            if runtime.join.is_finished() {
                let _ = runtime.join.join();
            } else {
                if let Ok(kill) = runtime.kill.lock() {
                    if let Some(kill) = kill.as_ref() {
                        kill.terminate();
                    }
                }
                bail!("Social shutdown exceeded its deadline; isolated worker job terminated");
            }
        }
        Ok(())
    }
    fn submit(&self, action: Local) -> Result<()> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("Social runtime unavailable"))?;
        let runtime = runtime.as_ref().context("Enable Aurum Social first")?;
        if runtime.join.is_finished() {
            bail!("Social worker is unavailable; disable Social before retrying");
        }
        runtime
            .commands
            .try_send(action)
            .context("Social action queue is full or closed")?;
        Ok(())
    }
    pub fn add(&self, input: String) -> Result<()> {
        parse_contact(&input)?;
        self.submit(Local::Add(input))
    }
    pub fn activity(&self, world: Option<WorldSpec>) -> Result<()> {
        if let Some(world) = &world {
            world.validate()?;
        }
        self.submit(Local::Activity(world))
    }
    pub fn has_active_tunnels(&self) -> bool {
        self.live.lock().is_ok_and(|l| l.active_tunnels > 0)
    }
    pub fn relationship(&self, id: String, action: &str) -> Result<()> {
        let id = identity::encode_id(&identity::decode_id(&id)?);
        if !self.is_enabled() {
            let store = self.store()?;
            match action {
                "block" => store.block(&id)?,
                "unblock" => store.unblock(&id)?,
                "remove" | "decline" => store.remove(&id)?,
                _ => bail!("Enable Social before sending a friend response"),
            };
            signal(&self.notify);
            return Ok(());
        }
        match action {
            "accept" => self.submit(Local::Accept(id)),
            "retry" => self.submit(Local::Retry(id)),
            "remove" | "decline" => self.submit(Local::Remove(id)),
            "block" => self.submit(Local::Block(id)),
            "unblock" => self.submit(Local::Unblock(id)),
            _ => bail!("Unknown relationship action"),
        }
    }
    pub fn set_privacy(&self, privacy: Privacy) -> Result<()> {
        let state = self.snapshot()?;
        if state.enabled {
            if privacy.public_relays != state.privacy.public_relays {
                bail!("Disable Social before changing public relay use");
            }
            self.submit(Local::Privacy(privacy))
        } else {
            self.store()?.set_privacy(&privacy)?;
            signal(&self.notify);
            Ok(())
        }
    }
    pub fn rename(&self, name: &str) -> Result<()> {
        crate::store::validate_name(name)?;
        self.store()?.set("name", name)?;
        if self.is_enabled() {
            self.submit(Local::Profile)?;
        }
        signal(&self.notify);
        Ok(())
    }
    pub fn invite(
        &self,
        id: &str,
        world: WorldSpec,
        listener: Listener,
        manifest: Option<Manifest>,
    ) -> Result<String> {
        world.validate()?;
        listener.revalidate()?;
        if let Some(m) = &manifest {
            m.validate()?;
        }
        let (reply, answer) = mpsc::sync_channel(1);
        self.submit(Local::Invite {
            peer: identity::decode_id(id)?,
            world,
            listener,
            manifest: Box::new(manifest),
            reply,
        })?;
        answer
            .recv_timeout(Duration::from_secs(10))
            .context("Invitation preparation timed out")?
            .map_err(anyhow::Error::msg)
    }
    pub fn delivery(&self, id: &str) -> Option<bool> {
        self.live.lock().ok()?.deliveries.get(id).copied()
    }
    pub fn cancel_offer(&self, id: String) -> Result<()> {
        self.submit(Local::CancelOffer(id))
    }
    pub fn set_avatar(&self, avatar: Option<String>) -> Result<()> {
        crate::profile::validate_avatar(&avatar)?;
        self.store()?
            .set("avatar", avatar.as_deref().unwrap_or(""))?;
        if self.is_enabled() {
            self.submit(Local::Profile)?;
        }
        signal(&self.notify);
        Ok(())
    }
    pub fn join(&self, id: String) -> Result<()> {
        let (reply, answer) = mpsc::sync_channel(1);
        self.submit(Local::Join { id, reply })?;
        answer
            .recv_timeout(Duration::from_secs(10))
            .context("Join preparation timed out")?
            .map_err(anyhow::Error::msg)
    }
    pub fn abandon_join(&self, id: String) -> Result<()> {
        self.submit(Local::CancelJoin(id))
    }
    pub fn dismiss(&self, id: String) -> Result<()> {
        self.submit(Local::Dismiss(id))
    }
    pub fn export_identity(&self, password: &str) -> Result<Vec<u8>> {
        Identity::load(&self.root.join("identity.dpapi"))?.export(password)
    }
    pub fn restore_identity(&self, bytes: &[u8], password: &str, replace: bool) -> Result<()> {
        let identity = Identity::restore(bytes, password)?;
        self.restore_prepared(identity, replace)
    }
    pub fn restore_prepared(&self, identity: Identity, replace: bool) -> Result<()> {
        let path = self.root.join("identity.dpapi");
        let different = self.store()?.value("publicId")?.is_some_and(|id| id != identity.id());
        if (path.exists() || different) && !replace {
            bail!("Confirm replacement of the current identity");
        }
        self.shutdown()?;
        let temp = self.root.join("restore.dpapi");
        if temp.exists() {
            std::fs::remove_file(&temp)?;
        }
        identity.save(&temp)?;
        // Replace atomically on the same volume: a failed restore must preserve
        // the previous key rather than deleting it before rename succeeds.
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            bail!(
                "Identity restore could not replace the protected key: {}",
                std::io::Error::last_os_error()
            );
        }
        let mut store = self.store()?;
        store.restore_identity(&identity.id())?;
        let mut live = self
            .live
            .lock()
            .map_err(|_| anyhow::anyhow!("Social state unavailable"))?;
        live.id = Some(identity.id());
        live.contact_link = None;
        live.seen.clear();
        drop(live);
        signal(&self.notify);
        Ok(())
    }
    #[cfg(feature = "lab")]
    pub fn interrupt_worker_for_lab(&self) -> Result<()> {
        let runtime = self.runtime.lock().map_err(|_| anyhow::anyhow!("Runtime unavailable"))?;
        let runtime = runtime.as_ref().context("No running worker")?;
        let killer = runtime.kill.lock().map_err(|_| anyhow::anyhow!("Worker unavailable"))?;
        killer.as_ref().context("No worker yet")?.terminate();
        Ok(())
    }
}
impl Drop for Service {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Body {
    Hello {
        contact: Vec<u8>,
        challenge: [u8; 32],
    },
    HelloAck {
        contact: Vec<u8>,
        challenge: [u8; 32],
    },
    Confirm,
    Action {
        action: PeerAction,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum PeerAction {
    PhotoOffer { offer: crate::photos::Offer },
    PhotoReady { id: String },
    PhotoReceipt { id: String },
    PhotoRejected { id: String, reason: String },
    Request {
        name: String,
    },
    Accepted {
        name: String,
    },
    Ping,
    Pong,
    Presence {
        world: Option<WorldSpec>,
        #[serde(default = "visible_default")]
        visible: bool,
    },
    Profile {
        name: String,
        avatar: Option<String>,
    },
    InviteReceived {
        id: String,
    },
    Removed,
    Invite {
        offer: Offer,
    },
    ManifestChunk {
        id: String,
        offset: usize,
        bytes: Vec<u8>,
    },
    ManifestAck,
    ManifestRequest {
        id: String,
        offset: usize,
    },
    Leave {
        id: String,
    },
    WorldUnavailable {
        id: String,
    },
    Join {
        id: String,
        contact: GameContact,
    },
    GameReady {
        id: String,
        contact: GameContact,
    },
    InviteRevoked {
        id: String,
    },
}
#[derive(Clone)]
struct Session {
    address: String,
    transport: [u8; 32],
    incoming: [u8; 32],
    outgoing: Option<[u8; 32]>,
    received: u64,
    sent: u64,
    ready: bool,
    expires: Instant,
}
struct Actor {
    photos: photos::State,
    identity: Arc<Identity>,
    store: Store,
    worker: WorkerClient,
    stop: Arc<AtomicBool>,
    live: Arc<Mutex<Live>>,
    notify: Notifications,
    contact: Vec<u8>,
    sessions: HashMap<[u8; 32], Session>,
    retired: HashMap<[u8; 32], VecDeque<Session>>,
    resolving: HashMap<[u8; 32], Instant>,
    contacts: HashMap<[u8; 32], String>,
    pending: VecDeque<([u8; 32], PeerAction)>,
    unknown_window: Instant,
    unknown_count: u32,
    received_window: Instant,
    received_count: u32,
    current_send_peer: Option<([u8; 32], [u8; 32])>,
    outbox: VecDeque<Command>,
    inflight: usize,
    outgoing_worlds: HashMap<String, game::OutgoingWorld>,
    assemblies: HashMap<String, Assembly>,
    game: game::GameState,
    activity: Option<WorldSpec>,
}
impl Actor {
    fn run(init: ActorInit) -> Result<()> {
        let ActorInit {
            photo_lock,
            root,
            executable,
            identity,
            stop,
            commands,
            live,
            notify,
            lab,
            kill,
        } = init;
        let store = Store::open(&root.join("social.sqlite"))?;
        let public = store.privacy()?.public_relays;
        let container = Container::open(match lab {
            Some(0) => "Aurum.Social.LabA.v1",
            Some(_) => "Aurum.Social.LabB.v1",
            None => "Aurum.Social.Client.v1",
        })?;
        // Grant RX to this fixed bundled image only. No game or user-data roots.
        container.allow_runtime_read(
            executable
                .parent()
                .context("Missing Social runtime directory")?,
        )?;
        container.allow_runtime_read(&executable)?;
        let mut worker = WorkerClient::spawn(&container, &executable)?;
        *kill
            .lock()
            .map_err(|_| anyhow::anyhow!("Worker kill switch unavailable"))? =
            Some(worker.child.killer()?);
        worker.send(&Command::Start {
            public_relays: public,
            ports: if lab.is_some() {
                [0; 3]
            } else {
                crate::firewall::PORTS
            },
        })?;
        let deadline = Instant::now() + Duration::from_secs(30);
        let (ready, game) = loop {
            if stop.load(Ordering::Acquire) {
                worker.stop()?;
                return Ok(());
            }
            if Instant::now() > deadline {
                bail!("Social network initialization timed out");
            }
            match worker.receive(Duration::from_millis(100)) {
                Ok(Response::Ready {
                    address,
                    game_certificate,
                    game_port,
                    game_external,
                    ..
                }) => {
                    let game =
                        game::GameState::new(&address, game_certificate, game_port, game_external)?;
                    break (address, game);
                }
                Ok(Response::Error { message, .. }) => bail!("{message}"),
                Ok(_) => {}
                Err(_) if worker.child.running() => {}
                Err(e) => return Err(e),
            }
        };
        let contact = discovery::sign(&identity, ready)?;
        discovery::verify(&identity.public_key(), &contact)?;
        let activity = live.lock().map_err(|_| anyhow::anyhow!("Social state unavailable"))?.local_activity.clone();
        let contacts = live.lock().map_err(|_| anyhow::anyhow!("Social state unavailable"))?.known_contacts.clone();
        let mut actor = Self {
            photos: photos::State::new(crate::photos::Store::new(root.join("photos"), photo_lock))?,
            identity,
            store,
            worker,
            stop,
            live,
            notify,
            contact,
            sessions: HashMap::new(),
            retired: HashMap::new(),
            resolving: HashMap::new(),
            contacts,
            pending: VecDeque::new(),
            unknown_window: Instant::now(),
            unknown_count: 0,
            received_window: Instant::now(),
            received_count: 0,
            current_send_peer: None,
            outbox: VecDeque::new(),
            inflight: 0,
            outgoing_worlds: HashMap::new(),
            assemblies: HashMap::new(),
            game,
            activity,
        };
        actor.update_live(|l| {
            l.status = "online".into();
            l.error = None;
            l.contact_link = Some(format!(
                "{CONTACT_PREFIX}{}",
                URL_SAFE_NO_PAD.encode(&actor.contact)
            ));
        });
        actor.worker.send(&Command::Publish {
            packet: actor.contact.clone(),
        })?;
        let mut presence = Instant::now();
        let mut presence_offset = 0usize;
        let mut refresh = Instant::now();
        while !actor.stop.load(Ordering::Acquire) {
            if !actor.worker.child.running() {
                bail!("Social worker has stopped");
            }
            for _ in 0..8 {
                match commands.lock().map_err(|_| anyhow::anyhow!("Social command queue unavailable"))?.try_recv() {
                    Ok(Local::Stop) => {
                        actor.stop.store(true, Ordering::Release);
                        break;
                    }
                    Ok(command) => {
                        if let Err(e) = actor.local(command) {
                            actor.error(e);
                        }
                    }
                    Err(_) => break,
                }
            }
            for _ in 0..16 {
                match actor.worker.poll() {
                    Some(Ok(response)) => {
                        if let Err(e) = actor.response(response) {
                            actor.error(e);
                        }
                    }
                    Some(Err(e)) => return Err(e),
                    None => break,
                }
            }
            actor
                .sessions
                .retain(|_, session| session.expires > Instant::now());
            actor
                .resolving
                .retain(|_, at| at.elapsed() < Duration::from_secs(45));
            for sessions in actor.retired.values_mut() {
                sessions.retain(|s| s.expires > Instant::now());
            }
            actor.retired.retain(|_, s| !s.is_empty());
            if let Err(e) = actor.game_tick() {
                actor.error(e);
            }
            if let Err(e) = actor.photo_tick() { actor.error(e); }
            // One acknowledged control message at a time preserves signed sequence
            // order across independent QUIC streams and bounds relay traffic.
            if actor.inflight < 1 {
                if let Some(command) = actor.outbox.pop_front() {
                    if let Command::Send { bytes, .. } = &command {
                        actor.current_send_peer = serde_json::from_slice::<SignedMessage>(bytes)
                            .ok()
                            .map(|m| (m.recipient, m.session));
                    }
                    actor.worker.send(&command)?;
                    actor.inflight += 1;
                }
            }
            if presence.elapsed() > Duration::from_secs(5) {
                presence = Instant::now();
                let friends = actor
                    .store
                    .people()?
                    .into_iter()
                    .filter(|p| p.state == "friend")
                    .collect::<Vec<_>>();
                for p in friends
                    .iter()
                    .cycle()
                    .skip(presence_offset)
                    .take(friends.len().min(16))
                {
                    let _ = actor.queue(identity::decode_id(&p.id)?, PeerAction::Ping);
                    let _ = actor.queue(
                        identity::decode_id(&p.id)?,
                        PeerAction::Presence {
                            world: actor.shared_activity()?,
                            visible: !actor.store.privacy()?.invisible,
                        },
                    );
                }
                presence_offset = if friends.is_empty() {
                    0
                } else {
                    (presence_offset + 16) % friends.len()
                };
            }
            if refresh.elapsed() > Duration::from_secs(120) {
                refresh = Instant::now();
                actor.worker.send(&Command::Refresh)?;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        actor.worker.stop()?;
        Ok(())
    }
    fn update_live(&self, update: impl FnOnce(&mut Live)) {
        if let Ok(mut live) = self.live.lock() {
            update(&mut live);
        }
        signal(&self.notify);
    }
    fn error(&self, error: impl std::fmt::Display) {
        self.update_live(|l| l.error = Some(error.to_string().chars().take(300).collect()));
    }
    fn local(&mut self, command: Local) -> Result<()> {
        match command {
            Local::Add(input) => {
                let (peer, ticket) = parse_contact(&input)?;
                if peer == self.identity.public_key() {
                    bail!("You cannot add your own Aurum ID");
                }
                let id = identity::encode_id(&peer);
                if let Some(ticket) = ticket {
                    let contact = discovery::verify(&peer, &ticket)?;
                    self.cache_contact(peer, contact.endpoint)?;
                }
                match self.store.state(&id)?.as_deref() {
                    Some("friend") => self.queue(peer, PeerAction::Ping)?,
                    Some("outgoing") => {
                        self.queue(peer, PeerAction::Request { name: self.name()? })?
                    }
                    Some("incoming") => {
                        self.store.accept(&id)?;
                        self.queue(peer, PeerAction::Accepted { name: self.name()? })?;
                    }
                    _ => {
                        self.store.request(&id, "")?;
                        self.queue(peer, PeerAction::Request { name: self.name()? })?;
                    }
                }
            }
            Local::Accept(id) => {
                self.store.accept(&id)?;
                self.queue(
                    identity::decode_id(&id)?,
                    PeerAction::Accepted { name: self.name()? },
                )?;
            }
            Local::Retry(id) => {
                if self.store.state(&id)?.as_deref() != Some("outgoing") {
                    bail!("No outgoing request to retry");
                }
                self.queue(
                    identity::decode_id(&id)?,
                    PeerAction::Request { name: self.name()? },
                )?;
            }
            Local::Remove(id) => {
                let peer = identity::decode_id(&id)?;
                let friend = self.store.state(&id)?.as_deref() == Some("friend");
                self.store.remove(&id)?;
                if friend {
                    let _ = self.queue(peer, PeerAction::Removed);
                }
                self.sessions.remove(&peer);
                self.retired.remove(&peer);
                self.revoke_game_peer(peer)?;
                self.update_live(|l| {
                    l.seen.remove(&id);
                });
            }
            Local::Block(id) => {
                let peer = identity::decode_id(&id)?;
                self.store.block(&id)?;
                self.revoke_game_peer(peer)?;
                self.outbox.retain(|command|!matches!(command,Command::Send{bytes,..}if serde_json::from_slice::<SignedMessage>(bytes).is_ok_and(|m|m.recipient==peer)));
                self.sessions.remove(&peer);
                self.retired.remove(&peer);
                self.contacts.remove(&peer);
                self.pending.retain(|(p, _)| p != &peer);
                self.update_live(|l| {
                    l.seen.remove(&id);
                });
            }
            Local::Unblock(id) => self.store.unblock(&id)?,
            Local::CancelOffer(id) => {
                if let Some(world) = self.outgoing_worlds.remove(&id) {
                    self.update_live(|l| {
                        l.deliveries.remove(&id);
                        if let Some(i) = l.outgoing.iter_mut().find(|i| i.id == id) {
                            i.status = "failed".into();
                        }
                    });
                    self.pending.retain(
                        |(_, action)| !matches!(action,PeerAction::Invite{offer}if offer.id==id),
                    );
                    let _ = self.queue(world.peer, PeerAction::InviteRevoked { id });
                }
            }
            Local::CancelJoin(id) => self.cancel_join(&id)?,
            Local::Privacy(privacy) => {
                self.store.set_privacy(&privacy)?;
                self.broadcast_activity()?;
            }
            Local::Profile => self.broadcast_profile()?,
            Local::Activity(world) => {
                if self.activity == world {
                    return Ok(());
                }
                self.update_live(|live| live.local_activity = world.clone());
                self.activity = world;
                self.broadcast_activity()?;
            }
            Local::Invite {
                peer,
                world,
                listener,
                manifest,
                reply,
            } => {
                let result = self.offer_world(peer, world, listener, *manifest);
                let _ = reply.try_send(result.map_err(|e| e.to_string()));
            }
            Local::Join { id, reply } => {
                let result = self.join_world(&id);
                let _ = reply.try_send(result.map_err(|e| e.to_string()));
            }
            Local::Dismiss(id) => {
                let peer = self.live.lock().ok().and_then(|l| {
                    l.invitations
                        .iter()
                        .find(|i| i.offer.id == id)
                        .map(|i| i.from.clone())
                });
                self.assemblies.remove(&id);
                self.update_live(|l| l.invitations.retain(|i| i.offer.id != id));
                if let Some(peer) = peer {
                    let key = identity::decode_id(&peer)?;
                    self.revoke_game_peer(key)?;
                    let _ = self.queue(key, PeerAction::InviteRevoked { id });
                }
            }
            Local::Stop => {}
        }
        self.update_live(|l| l.error = None);
        signal(&self.notify);
        Ok(())
    }
    fn name(&self) -> Result<String> {
        Ok(self.store.value("name")?.unwrap_or_else(|| "Player".into()))
    }
    fn shared_activity(&self) -> Result<Option<WorldSpec>> {
        let privacy = self.store.privacy()?;
        Ok(if privacy.share_activity && !privacy.invisible {
            self.activity.clone()
        } else {
            None
        })
    }
    fn broadcast_activity(&mut self) -> Result<()> {
        let world = self.shared_activity()?;
        for p in self
            .store
            .people()?
            .into_iter()
            .filter(|p| p.state == "friend")
            .take(32)
        {
            let _ = self.queue(
                identity::decode_id(&p.id)?,
                PeerAction::Presence {
                    world: world.clone(),
                    visible: !self.store.privacy()?.invisible,
                },
            );
        }
        Ok(())
    }
    fn own_profile(&self) -> Result<PeerAction> {
        Ok(PeerAction::Profile {
            name: self.name()?,
            avatar: self.store.value("avatar")?.filter(|s| !s.is_empty()),
        })
    }
    fn broadcast_profile(&mut self) -> Result<()> {
        for p in self
            .store
            .people()?
            .into_iter()
            .filter(|p| p.state == "friend")
            .take(128)
        {
            let _ = self.queue(identity::decode_id(&p.id)?, self.own_profile()?);
        }
        Ok(())
    }
    fn replace_session(&mut self, peer: [u8; 32], session: Session) {
        // Messages already signed for the retired session must not delay a new
        // handshake. User intent in `pending` is signed only after confirmation.
        self.outbox.retain(|command| match command {
            Command::Send { bytes, .. } => serde_json::from_slice::<SignedMessage>(bytes)
                .is_ok_and(|message| message.recipient != peer),
            _ => true,
        });
        if let Some(mut old) = self.sessions.insert(peer, session) {
            old.expires = Instant::now() + Duration::from_secs(30);
            let retired = self.retired.entry(peer).or_default();
            if retired.len() >= 2 {
                retired.pop_front();
            }
            retired.push_back(old);
        }
    }
    fn cache_contact(&mut self, peer: [u8; 32], address: String) -> Result<()> {
        if self.contacts.len() >= 256 && !self.contacts.contains_key(&peer) {
            let keep = self
                .store
                .people()?
                .into_iter()
                .filter(|p| p.state == "friend")
                .map(|p| identity::decode_id(&p.id))
                .collect::<Result<std::collections::HashSet<_>>>()?;
            self.contacts.retain(|key, _| keep.contains(key));
        }
        self.contacts.insert(peer, address);
        self.update_live(|live| live.known_contacts.clone_from(&self.contacts));
        Ok(())
    }
    fn queue(&mut self, peer: [u8; 32], action: PeerAction) -> Result<()> {
        if self.store.blocked(&identity::encode_id(&peer)) {
            bail!("This identity is blocked");
        }
        if self
            .sessions
            .get(&peer)
            .is_some_and(|s| s.ready && s.expires > Instant::now())
        {
            return self.send_action(peer, action);
        }
        if self.pending.len() >= 32 {
            bail!("Social outgoing queue is full");
        }
        self.pending.push_back((peer, action));
        if self
            .sessions
            .get(&peer)
            .is_some_and(|s| s.expires > Instant::now())
        {
            return Ok(());
        }
        if let Some(address) = self.contacts.get(&peer).cloned() {
            self.hello(peer, address)
        } else {
            if self.resolving.contains_key(&peer) {
                return Ok(());
            }
            self.resolving.insert(peer, Instant::now());
            self.worker.send(&Command::Resolve { public_key: peer })
        }
    }
    fn hello(&mut self, peer: [u8; 32], address: String) -> Result<()> {
        if self.sessions.len() >= 128 {
            bail!("Social peer limit reached");
        }
        let transport = transport_key(&address)?;
        let challenge = identity::random()?;
        self.replace_session(
            peer,
            Session {
                address: address.clone(),
                transport,
                incoming: challenge,
                outgoing: None,
                received: 0,
                sent: 0,
                ready: false,
                expires: Instant::now() + Duration::from_secs(30),
            },
        );
        self.send(
            &address,
            peer,
            challenge,
            1,
            Body::Hello {
                contact: self.contact.clone(),
                challenge,
            },
        )
    }
    fn send(
        &mut self,
        address: &str,
        peer: [u8; 32],
        session: [u8; 32],
        sequence: u64,
        body: Body,
    ) -> Result<()> {
        if self.outbox.len() >= 64 {
            bail!("Social send queue is full");
        }
        let message = SignedMessage::new(
            &self.identity,
            peer,
            session,
            sequence,
            serde_json::to_vec(&body)?,
        )?;
        let bytes = serde_json::to_vec(&message)?;
        if bytes.len() > 16384 {
            bail!("Signed Social message exceeds limit");
        }
        self.outbox.push_back(Command::Send {
            address: address.into(),
            bytes,
        });
        Ok(())
    }
    fn send_action(&mut self, peer: [u8; 32], action: PeerAction) -> Result<()> {
        let s = self
            .sessions
            .get_mut(&peer)
            .context("Missing peer session")?;
        s.sent = s.sent.checked_add(1).context("Social sequence exhausted")?;
        let (address, nonce, sequence) = (
            s.address.clone(),
            s.outgoing.context("Peer handshake not complete")?,
            s.sent,
        );
        self.send(&address, peer, nonce, sequence, Body::Action { action })
    }
    fn flush(&mut self, peer: [u8; 32]) -> Result<()> {
        let mut actions = Vec::new();
        self.pending.retain(|(p, a)| {
            if *p == peer {
                actions.push(a.clone());
                false
            } else {
                true
            }
        });
        for action in actions {
            self.send_action(peer, action)?;
        }
        Ok(())
    }
    fn response(&mut self, response: Response) -> Result<()> {
        if matches!(&response, Response::PhotoOpened{..}|Response::PhotoData{..}|Response::PhotoWritten{..}|Response::PhotoEnd{..}|Response::PhotoDelivered{..}|Response::PhotoFailed{..}) {
            return self.photo_response(response);
        }
        match response {
            Response::GameAddress {
                address,
                certificate,
                port,
                external,
            } => {
                self.game.local = game::GameState::contact(&address, certificate, port, external)?;
            }
            Response::Resolved { packet } => {
                if packet.len() < 32 {
                    bail!("Invalid discovery response");
                }
                let peer: [u8; 32] = packet[..32].try_into()?;
                self.resolving.remove(&peer);
                if !self.pending.iter().any(|(p, _)| p == &peer) {
                    return Ok(());
                }
                let contact = discovery::verify(&peer, &packet)?;
                self.cache_contact(peer, contact.endpoint.clone())?;
                if !self
                    .sessions
                    .get(&peer)
                    .is_some_and(|s| s.expires > Instant::now())
                {
                    self.hello(peer, contact.endpoint)?;
                }
            }
            Response::Received {
                transport_key,
                bytes,
            } => self.incoming(transport_key, &bytes)?,
            Response::Ready {
                address,
                game_certificate,
                game_port,
                game_external,
                ..
            } => {
                self.game.local =
                    game::GameState::contact(&address, game_certificate, game_port, game_external)?;
                self.contact = discovery::sign(&self.identity, address)?;
                self.update_live(|l| {
                    l.contact_link = Some(format!(
                        "{CONTACT_PREFIX}{}",
                        URL_SAFE_NO_PAD.encode(&self.contact)
                    ))
                });
                self.worker.send(&Command::Publish {
                    packet: self.contact.clone(),
                })?;
            }
            Response::Sent => {
                self.inflight = self.inflight.saturating_sub(1);
                self.current_send_peer = None;
            }
            Response::Error { operation, message } => {
                if operation == "send" {
                    self.inflight = self.inflight.saturating_sub(1);
                    if let Some((peer, nonce)) = self.current_send_peer.take() {
                        if self.sessions.get(&peer).is_some_and(|s| {
                            s.outgoing == Some(nonce)
                                || (s.outgoing.is_none() && s.incoming == nonce)
                        }) {
                            self.contacts.remove(&peer);
                            self.sessions.remove(&peer);
                        }
                    }
                }
                if operation == "game-connect" && self.game_retry()? {
                    return Ok(());
                }
                self.error(format!(
                    "{operation}: {message}. Try a fresh contact link if ID lookup is unavailable."
                ));
            }
            Response::Published { nodes } => {
                if nodes == 0 {
                    self.error("DHT publication was not acknowledged; share a contact link");
                }
            }
            Response::Stopped => bail!("Social worker stopped unexpectedly"),
            Response::GameOpened {
                stream,
                certificate_hash,
            } => self.game_opened(stream, &certificate_hash)?,
            Response::GameData { stream, bytes } => self.game_data(stream, bytes)?,
            Response::GameClosed { stream } => {
                self.game.streams.remove(&stream);
                self.worker.send(&Command::GameClose { stream })?;
            }
            _ => {}
        }
        Ok(())
    }
    fn incoming(&mut self, transport: [u8; 32], bytes: &[u8]) -> Result<()> {
        if self.received_window.elapsed() > Duration::from_secs(1) {
            self.received_window = Instant::now();
            self.received_count = 0;
        }
        if self.received_count >= 64 {
            return Ok(());
        }
        self.received_count += 1;
        if bytes.len() > 16384 {
            bail!("Peer message exceeds limit");
        }
        let message: SignedMessage = serde_json::from_slice(bytes)?;
        // Authenticate even stale messages before deciding to discard them.
        message.verify(&self.identity.public_key(), &message.session, 0)?;
        let peer = message.sender;
        let id = identity::encode_id(&peer);
        if peer == self.identity.public_key() || self.store.blocked(&id) {
            return Ok(());
        }
        let body: Body = serde_json::from_slice(&message.body)?;
        match body {
            Body::Hello { contact, challenge } => {
                if message.session != challenge || message.sequence != 1 {
                    bail!("Invalid greeting challenge");
                }
                message.verify(&self.identity.public_key(), &challenge, 0)?;
                let c = discovery::verify(&peer, &contact)?;
                if transport_key(&c.endpoint)? != transport {
                    bail!("Transport is not delegated by this Aurum ID");
                }
                let known = self.store.state(&id)?.is_some();
                if !known {
                    if !self.store.privacy()?.incoming_requests {
                        return Ok(());
                    }
                    if self.unknown_window.elapsed() > Duration::from_secs(60) {
                        self.unknown_count = 0;
                        self.unknown_window = Instant::now();
                    }
                    if self.unknown_count >= 3 {
                        return Ok(());
                    }
                    self.unknown_count += 1;
                }
                if self.sessions.len() >= 128 && !self.sessions.contains_key(&peer) {
                    bail!("Peer session limit reached");
                }
                if let Some(current) = self.sessions.get(&peer) {
                    if current.transport == transport && current.outgoing == Some(challenge) {
                        return Ok(());
                    }
                    // Both peers may start discovery at the same time. The lower
                    // root key wins initiation, without abandoning fresh challenges.
                    if current.outgoing.is_none()
                        && current.transport == transport
                        && current.expires > Instant::now()
                        && self.identity.public_key() < peer
                    {
                        return Ok(());
                    }
                }
                let incoming = identity::random()?;
                self.cache_contact(peer, c.endpoint.clone())?;
                self.replace_session(
                    peer,
                    Session {
                        address: c.endpoint.clone(),
                        transport,
                        incoming,
                        outgoing: Some(challenge),
                        received: 0,
                        sent: 1,
                        ready: false,
                        expires: Instant::now() + Duration::from_secs(30),
                    },
                );
                self.send(
                    &c.endpoint,
                    peer,
                    challenge,
                    1,
                    Body::HelloAck {
                        contact: self.contact.clone(),
                        challenge: incoming,
                    },
                )?;
            }
            Body::HelloAck { contact, challenge } => {
                if !self
                    .sessions
                    .get(&peer)
                    .is_some_and(|s| s.incoming == message.session && s.outgoing.is_none())
                {
                    return Ok(());
                }
                let session = self
                    .sessions
                    .get_mut(&peer)
                    .context("Unsolicited handshake response")?;
                message.verify(
                    &self.identity.public_key(),
                    &session.incoming,
                    session.received,
                )?;
                let c = discovery::verify(&peer, &contact)?;
                if transport != session.transport || transport_key(&c.endpoint)? != transport {
                    bail!("Transport delegation mismatch");
                }
                session.outgoing = Some(challenge);
                session.received = message.sequence;
                session.sent = 1;
                session.ready = true;
                session.expires = Instant::now() + Duration::from_secs(180);
                let address = session.address.clone();
                self.send(&address, peer, challenge, 1, Body::Confirm)?;
                self.mark_online(&id);
                self.flush(peer)?;
                self.queue(peer, self.own_profile()?)?;
            }
            Body::Confirm | Body::Action { .. } => {
                let current = self
                    .sessions
                    .get(&peer)
                    .is_some_and(|s| s.incoming == message.session);
                let session = if current {
                    self.sessions.get_mut(&peer)
                } else {
                    self.retired.get_mut(&peer).and_then(|all| {
                        all.iter_mut()
                            .find(|s| s.incoming == message.session && s.expires > Instant::now())
                    })
                };
                let Some(session) = session else {
                    return Ok(());
                };
                if session.transport != transport {
                    bail!("Session transport changed");
                }
                message.verify(
                    &self.identity.public_key(),
                    &session.incoming,
                    session.received,
                )?;
                session.received = message.sequence;
                let newly_ready = !session.ready;
                session.ready = true;
                if current {
                    session.expires = Instant::now() + Duration::from_secs(180);
                }
                self.mark_online(&id);
                if let Body::Action { action } = body {
                    self.peer_action(&id, peer, action)?;
                }
                if current {
                    self.flush(peer)?;
                    if newly_ready {
                        self.queue(peer, self.own_profile()?)?;
                    }
                }
            }
        }
        Ok(())
    }
    fn mark_online(&self, id: &str) {
        if self.store.state(id).ok().flatten().as_deref() == Some("friend") {
            self.update_live(|l| {
                l.seen.insert(id.into(), identity::now());
            });
        }
    }
    fn peer_action(&mut self, id: &str, peer: [u8; 32], action: PeerAction) -> Result<()> {
        match action {
            PeerAction::Request { name } => match self.store.state(id)?.as_deref() {
                Some("friend") => self.queue(peer, PeerAction::Accepted { name: self.name()? })?,
                Some("outgoing") => {
                    self.store.accepted_by_peer(id, &name)?;
                    self.queue(peer, PeerAction::Accepted { name: self.name()? })?;
                }
                _ => {
                    self.store.incoming(id, &name)?;
                }
            },
            PeerAction::Accepted { name } => {
                if self.store.accepted_by_peer(id, &name)? {
                    self.mark_online(id);
                }
            }
            PeerAction::Ping => {
                if self.store.state(id)?.as_deref() == Some("friend") {
                    self.queue(peer, PeerAction::Pong)?;
                }
            }
            PeerAction::Pong => {}
            PeerAction::Profile { name, avatar } => {
                self.store.set_profile(id, &name, &avatar)?;
            }
            PeerAction::Presence { world, visible } => {
                if self.store.state(id)?.as_deref() != Some("friend") {
                    bail!("Activity requires an accepted friend");
                }
                if let Some(world) = &world {
                    world.validate()?;
                }
                self.update_live(|l| {
                    l.visible.insert(id.into(), visible);
                    if !visible {
                        l.activity.remove(id);
                    }
                    if let Some(world) = world.filter(|_| visible) {
                        l.activity.insert(id.into(), world);
                    } else {
                        l.activity.remove(id);
                    }
                });
            }
            PeerAction::Removed => {
                self.store.remove(id)?;
                self.revoke_game_peer(peer)?;
                self.sessions.remove(&peer);
                self.update_live(|l| {
                    l.seen.remove(id);
                });
            }
            other => {
                if self.store.state(id)?.as_deref() != Some("friend") {
                    bail!("World actions require an accepted friend");
                }
                match other {
                    action @ (PeerAction::PhotoOffer{..}|PeerAction::PhotoReady{..}|PeerAction::PhotoReceipt{..}|PeerAction::PhotoRejected{..}) => self.photo_action(id, peer, action)?,
                    action => self.world_action(id, peer, action)?,
                }
            }
        }
        signal(&self.notify);
        Ok(())
    }
}
fn signal(notify: &Notifications) {
    let callback = notify.lock().ok().and_then(|mut state| {
        let state = state.as_mut()?;
        if state.last.elapsed() < Duration::from_millis(500) {
            return None;
        }
        state.last = Instant::now();
        Some(state.callback.clone())
    });
    if let Some(callback) = callback {
        callback();
    }
}
pub fn parse_contact(input: &str) -> Result<([u8; 32], Option<Vec<u8>>)> {
    let input = input.trim();
    if let Some(ticket) = input.strip_prefix(CONTACT_PREFIX) {
        if ticket.len() > 1600 {
            bail!("Contact link exceeds limit");
        }
        let packet = URL_SAFE_NO_PAD.decode(ticket)?;
        if packet.len() < 32 {
            bail!("Invalid contact link");
        }
        let peer = packet[..32].try_into()?;
        discovery::verify(&peer, &packet)?;
        Ok((peer, Some(packet)))
    } else {
        Ok((identity::decode_id(input)?, None))
    }
}
fn transport_key(address: &str) -> Result<[u8; 32]> {
    let value: serde_json::Value = serde_json::from_str(address)?;
    let key = value["id"].as_str().context("Missing transport key")?;
    if key.len() != 64 {
        bail!("Invalid transport key length");
    }
    let mut bytes = [0u8; 32];
    for (index, pair) in key.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        bytes[index] = u8::from_str_radix(std::str::from_utf8(pair)?, 16)?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn missing_or_replaced_key_never_creates_a_new_identity_for_saved_contacts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("social.sqlite")).unwrap();
        let old = Identity::generate().unwrap().id();
        let peer = Identity::generate().unwrap().id();
        store.set("publicId", &old).unwrap();
        store.set("name", "Saved player").unwrap();
        store.request(&peer, "Friend").unwrap();
        let service = Service::new(dir.path().to_owned());
        assert_eq!(service.snapshot().unwrap().status, "identity_missing");
        assert!(service.enable("missing-worker.exe".into(), "Saved player".into(), true).is_err());
        assert!(!dir.path().join("identity.dpapi").exists());
        assert_eq!(service.snapshot().unwrap().id.as_deref(), Some(old.as_str()));
        assert_eq!(service.snapshot().unwrap().people.len(), 1);
        let replacement = Identity::generate().unwrap();
        assert!(service.restore_prepared(replacement, false).is_err());
        let other = Identity::generate().unwrap();
        other.save(&dir.path().join("identity.dpapi")).unwrap();
        assert!(service.enable("missing-worker.exe".into(), "Saved player".into(), true).is_err());
        assert_eq!(service.snapshot().unwrap().id.as_deref(), Some(old.as_str()));
        assert_eq!(service.snapshot().unwrap().people.len(), 1);
    }
    #[test]
    fn protected_key_creation_is_atomic_and_never_overwrites_an_existing_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("identity.dpapi");
        let first = Identity::generate().unwrap();
        first.save(&path).unwrap();
        let second = Identity::generate().unwrap();
        assert!(second.save(&path).is_err());
        assert_eq!(Identity::load(&path).unwrap().id(), first.id());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
