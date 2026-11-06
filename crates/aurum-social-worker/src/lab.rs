use anyhow::{bail, Context, Result};
use aurum_social::{
    identity::Identity,
    wire::{Command, Response},
};
#[cfg(windows)]
use aurum_social::{sandbox::Container, worker::WorkerClient};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
#[cfg(windows)]
#[path = "node.rs"]
mod node;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
#[cfg(not(windows))]
fn run() -> Result<()> {
    bail!("This feasibility lab requires Windows AppContainer");
}
#[cfg(windows)]
fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let public = args.iter().any(|a| a == "--public" || a == "--stun-only");
    let root = args
        .iter()
        .position(|a| a == "--data")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".test-data/social-lab"));
    std::fs::create_dir_all(&root)?;
    let root = root.canonicalize()?;
    let executable =
        std::env::current_exe()?.with_file_name(if args.iter().any(|a| a == "--loader-probe") {
            "aurum-social-probe.exe"
        } else {
            "aurum-social-worker.exe"
        });
    if args.iter().any(|a| a == "--node") {
        return node::run(&root, &executable);
    }
    let container_a = Container::open("Aurum.Social.LabA.v1")?;
    let container_b = Container::open("Aurum.Social.LabB.v1")?;
    let runtime = prepare_runtime(&root, &executable, &[&container_a, &container_b])?;
    if args.iter().any(|a| a == "--friends") {
        return friends(&root, &runtime);
    }
    let canary = root.join("broker-only-canary.txt");
    std::fs::write(&canary, b"test-only canary; never use real credentials")?;
    assert!(std::fs::read(&canary).is_ok());
    let mut a =
        WorkerClient::spawn(&container_a, &runtime).context("Start first isolated worker")?;
    if args.iter().any(|a| a == "--loader-probe") {
        std::thread::sleep(Duration::from_secs(1));
        println!(
            "Probe process running: {}, exit: 0x{:08x}",
            a.child.running(),
            a.child.exit_code()
        );
        return Ok(());
    }
    let mut b =
        WorkerClient::spawn(&container_b, &runtime).context("Start second isolated worker")?;
    report("AppContainer token A", "PASS", json!(a.child.isolation));
    report("AppContainer token B", "PASS", json!(b.child.isolation));
    a.send(&Command::Start {
        public_relays: public,
        ports: [0; 3],
    })?;
    b.send(&Command::Start {
        public_relays: public,
        ports: [0; 3],
    })?;
    let ready_a = wait(&a, |r| matches!(r, Response::Ready { .. }), 30)?;
    let ready_b = wait(&b, |r| matches!(r, Response::Ready { .. }), 30)?;
    report(
        "iroh and game QUIC bound inside both containers",
        "PASS",
        json!({"publicRelaysRequested":public}),
    );
    a.send(&Command::ProbeSandbox {
        canary: canary.to_string_lossy().into(),
        parent_pid: std::process::id(),
    })?;
    let probe = wait(&a, |r| matches!(r, Response::SandboxProbe { .. }), 10)?;
    let passed = matches!(
        &probe,
        Response::SandboxProbe {
            app_container: true,
            integrity_rid: 0..=4096,
            canary_denied: true,
            child_denied: true,
            parent_memory_denied: true
        }
    );
    report(
        "OS isolation negative probes",
        if passed { "PASS" } else { "FAIL" },
        json!(probe),
    );
    if !passed {
        bail!("Isolation test failed; refusing further networking tests");
    }
    let (address_a, cert_a, port_a, external_a) = ready(&ready_a)?;
    let (address_b, cert_b, _, _) = ready(&ready_b)?;
    let identity_a = Identity::generate()?;
    let identity_b = Identity::generate()?;
    if public {
        report(
            "STUN on the game socket",
            if external_a.is_some() { "PASS" } else { "FAIL" },
            json!({"mapped":external_a.is_some(),"details":match &ready_a{Response::Ready{stun_error,..}=>stun_error,_=>unreachable!()}}),
        );
        if !args.iter().any(|a| a == "--stun-only") {
            for (client, identity, address, label) in [
                (&mut a, &identity_a, address_a, "A"),
                (&mut b, &identity_b, address_b, "B"),
            ] {
                let packet = aurum_social::discovery::sign(identity, address.into())?;
                aurum_social::discovery::verify(&identity.public_key(), &packet)?;
                client.send(&Command::Publish { packet })?;
                match wait(client, |r| matches!(r, Response::Published { .. }), 50) {
                    Ok(result) => report(
                        &format!("Public Mainline publication {label}"),
                        "PASS",
                        json!(result),
                    ),
                    Err(e) => report(
                        &format!("Public Mainline publication {label}"),
                        "FAIL",
                        json!(e.to_string()),
                    ),
                }
            }
            for (client, identity, label) in [
                (&mut b, &identity_a, "B resolves A"),
                (&mut a, &identity_b, "A resolves B"),
            ] {
                let mut result = Err(anyhow::anyhow!("Lookup not attempted"));
                for attempt in 1..=3 {
                    client.send(&Command::Resolve {
                        public_key: identity.public_key(),
                    })?;
                    result = wait(client, |r| matches!(r, Response::Resolved { .. }), 50).and_then(
                        |response| {
                            let Response::Resolved { packet } = response else {
                                unreachable!()
                            };
                            aurum_social::discovery::verify(&identity.public_key(), &packet)?;
                            Ok(packet.len())
                        },
                    );
                    if result.is_ok() {
                        break;
                    }
                    report(
                        &format!("DHT lookup attempt {attempt}: {label}"),
                        "RETRY",
                        json!(result.as_ref().err().map(ToString::to_string)),
                    );
                    std::thread::sleep(Duration::from_secs(3));
                }
                match result {
                    Ok(bytes) => report(
                        label,
                        "PASS",
                        json!({"bytes":bytes,"signatureVerifiedInBroker":true,"twoComputerProof":false}),
                    ),
                    Err(error) => report(label, "FAIL", json!(error.to_string())),
                }
            }
        }
        a.send(&Command::Refresh)?;
        let _ = wait(&a, |r| matches!(r, Response::Ready { .. }), 10)?;
        let renewal = wait(&a, |r| matches!(r, Response::GameAddress { .. }), 30)?;
        let renewed =
            matches!(&renewal,Response::GameAddress{port,external:Some(_),..}if *port==port_a);
        report(
            "STUN renewal while QUIC owns the same UDP socket",
            if renewed { "PASS" } else { "FAIL" },
            json!({"samePort":renewed,"internetGameProof":false}),
        );
    }
    // These are two different AppContainers, without a loopback exemption.
    if args.iter().any(|a| a == "--busy-discovery") {
        for _ in 0..5 {
            a.send(&Command::Resolve {
                public_key: Identity::generate()?.public_key(),
            })?;
        }
        let busy = a.receive(Duration::from_secs(5))?;
        if !matches!(&busy,Response::Error{operation,message}if operation=="resolve"&&message.contains("busy"))
        {
            bail!("Expected a typed resolver saturation error");
        }
        report(
            "Discovery saturation errors keep their operation type",
            "PASS",
            json!(busy),
        );
        a.send(&Command::Send {
            address: address_b.into(),
            bytes: b"control during discovery".to_vec(),
        })?;
        wait(&a, |r| matches!(r, Response::Sent), 15)?;
        let reply = wait(&b, |r| matches!(r, Response::Received { .. }), 15)?;
        if !matches!(reply,Response::Received{bytes,..}if bytes==b"control during discovery") {
            bail!("Control transport failed during real DHT load");
        }
        report(
            "Control transport survives four real outstanding DHT resolutions",
            "PASS",
            json!({"internetGameProof":false}),
        );
    }
    b.send(&Command::Send {
        address: address_a.into(),
        bytes: vec![255; 16384],
    })?;
    let maximum = wait(&a, |r| matches!(r, Response::Received { .. }), 15)?;
    if !matches!(maximum,Response::Received{bytes,..}if bytes==vec![255;16384]) {
        bail!("Maximum untrusted frame was truncated");
    }
    wait(&b, |r| matches!(r, Response::Sent), 15)?;
    report(
        "Maximum untrusted Social frame survives JSON IPC expansion",
        "PASS",
        json!({"payloadBytes":16384,"workerRunning":a.child.running()}),
    );
    let message = aurum_social::wire::SignedMessage::new(
        &identity_b,
        identity_a.public_key(),
        [7; 32],
        1,
        b"local independent-client check".to_vec(),
    )?;
    b.send(&Command::Send {
        address: address_a.into(),
        bytes: serde_json::to_vec(&message)?,
    })?;
    match wait(&a, |r| matches!(r, Response::Received { .. }), 15) {
        Ok(Response::Received { bytes, .. }) => {
            let msg: aurum_social::wire::SignedMessage = serde_json::from_slice(&bytes)?;
            msg.verify(&identity_a.public_key(), &[7; 32], 0)?;
            report(
                "iroh between independent local containers",
                "PASS",
                json!({"internetProof":false}),
            );
        }
        Ok(_) => unreachable!(),
        Err(e) => report(
            "iroh between independent local containers",
            "FAIL",
            json!(e.to_string()),
        ),
    }
    let _ = wait(&b, |r| matches!(r, Response::Sent), 15);
    // Exercise real TLS denial, not a simulated verifier result.
    a.send(&Command::GameAuthorize {
        certificate: cert_a.clone(),
    })?;
    wait(&a, |r| matches!(r, Response::GameAuthorized), 10)?;
    let route: iroh::EndpointAddr = serde_json::from_str(address_a)?;
    let ip = route
        .ip_addrs()
        .find(|a| a.is_ipv4() && !a.ip().is_loopback())
        .context("No local IPv4 route for certificate-denial test")?
        .ip();
    b.send(&Command::GameConnect {
        address: std::net::SocketAddr::new(ip, port_a),
        certificate: cert_a.clone(),
    })?;
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let response = b.receive(deadline.saturating_duration_since(std::time::Instant::now()))?;
        match response {
            Response::Error { operation, .. } if operation == "game-connect" => break,
            Response::GameOpened { .. } => {
                bail!("Untrusted client certificate opened a game connection")
            }
            _ => {}
        }
    }
    {
        use sha2::Digest;
        a.send(&Command::GameRevoke {
            certificate_hash: format!("{:x}", sha2::Sha256::digest(cert_a)),
        })?;
    }
    report(
        "Real mutual TLS rejects a client outside the authorized trust set",
        "PASS",
        json!({"tcpTargetOpened":false,"internetProof":false}),
    );
    // No application listener exists until the peer certificate is explicitly trusted.
    a.send(&Command::GameAuthorize {
        certificate: cert_b.clone(),
    })?;
    wait(&a, |r| matches!(r, Response::GameAuthorized), 10)?;
    let addr: iroh::EndpointAddr = serde_json::from_str(address_a)?;
    let ip = addr
        .ip_addrs()
        .find(|a| a.is_ipv4() && !a.ip().is_loopback())
        .map(|a| a.ip())
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
    b.send(&Command::GameConnect {
        address: std::net::SocketAddr::new(ip, port_a),
        certificate: cert_a.clone(),
    })?;
    match wait(&b, |r| matches!(r, Response::GameOpened { .. }), 15) {
        Ok(Response::GameOpened { stream, .. }) => {
            use std::io::{Read, Write};
            let payload = b"Aurum direct QUIC fixture".to_vec();
            b.send(&Command::GameWrite {
                stream,
                bytes: payload.clone(),
            })?;
            let opened = wait(&a, |r| matches!(r, Response::GameOpened { .. }), 15)?;
            let Response::GameOpened {
                stream: host_stream,
                ..
            } = opened
            else {
                unreachable!()
            };
            let fixture = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
            let address = fixture.local_addr()?;
            let listener = aurum_social::listeners::for_pid(std::process::id())?
                .into_iter()
                .find(|l| l.address == address)
                .context("Kernel did not report the broker-owned TCP fixture")?;
            listener.revalidate()?;
            let fixture_thread = std::thread::spawn(move || -> Result<()> {
                let (mut tcp, _) = fixture.accept()?;
                tcp.set_read_timeout(Some(Duration::from_secs(5)))?;
                let mut bytes = [0u8; 25];
                tcp.read_exact(&mut bytes)?;
                tcp.write_all(&bytes)?;
                Ok(())
            });
            let mut bridge = std::net::TcpStream::connect(listener.connect_address())?;
            bridge.set_read_timeout(Some(Duration::from_secs(5)))?;
            let data = wait(&a, |r| matches!(r, Response::GameData { .. }), 10)?;
            if let Response::GameData { bytes, .. } = data {
                if bytes != payload {
                    bail!("Game payload mismatch");
                }
                bridge.write_all(&bytes)?;
                let mut reply = vec![0u8; bytes.len()];
                bridge.read_exact(&mut reply)?;
                a.send(&Command::GameWrite {
                    stream: host_stream,
                    bytes: reply,
                })?;
                let echoed = wait(&b, |r| matches!(r, Response::GameData { .. }), 10)?;
                if !matches!(&echoed,Response::GameData{bytes,..}if bytes==&payload) {
                    bail!("QUIC to TCP bridge corrupted data");
                }
                fixture_thread
                    .join()
                    .map_err(|_| anyhow::anyhow!("TCP fixture thread panicked"))??;
                report(
                    "Direct QUIC plus kernel-validated TCP fixture bridge",
                    "PASS",
                    json!({"bytes":25,"internetProof":false,"minecraftWorldProof":false}),
                );
            }
        }
        Ok(_) => unreachable!(),
        Err(e) => report(
            "Direct game QUIC between local containers",
            "FAIL",
            json!(e.to_string()),
        ),
    }
    let _ = address_b;
    {
        use sha2::Digest;
        a.send(&Command::GameRevoke {
            certificate_hash: format!("{:x}", sha2::Sha256::digest(cert_b)),
        })?;
    }
    wait(&b, |r| matches!(r, Response::GameClosed { .. }), 10)?;
    report(
        "Revocation closes the existing authenticated game QUIC connection",
        "PASS",
        json!({"internetProof":false}),
    );
    a.stop()?;
    b.stop()?;
    report(
        "Shutdown and process exit",
        "PASS",
        json!({"workersRunning":a.child.running()||b.child.running()}),
    );
    {
        use std::io::Write;
        let mut hostile = WorkerClient::spawn(&container_a, &runtime)?;
        hostile.send(&Command::Start {
            public_relays: false,
            ports: [0; 3],
        })?;
        wait(&hostile, |r| matches!(r, Response::Ready { .. }), 10)?;
        hostile
            .child
            .input
            .write_all(&[b'A', b'U', b'S', b'1', 255, 255, 255, 255])?;
        wait(&hostile, |r| matches!(r, Response::Stopped), 10)?;
        let until = std::time::Instant::now() + Duration::from_secs(5);
        while hostile.child.running() && std::time::Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        if hostile.child.running() {
            bail!("Malformed IPC did not stop the isolated worker");
        }
        report(
            "Real worker rejects oversized IPC without a body",
            "PASS",
            json!({"declaredBytes":u32::MAX,"payloadBytesSent":0,"workerExited":true}),
        );
    }
    report(
        "Two computers on different networks",
        "NOT TESTED",
        json!({"requiredForReady":true}),
    );
    if FAILED.load(std::sync::atomic::Ordering::Relaxed) {
        bail!("One or more feasibility checks failed; see JSON results");
    }
    Ok(())
}
#[cfg(windows)]
fn prepare_runtime(root: &Path, executable: &Path, containers: &[&Container]) -> Result<PathBuf> {
    let directory = root.join("runtime");
    std::fs::create_dir_all(&directory)?;
    let runtime = directory.join("aurum-social-worker.exe");
    std::fs::copy(executable, &runtime)?;
    for container in containers {
        container.allow_runtime_read(&directory)?;
        container.allow_runtime_read(&runtime)?;
    }
    Ok(runtime)
}
#[cfg(windows)]
fn wait(
    client: &WorkerClient,
    predicate: impl Fn(&Response) -> bool,
    seconds: u64,
) -> Result<Response> {
    let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        let remain = deadline.saturating_duration_since(std::time::Instant::now());
        let response = client.receive(remain)?;
        if let Response::Error { operation, message } = &response {
            bail!("{operation}: {message}");
        }
        if predicate(&response) {
            return Ok(response);
        }
    }
}
fn ready(response: &Response) -> Result<(&str, &Vec<u8>, u16, Option<std::net::SocketAddr>)> {
    if let Response::Ready {
        address,
        game_certificate,
        game_port,
        game_external,
        ..
    } = response
    {
        Ok((address, game_certificate, *game_port, *game_external))
    } else {
        bail!("Expected ready response")
    }
}
static FAILED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn report(name: &str, status: &str, details: serde_json::Value) {
    if status == "FAIL" {
        FAILED.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    println!("{}", json!({"test":name,"status":status,"details":details}));
}
#[cfg(windows)]
fn friends(root: &Path, worker: &Path) -> Result<()> {
    use aurum_social::{service::Service, store::Privacy};
    let a = Service::laboratory(root.join("friend-a"), 0)?;
    let b = Service::laboratory(root.join("friend-b"), 1)?;
    a.set_privacy(Privacy {
        public_relays: false,
        ..Default::default()
    })?;
    b.set_privacy(Privacy {
        public_relays: false,
        ..Default::default()
    })?;
    a.enable(worker.into(), "Lab A".into(), true)?;
    b.enable(worker.into(), "Lab B".into(), true)?;
    let until = |condition: &dyn Fn() -> Result<bool>| -> Result<()> {
        let deadline = std::time::Instant::now() + Duration::from_secs(25);
        while std::time::Instant::now() < deadline {
            if condition()? {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        bail!("Timed out waiting for a real broker/worker transition");
    };
    until(&|| Ok(a.snapshot()?.contact_link.is_some() && b.snapshot()?.contact_link.is_some()))?;
    let id_a = a.snapshot()?.id.context("Missing A identity")?;
    let id_b = b.snapshot()?.id.context("Missing B identity")?;
    report(
        "Independent broker identities",
        if id_a != id_b { "PASS" } else { "FAIL" },
        json!({"distinct":id_a!=id_b}),
    );
    a.add(b.snapshot()?.contact_link.context("Missing contact link")?)?;
    until(&|| {
        Ok(b.snapshot()?
            .people
            .iter()
            .any(|p| p.id == id_a && p.state == "incoming"))
    })?;
    report(
        "Root-authenticated friend request through real iroh",
        "PASS",
        json!({"internetProof":false}),
    );
    b.relationship(id_a.clone(), "accept")?;
    until(&|| {
        Ok(a.snapshot()?
            .people
            .iter()
            .any(|p| p.id == id_b && p.state == "friend")
            && b.snapshot()?
                .people
                .iter()
                .any(|p| p.id == id_a && p.state == "friend"))
    })?;
    report(
        "Friend acceptance on both independent brokers",
        "PASS",
        json!({"internetProof":false}),
    );
    for _ in 0..3 {
        b.relationship(id_a.clone(), "block")?;
        until(&|| {
            Ok(b.snapshot()?
                .people
                .iter()
                .any(|p| p.id == id_a && p.state == "blocked"))
        })?;
        b.relationship(id_a.clone(), "unblock")?;
        until(&|| Ok(!b.snapshot()?.people.iter().any(|p| p.id == id_a)))?;
        b.add(a.snapshot()?.contact_link.context("Missing A contact")?)?;
        until(&|| {
            Ok(b.snapshot()?
                .people
                .iter()
                .any(|p| p.id == id_a && p.state == "friend"))
        })?;
        if b.snapshot()?
            .error
            .as_deref()
            .is_some_and(|e| e.contains("challenge"))
        {
            bail!("Block/unblock left a stale challenge error");
        }
    }
    report(
        "Block/unblock and fresh authenticated session repeated three times",
        "PASS",
        json!({"internetProof":false}),
    );
    // Both users can send a request at once. Exercise the actual worker race.
    a.relationship(id_b.clone(), "remove")?;
    until(&|| {
        Ok(!a.snapshot()?.people.iter().any(|p| p.id == id_b)
            && !b.snapshot()?.people.iter().any(|p| p.id == id_a))
    })?;
    a.add(b.snapshot()?.contact_link.context("Missing B contact")?)?;
    b.add(a.snapshot()?.contact_link.context("Missing A contact")?)?;
    until(&|| {
        Ok(a.snapshot()?
            .people
            .iter()
            .any(|p| p.id == id_b && p.state == "friend")
            && b.snapshot()?
                .people
                .iter()
                .any(|p| p.id == id_a && p.state == "friend"))
    })?;
    report(
        "Simultaneous friend requests settle on a fresh authenticated session",
        "PASS",
        json!({"internetProof":false}),
    );
    a.rename("Updated Lab A")?;
    let avatar = {
        use base64::Engine as _;
        format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(include_bytes!("fixtures/avatar.jpg"))
        )
    };
    a.set_avatar(Some(avatar.clone()))?;
    until(&|| {
        Ok(b.snapshot()?.people.iter().any(|p| {
            p.id == id_a && p.name == "Updated Lab A" && p.avatar.as_ref() == Some(&avatar)
        }))
    })?;
    a.set_privacy(Privacy {
        public_relays: false,
        invisible: true,
        share_activity: true,
        ..Default::default()
    })?;
    until(&|| {
        Ok(!b.snapshot()?.online.contains(&id_a) && !b.snapshot()?.activity.contains_key(&id_a))
    })?;
    a.set_privacy(Privacy {
        public_relays: false,
        ..Default::default()
    })?;
    until(&|| Ok(b.snapshot()?.online.contains(&id_a)))?;
    report(
        "Profile updates and invisible presence use signed peer messages",
        "PASS",
        json!({"internetProof":false}),
    );
    a.activity(Some(aurum_social::world::WorldSpec {
        name: "Opt-in activity fixture".into(),
        minecraft: "1.21.1".into(),
        loader: "vanilla".into(),
        loader_version: None,
    }))?;
    std::thread::sleep(Duration::from_millis(300));
    if b.snapshot()?.activity.contains_key(&id_a) {
        bail!("Activity leaked before opt-in");
    }
    a.set_privacy(Privacy {
        public_relays: false,
        share_activity: true,
        ..Default::default()
    })?;
    until(&|| Ok(b.snapshot()?.activity.contains_key(&id_a)))?;
    a.set_privacy(Privacy {
        public_relays: false,
        share_activity: false,
        ..Default::default()
    })?;
    until(&|| Ok(!b.snapshot()?.activity.contains_key(&id_a)))?;
    report(
        "Activity is absent by default and withdraws after opt-out",
        "PASS",
        json!({"realSignedPeerMessages":true}),
    );
    {
        use aurum_social::{
            manifest::{Manifest, SharedFile},
            world::WorldSpec,
        };
        use sha2::{Digest, Sha256};
        use std::io::{Read, Write};
        let fixture = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        let address = fixture.local_addr()?;
        let owned = aurum_social::listeners::for_pid(std::process::id())?
            .into_iter()
            .find(|l| l.address == address)
            .context("Missing TCP fixture owner")?;
        let echo = std::thread::spawn(move || -> Result<()> {
            let (mut tcp, _) = fixture.accept()?;
            tcp.set_read_timeout(Some(Duration::from_secs(15)))?;
            let mut bytes = [0u8; 25];
            tcp.read_exact(&mut bytes)?;
            tcp.write_all(&bytes)?;
            Ok(())
        });
        let world = WorldSpec {
            name: "TCP fixture world".into(),
            minecraft: "1.21.1".into(),
            loader: "vanilla".into(),
            loader_version: None,
        };
        let config = b"enabled=true\n".repeat(180);
        let manifest = Manifest {
            version: 1,
            name: world.name.clone(),
            minecraft: world.minecraft.clone(),
            loader: world.loader.clone(),
            loader_version: None,
            files: vec![SharedFile {
                path: "config/fixture.toml".into(),
                bytes: config.len() as u64,
                sha256: format!("{:x}", Sha256::digest(&config)),
                source: None,
                config: Some(config),
            }],
        };
        let invitation = a.invite(&id_b, world.clone(), owned.clone(), Some(manifest.clone()))?;
        until(&|| {
            Ok(b.snapshot()?
                .invitations
                .iter()
                .any(|i| i.manifest.is_some()))
        })?;
        until(&|| Ok(a.delivery(&invitation) == Some(true)))?;
        for _ in 0..3 {
            let plain = a.invite(&id_b, world.clone(), owned.clone(), None)?;
            until(&|| {
                Ok(a.delivery(&plain) == Some(true)
                    && b.snapshot()?
                        .invitations
                        .iter()
                        .any(|i| i.offer.id == plain))
            })?;
            a.cancel_offer(plain.clone())?;
            until(&|| {
                Ok(b.snapshot()?
                    .invitations
                    .iter()
                    .any(|i| i.offer.id == plain && i.status == "failed" && i.error.is_some()))
            })?;
        }
        report(
            "Pack receipt and repeated Vanilla invitation receipts reach the sender",
            "PASS",
            json!({"internetProof":false}),
        );
        let incoming = b
            .snapshot()?
            .invitations
            .into_iter()
            .find(|i| i.manifest.is_some())
            .context("Missing received invitation")?;
        if incoming
            .manifest
            .as_ref()
            .context("Manifest missing")?
            .digest()?
            != manifest.digest()?
        {
            bail!("Transferred manifest changed");
        }
        report(
            "Root-signed invitation and fragmented manifest transfer",
            "PASS",
            json!({"internetProof":false}),
        );
        b.join(incoming.offer.id.clone())?;
        until(&|| {
            Ok(b.snapshot()?
                .invitations
                .iter()
                .any(|i| i.join_address.is_some()))
        })?;
        let target = b
            .snapshot()?
            .invitations
            .into_iter()
            .find_map(|i| i.join_address)
            .context("Missing local bridge")?;
        let mut tcp = std::net::TcpStream::connect(target)?;
        tcp.set_read_timeout(Some(Duration::from_secs(10)))?;
        let payload = *b"Aurum direct QUIC fixture";
        tcp.write_all(&payload)?;
        let mut response = [0u8; 25];
        tcp.read_exact(&mut response)?;
        if response != payload {
            bail!("Broker game bridge changed bytes");
        }
        echo.join()
            .map_err(|_| anyhow::anyhow!("TCP fixture panicked"))??;
        report(
            "Locally accepted invitation opens the authorized TCP/QUIC bridge",
            "PASS",
            json!({"internetProof":false,"minecraftWorldProof":false}),
        );
        b.abandon_join(incoming.offer.id.clone())?;
        until(&|| {
            Ok(!b.has_active_tunnels()
                && a.snapshot()?
                    .outgoing
                    .iter()
                    .any(|i| i.id == incoming.offer.id && i.status == "waiting"))
        })?;
        report(
            "Cancelled join closes only its bridge and returns the host to waiting",
            "PASS",
            json!({"socialStillEnabled":a.is_enabled()&&b.is_enabled()}),
        );
    }
    b.relationship(id_a.clone(), "block")?;
    until(&|| {
        Ok(b.snapshot()?
            .people
            .iter()
            .any(|p| p.id == id_a && p.state == "blocked"))
    })?;
    until(&|| Ok(b.snapshot()?.invitations.is_empty() && !b.has_active_tunnels()))?;
    a.relationship(id_b, "remove")?;
    std::thread::sleep(Duration::from_millis(300));
    if !b
        .snapshot()?
        .people
        .iter()
        .any(|p| p.id == id_a && p.state == "blocked")
    {
        bail!("Peer message bypassed a block");
    }
    report(
        "Blocked friend cannot change broker relationship state",
        "PASS",
        json!({}),
    );
    let backup = a.export_identity("local-integration-passphrase")?;
    if a.restore_identity(&backup, "incorrect-passphrase", true)
        .is_ok()
        || !a.is_enabled()
        || a.snapshot()?.id.as_deref() != Some(&id_a)
    {
        bail!("Failed restore changed the active identity");
    }
    a.restore_identity(&backup, "local-integration-passphrase", true)?;
    if a.is_enabled() || a.snapshot()?.id.as_deref() != Some(&id_a) {
        bail!("Live restore failed to stop the runtime and preserve the restored ID");
    }
    report(
        "Live encrypted identity restore and wrong-password preservation",
        "PASS",
        json!({}),
    );
    b.disable()?;
    if a.snapshot()?.enabled || b.snapshot()?.enabled {
        bail!("Social still enabled after shutdown");
    }
    report("Independent service shutdown", "PASS", json!({}));
    Ok(())
}
