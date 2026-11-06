//! Interactive two-PC test node. Uses the production broker and fixed scoped ports.
use super::*;
use aurum_social::{listeners, service::Service, world::WorldSpec};
use std::io::{BufRead, Read, Write};

pub fn run(root: &Path, executable: &Path) -> Result<()> {
    let container = Container::open("Aurum.Social.Client.v1")?;
    let worker = prepare_runtime(root, executable, &[&container])?;
    let helper = executable.with_file_name("aurum-social-firewall.exe");
    std::fs::copy(helper, worker.with_file_name("aurum-social-firewall.exe"))?;
    let service = Service::new(root.join("node"));
    // An echo fixture, not Minecraft. Its TCP target is owned by this exact PID.
    let fixture = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    fixture.set_nonblocking(true)?;
    let address = fixture.local_addr()?;
    let listener = listeners::for_pid(std::process::id())?
        .into_iter()
        .find(|l| l.address == address)
        .context("Missing kernel-owned fixture")?;
    let stopping = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = stopping.clone();
    let echo = std::thread::spawn(move || {
        while !flag.load(std::sync::atomic::Ordering::Acquire) {
            match fixture.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                    let mut bytes = [0; 64];
                    if let Ok(n) = stream.read(&mut bytes) {
                        let _ = stream.write_all(&bytes[..n]);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(_) => break,
            }
        }
    });
    println!("NOT READY. Interactive real two-PC test node; echo fixture is not Minecraft.");
    println!("Commands: firewall | on | status | id | contact | add <ID/link> | accept <ID> | block <ID> | invite <ID> | join <invitation> | probe <invitation> | off | quit");
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        let (command, value) = line.trim().split_once(' ').unwrap_or((line.trim(), ""));
        let result: Result<()> = (|| {
            match command {
                "firewall" => aurum_social::firewall::request_configuration(&worker)?,
                "on" => service.enable(worker.clone(), "Two-PC test node".into(), true)?,
                "status" => println!("{}", serde_json::to_string_pretty(&service.snapshot()?)?),
                "id" => println!(
                    "{}",
                    service.snapshot()?.id.context("Enable this node first")?
                ),
                "contact" => println!(
                    "{}",
                    service
                        .snapshot()?
                        .contact_link
                        .context("Wait for initialization; contact expires after five minutes")?
                ),
                "add" => service.add(value.into())?,
                "accept" | "block" => service.relationship(value.into(), command)?,
                "invite" => {
                    service.invite(
                        value,
                        WorldSpec {
                            name: "Direct QUIC echo fixture".into(),
                            minecraft: "1.21.1".into(),
                            loader: "vanilla".into(),
                            loader_version: None,
                        },
                        listener.clone(),
                        None,
                    )?;
                }
                "join" => service.join(value.into())?,
                "probe" => {
                    let state = service.snapshot()?;
                    let invite = state
                        .invitations
                        .iter()
                        .find(|i| i.offer.id == value)
                        .context("Unknown invitation")?;
                    let address = invite
                        .join_address
                        .as_ref()
                        .context("Connection is not ready; inspect status")?
                        .parse::<std::net::SocketAddr>()?;
                    if !address.ip().is_loopback() {
                        bail!("Guest bridge must be loopback-only");
                    }
                    let mut tcp =
                        std::net::TcpStream::connect_timeout(&address, Duration::from_secs(5))?;
                    tcp.set_read_timeout(Some(Duration::from_secs(10)))?;
                    tcp.set_write_timeout(Some(Duration::from_secs(10)))?;
                    let payload = aurum_social::identity::random::<32>()?;
                    tcp.write_all(&payload)?;
                    let mut reply = [0; 32];
                    tcp.read_exact(&mut reply)?;
                    if reply != payload {
                        bail!("Direct fixture payload changed");
                    }
                    report(
                        "Real end-to-end TCP/direct QUIC echo",
                        "PASS",
                        json!({"bytes":32,"minecraftWorldProof":false,"differentNetworksMustBeConfirmedManually":true,"publicGameRelay":false}),
                    );
                }
                "off" => service.disable()?,
                "quit" => return Ok(()),
                "" => {}
                _ => bail!("Unknown command"),
            }
            Ok(())
        })();
        if let Err(error) = result {
            report(command, "FAIL", json!(error.to_string()));
        }
        if command == "quit" {
            break;
        }
    }
    let result = service.disable();
    stopping.store(true, std::sync::atomic::Ordering::Release);
    let _ = echo.join();
    result
}
