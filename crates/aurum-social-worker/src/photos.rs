//! Bounded ciphertext streams; paths, image decoding and consent stay in the broker.
use anyhow::{bail, Context, Result};
use aurum_social::wire::{Command, Response, PHOTO_ALPN};
use iroh::{
    endpoint::{Connection, RecvStream, SendStream},
    Endpoint, EndpointAddr,
};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{
    sync::{mpsc, Semaphore},
    time::timeout,
};

pub type Opened = (String, bool, Connection, SendStream, RecvStream);
struct Stream {
    id: String,
    connection: Connection,
    send: SendStream,
    incoming: bool,
}
pub struct Photos {
    pub opened: mpsc::Receiver<Opened>,
    pub opener: mpsc::Sender<Opened>,
    streams: HashMap<u64, Stream>,
    next: u64,
    output: mpsc::Sender<Response>,
    pending: Arc<Semaphore>,
}
fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
impl Photos {
    pub fn new(output: mpsc::Sender<Response>) -> Self {
        let (opener, opened) = mpsc::channel(4);
        Self {
            opened,
            opener,
            streams: HashMap::new(),
            next: 1,
            output,
            pending: Arc::new(Semaphore::new(2)),
        }
    }
    pub async fn start(
        &mut self,
        (id, incoming, connection, send, mut recv): Opened,
    ) -> Result<()> {
        if self.streams.len() >= 6 {
            connection.close(1u32.into(), b"photo stream limit");
            return Ok(());
        }
        let stream = self.next;
        self.next = self
            .next
            .checked_add(1)
            .context("Photo stream sequence exhausted")?;
        let transport_key = *connection.remote_id().as_bytes();
        self.streams.insert(
            stream,
            Stream {
                id: id.clone(),
                connection: connection.clone(),
                send,
                incoming,
            },
        );
        self.output
            .send(Response::PhotoOpened {
                id: id.clone(),
                stream,
                transport_key,
                incoming,
            })
            .await?;
        let output = self.output.clone();
        tokio::spawn(async move {
            let result: Result<()> = async {
                if incoming {
                    let mut total = 0;
                    let mut buffer = vec![0u8; 8192];
                    loop {
                        let size =
                            timeout(Duration::from_secs(90), recv.read(&mut buffer)).await??;
                        let Some(size) = size else { break };
                        total += size;
                        if total > 25 * 1024 * 1024 + 16 {
                            bail!("Screenshot stream exceeds limit");
                        }
                        output
                            .send(Response::PhotoData {
                                stream,
                                bytes: buffer[..size].to_vec(),
                            })
                            .await?;
                    }
                    output.send(Response::PhotoEnd { stream }).await?;
                    let _ = timeout(Duration::from_secs(30), connection.closed()).await;
                } else {
                    let mut receipt = [0u8; 4];
                    timeout(Duration::from_secs(300), recv.read_exact(&mut receipt)).await??;
                    if &receipt != b"DONE" {
                        bail!("Screenshot receipt was not verified");
                    }
                    output.send(Response::PhotoDelivered { stream }).await?;
                }
                Ok(())
            }
            .await;
            if let Err(error) = result {
                let _ = output
                    .send(Response::PhotoFailed {
                        id,
                        message: error.to_string(),
                    })
                    .await;
                connection.close(1u32.into(), b"photo transfer failed");
            }
        });
        Ok(())
    }
    pub fn connect(&self, endpoint: Endpoint, address: String, id: String) -> Result<()> {
        if !valid_id(&id) || address.len() > 4096 {
            bail!("Invalid screenshot connection");
        }
        let address: EndpointAddr = serde_json::from_str(&address)?;
        super::validate_address(&address)?;
        let permit = self
            .pending
            .clone()
            .try_acquire_owned()
            .context("Photo connector busy")?;
        let opened = self.opener.clone();
        let output = self.output.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let result: Result<()> = async {
                let connection = timeout(
                    Duration::from_secs(15),
                    endpoint.connect(address, PHOTO_ALPN),
                )
                .await??;
                let (mut send, mut recv) = connection.open_bi().await?;
                let mut prefix = b"AUP1".to_vec();
                prefix.extend_from_slice(id.as_bytes());
                timeout(Duration::from_secs(5), send.write_all(&prefix)).await??;
                let mut accepted = [0; 4];
                timeout(Duration::from_secs(15), recv.read_exact(&mut accepted)).await??;
                if &accepted != b"OKAY" {
                    bail!("Screenshot offer was not accepted");
                }
                opened
                    .send((id.clone(), false, connection, send, recv))
                    .await?;
                Ok(())
            }
            .await;
            if let Err(error) = result {
                let _ = output
                    .send(Response::PhotoFailed {
                        id,
                        message: error.to_string(),
                    })
                    .await;
            }
        });
        Ok(())
    }
    pub async fn command(&mut self, command: Command, endpoint: &Endpoint) -> Result<()> {
        match command {
            Command::PhotoConnect { address, id } => self.connect(endpoint.clone(), address, id)?,
            Command::PhotoClose { stream } => {
                if let Some(s) = self.streams.remove(&stream) {
                    s.connection.close(0u32.into(), b"photo transfer closed");
                }
            }
            other => {
                let stream = match &other {
                    Command::PhotoAccept { stream }
                    | Command::PhotoWrite { stream, .. }
                    | Command::PhotoFinish { stream }
                    | Command::PhotoComplete { stream } => *stream,
                    _ => bail!("Invalid photo command"),
                };
                let s = self
                    .streams
                    .get_mut(&stream)
                    .context("Unknown screenshot stream")?;
                let result: Result<()> = async {
                    match other {
                        Command::PhotoAccept { .. } => {
                            if !s.incoming {
                                bail!("Invalid screenshot stream direction");
                            }
                            timeout(Duration::from_secs(5), s.send.write_all(b"OKAY")).await??;
                        }
                        Command::PhotoWrite { bytes, .. } => {
                            if s.incoming || bytes.is_empty() || bytes.len() > 8192 {
                                bail!("Invalid screenshot chunk");
                            }
                            timeout(Duration::from_secs(5), s.send.write_all(&bytes)).await??;
                            self.output
                                .send(Response::PhotoWritten {
                                    stream,
                                    bytes: bytes.len(),
                                })
                                .await?;
                        }
                        Command::PhotoFinish { .. } => {
                            s.send.finish()?;
                        }
                        Command::PhotoComplete { .. } => {
                            if !s.incoming {
                                bail!("Invalid screenshot receipt direction");
                            }
                            timeout(Duration::from_secs(5), s.send.write_all(b"DONE")).await??;
                            s.send.finish()?;
                        }
                        _ => unreachable!(),
                    }
                    Ok(())
                }
                .await;
                if let Err(error) = result {
                    self.output
                        .send(Response::PhotoFailed {
                            id: s.id.clone(),
                            message: error.to_string(),
                        })
                        .await?;
                    s.connection.close(1u32.into(), b"photo write failed");
                }
            }
        }
        self.streams
            .retain(|_, s| s.connection.close_reason().is_none());
        Ok(())
    }
}
pub async fn accept(connection: Connection, opened: mpsc::Sender<Opened>) -> Result<()> {
    let (send, mut recv) = timeout(Duration::from_secs(5), connection.accept_bi()).await??;
    let mut prefix = [0u8; 36];
    timeout(Duration::from_secs(5), recv.read_exact(&mut prefix)).await??;
    if &prefix[..4] != b"AUP1" {
        bail!("Invalid screenshot stream header");
    }
    let id = std::str::from_utf8(&prefix[4..])?.to_owned();
    if !valid_id(&id) {
        bail!("Invalid screenshot ID");
    }
    opened.send((id, true, connection, send, recv)).await?;
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use aurum_social::{
        identity::Identity,
        photos::{NewPhoto, Store},
    };
    use std::{
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    async fn endpoint() -> Endpoint {
        iroh::endpoint::Builder::empty()
            .crypto_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .alpns(vec![PHOTO_ALPN.to_vec()])
            .bind_addr((std::net::Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .relay_mode(iroh::RelayMode::Disabled)
            .bind()
            .await
            .unwrap()
    }
    #[test]
    fn photo_chunks_fit_the_existing_bounded_ipc() {
        for frame in [
            aurum_social::wire::encode(&Command::PhotoWrite {
                stream: u64::MAX,
                bytes: vec![255; 8192],
            })
            .unwrap(),
            aurum_social::wire::encode(&Response::PhotoData {
                stream: u64::MAX,
                bytes: vec![255; 8192],
            })
            .unwrap(),
        ] {
            assert!(frame.len() <= aurum_social::wire::MAX_FRAME + 8);
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn encrypted_photo_stream_waits_for_durable_verified_receipt() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.test-data/photo-transport");
        std::fs::create_dir_all(&root).unwrap();
        let root = tempfile_for_test(&root);
        let from = Identity::generate().unwrap().id();
        let to = Identity::generate().unwrap().id();
        let sender = Store::new(root.join("sender"), Arc::new(Mutex::new(())));
        let receiver = Store::new(root.join("receiver"), Arc::new(Mutex::new(())));
        let original: Vec<_> = (0..70_000).map(|i| (i % 251) as u8).collect();
        let id = sender
            .enqueue(
                &from,
                &to,
                vec![NewPhoto {
                    source_id: None,
                    name: "fixture.png".into(),
                    profile_name: "Fixture".into(),
                    width: 128,
                    height: 128,
                    bytes: original.clone(),
                }],
            )
            .unwrap()
            .remove(0);
        let offer = sender.entry(&id).unwrap().unwrap().offer;
        receiver.receive_offer(offer.clone(), &to, &from).unwrap();
        receiver.decide_batch(&offer.batch, &to, true).unwrap();
        let cipher = std::fs::read(sender.path(&id).unwrap()).unwrap();
        let a = endpoint().await;
        let b = endpoint().await;
        let address = EndpointAddr::new(b.id()).with_ip_addr(b.bound_sockets()[0]);
        let (output_a, mut events_a) = mpsc::channel(32);
        let (output_b, mut events_b) = mpsc::channel(32);
        let mut photos_a = Photos::new(output_a);
        let mut photos_b = Photos::new(output_b);
        let durable = Arc::new(AtomicBool::new(false));
        let received = durable.clone();
        let sender_id = a.id();
        let sender_loop = async {
            photos_a
                .connect(
                    a.clone(),
                    serde_json::to_string(&address).unwrap(),
                    id.clone(),
                )
                .unwrap();
            loop {
                tokio::select! {
                    Some(opened)=photos_a.opened.recv()=>photos_a.start(opened).await.unwrap(),
                    Some(event)=events_a.recv()=>match event {
                        Response::PhotoOpened{stream,incoming,..}=>{assert!(!incoming);for bytes in cipher.chunks(8192){photos_a.command(Command::PhotoWrite{stream,bytes:bytes.to_vec()},&a).await.unwrap();}photos_a.command(Command::PhotoFinish{stream},&a).await.unwrap();},
                        Response::PhotoDelivered{stream}=>{assert!(durable.load(Ordering::Acquire));photos_a.command(Command::PhotoClose{stream},&a).await.unwrap();break;},
                        Response::PhotoFailed{message,..}=>panic!("Photo send failed: {message}"),
                        _=>{},
                    }
                }
            }
        };
        let receiver_loop = async {
            let incoming = b.accept().await.unwrap().await.unwrap();
            accept(incoming, photos_b.opener.clone()).await.unwrap();
            let mut bytes = Vec::new();
            loop {
                tokio::select! {
                    Some(opened)=photos_b.opened.recv()=>photos_b.start(opened).await.unwrap(),
                    Some(event)=events_b.recv()=>match event {
                        Response::PhotoOpened{stream,transport_key,incoming,..}=>{assert!(incoming);assert_eq!(transport_key,*sender_id.as_bytes());photos_b.command(Command::PhotoAccept{stream},&b).await.unwrap();},
                        Response::PhotoData{bytes:chunk,..}=>bytes.extend_from_slice(&chunk),
                        Response::PhotoEnd{stream}=>{std::fs::write(receiver.partial(&id).unwrap(),&bytes).unwrap();receiver.commit_received(&id).unwrap();assert_eq!(receiver.read_received(&id,&to).unwrap(),original);received.store(true,Ordering::Release);photos_b.command(Command::PhotoComplete{stream},&b).await.unwrap();break;},
                        Response::PhotoFailed{message,..}=>panic!("Photo receive failed: {message}"),
                        _=>{},
                    }
                }
            }
        };
        timeout(Duration::from_secs(25), async {
            tokio::join!(sender_loop, receiver_loop);
        })
        .await
        .expect("photo transport timed out");
        a.close().await;
        b.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    fn tempfile_for_test(parent: &Path) -> std::path::PathBuf {
        let path = parent.join(aurum_social::photos::new_id().unwrap());
        std::fs::create_dir(&path).unwrap();
        path
    }
}
