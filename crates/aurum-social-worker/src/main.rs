#![cfg_attr(windows, windows_subsystem = "windows")]
mod transport;
mod udp_mux;
mod photos;
use anyhow::{bail, Context, Result};
use aurum_social::wire::{self, Command, Response, SOCIAL_ALPN};
use iroh::{EndpointAddr, RelayMode};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{
    io::AsyncReadExt,
    sync::{mpsc, Semaphore},
    time::timeout,
};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    // There is deliberately no unsandboxed networking mode.
    #[cfg(windows)]
    let isolated = aurum_social::sandbox::current_isolation()
        .is_ok_and(|i| i.app_container && i.integrity_rid <= 4096);
    #[cfg(not(windows))]
    let isolated = false;
    if !isolated || std::env::args().nth(1).as_deref() != Some("--broker") {
        std::process::exit(2);
    }
    if let Err(error) = run().await {
        let _ = wire::write(
            &mut std::io::stdout().lock(),
            &Response::Error {
                operation: "worker".into(),
                message: error.to_string(),
            },
        );
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let (commands_tx, mut commands) = mpsc::channel::<Command>(16);
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        while let Ok(command) = wire::read(&mut input) {
            if commands_tx.blocking_send(command).is_err() {
                break;
            }
        }
    });
    let (output, mut responses) = mpsc::channel::<Response>(32);
    let writer = std::thread::spawn(move || {
        let mut out = std::io::stdout().lock();
        while let Some(response) = responses.blocking_recv() {
            if wire::write(&mut out, &response).is_err() {
                break;
            }
        }
    });
    let Some(Command::Start {
        public_relays,
        ports,
    }) = commands.recv().await
    else {
        bail!("Expected explicit initialization");
    };
    let endpoint = iroh::endpoint::Builder::empty()
        .crypto_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .alpns(vec![SOCIAL_ALPN.to_vec(), wire::PHOTO_ALPN.to_vec()])
        .bind_addr((std::net::Ipv4Addr::UNSPECIFIED, ports[0]))?
        .relay_mode(if public_relays {
            RelayMode::Default
        } else {
            RelayMode::Disabled
        })
        .bind()
        .await?;
    let game = Arc::new(transport::GameEndpoint::bind(ports[1], public_relays).await?);
    if public_relays {
        let _ = timeout(Duration::from_secs(15), endpoint.online()).await;
    }
    // Do not bootstrap the public DHT until a publication/lookup is requested.
    let mut discovery: Option<pkarr::Client> = None;
    output
        .send(Response::Ready {
            address: serde_json::to_string(&endpoint.addr())?,
            game_certificate: game.certificate.clone(),
            game_port: game.endpoint.local_addr()?.port(),
            game_external: game.external(),
            stun_error: game.stun_error.clone(),
        })
        .await?;
    let permits = Arc::new(Semaphore::new(4));
    let incoming_permits = Arc::new(Semaphore::new(8));
    let send_permits = Arc::new(Semaphore::new(2));
    let game_permits = Arc::new(Semaphore::new(2));
    let mut tasks = tokio::task::JoinSet::new();
    let mut photos = photos::Photos::new(output.clone());
    let mut streams: HashMap<u64, noq::SendStream> = HashMap::new();
    let mut game_connections: HashMap<u64, noq::Connection> = HashMap::new();
    let mut mapping_timer = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(20),
        Duration::from_secs(20),
    );
    mapping_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut next_stream = 1u64;
    let (opened_tx, mut opened) =
        mpsc::channel::<(noq::Connection, noq::SendStream, noq::RecvStream)>(8);
    loop {
        tokio::select! {
            command=commands.recv()=> {
                let Some(command)=command else { break; };
                if matches!(command, Command::Stop) { break; }
                let operation=match &command{Command::Send{..}=>"send",Command::GameConnect{..}=>"game-connect",Command::Publish{..}=>"publish",Command::Resolve{..}=>"resolve",_=>"command"};
                let result:Result<()>=async { match command {
                    command @ (Command::PhotoConnect{..}|Command::PhotoAccept{..}|Command::PhotoWrite{..}|Command::PhotoFinish{..}|Command::PhotoComplete{..}|Command::PhotoClose{..}) => photos.command(command,&endpoint).await?,
                    Command::Refresh=>{output.send(Response::Ready{address:serde_json::to_string(&endpoint.addr())?,game_certificate:game.certificate.clone(),game_port:game.endpoint.local_addr()?.port(),game_external:game.external(),stun_error:game.stun_error.clone()}).await?;}
                    Command::ProbeSandbox{canary,parent_pid}=>{
                        #[cfg(windows)] { let i=aurum_social::sandbox::current_isolation()?; let child=std::process::Command::new(format!("{}\\System32\\cmd.exe",std::env::var("SystemRoot")?)).args(["/c","exit","0"]).spawn(); let child_denied=match child {Err(_)=>true, Ok(mut child)=>{let _=child.kill();let _=child.wait();false}}; output.send(Response::SandboxProbe{app_container:i.app_container, integrity_rid:i.integrity_rid,canary_denied:std::fs::read(canary).is_err(),child_denied,parent_memory_denied:!aurum_social::sandbox::can_open_process_memory(parent_pid)}).await?; }
                    }
                    Command::Publish{packet}=>{
                        if packet.len()<104 || packet.len()>1104 { bail!("Invalid discovery packet length"); }
                        let public=pkarr::PublicKey::try_from(&packet[..32])?;
                        let packet=pkarr::SignedPacket::from_relay_payload(&public,&packet[32..].to_vec().into())?;
                        let client=discovery_client(&mut discovery,ports[2])?; let tx=output.clone(); let permit=permits.clone().try_acquire_owned().context("Worker is busy")?;
                        tasks.spawn(async move { let _permit=permit; let response=match timeout(Duration::from_secs(45),client.publish(&packet)).await { Ok(Ok(nodes))=>Response::Published{nodes:nodes as usize}, Ok(Err(e))=>failure("publish",e), Err(e)=>failure("publish",e) }; let _=tx.send(response).await; });
                    }
                    Command::Resolve{public_key}=>{
                        let public=pkarr::PublicKey::try_from(&public_key[..])?;
                        let client=discovery_client(&mut discovery,ports[2])?; let tx=output.clone(); let permit=permits.clone().try_acquire_owned().context("Worker is busy")?;
                        tasks.spawn(async move { let _permit=permit; let response=match timeout(Duration::from_secs(45),client.resolve(&public,pkarr::ResolvePolicy::NetworkOnly)).await { Ok(Ok(packet))=>Response::Resolved{packet:packet.as_bytes().to_vec()}, Ok(Err(e))=>failure("resolve",e), Err(e)=>failure("resolve",e) }; let _=tx.send(response).await; });
                    }
                    Command::Send{address,bytes}=>{
                        if address.len()>4096 || bytes.len()>16384 {bail!("Social message exceeds limit");}
                        let address:EndpointAddr=serde_json::from_str(&address)?; validate_address(&address)?;
                        let endpoint=endpoint.clone(); let tx=output.clone();let permit=send_permits.clone().try_acquire_owned().context("Worker is busy")?;
                        tasks.spawn(async move {let _permit=permit; let result:Result<()>=async {timeout(Duration::from_secs(15),async {let conn=endpoint.connect(address,SOCIAL_ALPN).await?;let (mut send,mut recv)=conn.open_bi().await?;send.write_all(&bytes).await?;send.finish()?; let reply=recv.read_to_end(1).await?; if reply!=[1] {bail!("Social receipt failed");} conn.close(0u32.into(),b"done"); Ok::<(),anyhow::Error>(())}).await??;Ok(())}.await;let _=tx.send(match result {Ok(())=>Response::Sent,Err(e)=>failure("send",e)}).await;});
                    }
                    Command::GameAuthorize{certificate}=>{game.authorize(&certificate)?;output.send(Response::GameAuthorized).await?;}
                    Command::GameRevoke{certificate_hash}=>{game.revoke(&certificate_hash)?;for connection in game_connections.values(){if let Some(certs)=connection.peer_identity().and_then(|i|i.downcast::<Vec<rustls::pki_types::CertificateDer<'static>>>().ok()){if certs.first().is_some_and(|cert|format!("{:x}",Sha256::digest(cert))==certificate_hash){connection.close(0u32.into(),b"authorization revoked");}}}}
                    Command::GameConnect{address,certificate}=>{
                        let game=game.clone();let tx=output.clone();let opened_tx=opened_tx.clone();let permit=game_permits.clone().try_acquire_owned().context("Game connector is busy")?;
                        tasks.spawn(async move{let _permit=permit;let result:Result<()>=async{
                          let conn=game.connect(address,&certificate).await?;let(mut send,mut recv)=conn.open_bi().await?;
                          timeout(Duration::from_secs(5),send.write_all(b"AUG1")).await??;let mut ack=[0u8;4];timeout(Duration::from_secs(5),recv.read_exact(&mut ack)).await??;
                          if &ack!=b"AUG1"{bail!("Game endpoint did not confirm mutual authentication");}
                          opened_tx.send((conn,send,recv)).await?;Ok(())
                        }.await;if let Err(error)=result{let _=tx.send(failure("game-connect",error)).await;}});
                    }
                    Command::GamePunch{address,nonce}=>{game.punch(address,nonce)?;}
                    Command::GameWrite{stream,bytes}=>{if bytes.len()>12*1024{bail!("Game IPC chunk exceeds limit");}let send=streams.get_mut(&stream).context("Unknown game stream")?;timeout(Duration::from_secs(5),send.write_all(&bytes)).await??;}
                    Command::GameClose{stream}=>{if let Some(conn)=game_connections.remove(&stream){conn.close(0u32.into(),b"bridge closed");}
                    if let Some(mut send)=streams.remove(&stream){let _=send.finish();}}
                    Command::Start{..}|Command::Stop=>bail!("Invalid worker state"),
                } Ok(()) }.await;
                if let Err(error)=result {output.send(failure(operation,error)).await?;}
            }
            Some(incoming)=endpoint.accept()=>{
                let photo_opener=photos.opener.clone();
                if let Ok(permit)=incoming_permits.clone().try_acquire_owned(){ let tx=output.clone();tasks.spawn(async move {let _permit=permit;let result:Result<()>=async {let connection=timeout(Duration::from_secs(10),incoming).await??;if connection.alpn()==wire::PHOTO_ALPN {photos::accept(connection,photo_opener).await?;return Ok(());}let remote=*connection.remote_id().as_bytes(); let (mut send,mut recv)=timeout(Duration::from_secs(10),connection.accept_bi()).await??;let bytes=timeout(Duration::from_secs(10),recv.read_to_end(16384)).await??;tx.send(Response::Received{transport_key:remote,bytes}).await?;send.write_all(&[1]).await?;send.finish()?;let _=timeout(Duration::from_secs(2),connection.closed()).await;Ok(())}.await;if let Err(e)=result{let _=tx.send(failure("incoming",e)).await;}}); } else {incoming.refuse();}
            }
            Some(opened)=photos.opened.recv()=>{photos.start(opened).await?;}
            Some(incoming)=game.endpoint.accept()=>{
                if streams.len()>=8 {incoming.refuse();continue;}
                let tx=opened_tx.clone();let permit=incoming_permits.clone().try_acquire_owned();
                if let Ok(permit)=permit {tasks.spawn(async move {let _permit=permit;if let Ok(Ok(conn))=timeout(Duration::from_secs(10),incoming).await{if let Ok(Ok((mut send,mut recv)))=timeout(Duration::from_secs(10),conn.accept_bi()).await{let mut preface=[0u8;4];if matches!(timeout(Duration::from_secs(5),recv.read_exact(&mut preface)).await,Ok(Ok(_)))&&&preface==b"AUG1"&&matches!(timeout(Duration::from_secs(5),send.write_all(b"AUG1")).await,Ok(Ok(_))){let _=tx.send((conn,send,recv)).await;}}}});}else{incoming.refuse();}
            }
            Some((conn,send,mut recv))=opened.recv()=>{
                if streams.len()>=8{conn.close(1u32.into(),b"limit");continue;}
                let stream=next_stream; next_stream=next_stream.checked_add(1).context("Stream sequence exhausted")?;
                let certs=conn.peer_identity().and_then(|i|i.downcast::<Vec<rustls::pki_types::CertificateDer<'static>>>().ok()).context("Missing authenticated game certificate")?;
                let certificate_hash=format!("{:x}",Sha256::digest(certs.first().context("Missing game certificate")?));
                game_connections.insert(stream,conn.clone());streams.insert(stream,send);output.send(Response::GameOpened{stream,certificate_hash}).await?;
                let tx=output.clone();tasks.spawn(async move {let _conn=conn;let mut buf=vec![0u8;12*1024];loop{match timeout(Duration::from_secs(120),AsyncReadExt::read(&mut recv,&mut buf)).await{Ok(Ok(0))|Err(_)|Ok(Err(_))=>break,Ok(Ok(len))=>{if tx.send(Response::GameData{stream,bytes:buf[..len].to_vec()}).await.is_err(){break;}}}} let _=tx.send(Response::GameClosed{stream}).await;});
            }
            Some(_)=tasks.join_next(),if !tasks.is_empty()=>{}
            _=mapping_timer.tick(),if public_relays=>{
                let mapping=game.mapping.clone();let certificate=game.certificate.clone();let address=serde_json::to_string(&endpoint.addr())?;let port=game.endpoint.local_addr()?.port();let tx=output.clone();
                tasks.spawn(async move{let external=mapping.refresh().await.ok();let _=tx.send(Response::GameAddress{address,certificate,port,external}).await;});
            }
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    streams.clear();
    game.endpoint.close(0u32.into(), b"Social disabled");
    endpoint.close().await;
    drop(discovery);
    output.send(Response::Stopped).await?;
    drop(output);
    let _ = writer.join();
    Ok(())
}
fn failure(operation: &str, error: impl std::fmt::Display) -> Response {
    Response::Error {
        operation: operation.into(),
        message: error.to_string().chars().take(300).collect(),
    }
}
fn discovery_client(client: &mut Option<pkarr::Client>, port: u16) -> Result<pkarr::Client> {
    if client.is_none() {
        let mut builder = pkarr::Client::builder();
        builder.cache_size(32).dht(|b| {
            b.port = Some(port);
            b
        });
        *client = Some(builder.build()?);
    }
    Ok(client
        .as_ref()
        .context("DHT initialization failed")?
        .clone())
}
fn validate_address(address: &EndpointAddr) -> Result<()> {
    if address.addrs.len() > 8 {
        bail!("Too many endpoint candidates");
    }
    let allowed = RelayMode::Default.relay_map();
    for addr in &address.addrs {
        match addr {
            iroh::TransportAddr::Relay(url) => {
                if !allowed.urls::<Vec<iroh::RelayUrl>>().contains(url) {
                    bail!("Unapproved Social relay");
                }
            }
            iroh::TransportAddr::Ip(addr) => {
                if addr.port() == 0 || addr.ip().is_unspecified() || addr.ip().is_multicast() {
                    bail!("Invalid Social candidate");
                }
            }
            _ => bail!("Unsupported transport"),
        }
    }
    Ok(())
}
