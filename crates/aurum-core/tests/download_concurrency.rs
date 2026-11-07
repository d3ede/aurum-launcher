use aurum_core::{Engine, Task};
use sha1::{Digest, Sha1};
use std::{
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn repeated_asset_downloads_in_one_task_do_not_share_a_partial_file() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.test-data/download-concurrency");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let mut engine = Engine::new(dir.path().join("data"), |_| {}).await.unwrap();
    // Only this owned loopback fixture uses HTTP; production remains HTTPS-only.
    engine.http = reqwest::Client::builder().no_proxy().build().unwrap();
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        profile_id: None,
        cancel: Arc::new(AtomicBool::new(false)),
        emit: Arc::new(|_| {}),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/asset", listener.local_addr().unwrap());
    let payload = b"same Minecraft asset under two different logical names";
    let checksum = format!("{:x}", Sha1::digest(payload));
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let server = tokio::spawn(async move {
        let mut handlers = vec![];
        for i in 0..2 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let barrier = barrier.clone();
            handlers.push(tokio::spawn(async move {
                let mut request = Vec::new();
                loop {
                    request.push(socket.read_u8().await.unwrap());
                    if request.ends_with(b"\r\n\r\n") {
                        break;
                    }
                    assert!(request.len() < 8192);
                }
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            payload.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                barrier.wait().await;
                // Both responses have headers, so both callers open their partial files.
                tokio::time::sleep(Duration::from_millis(150 + i * 150)).await;
                socket.write_all(payload).await.unwrap();
            }));
        }
        for handler in handlers {
            handler.await.unwrap();
        }
    });
    let destination = engine.root.join("assets/shared-object");
    let (first, second) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(
            engine.download(&url, &destination, Some(("sha1", &checksum)), &task),
            engine.download(&url, &destination, Some(("sha1", &checksum)), &task)
        )
    })
    .await
    .unwrap();
    assert!(first.is_ok(), "First concurrent download: {first:?}");
    assert!(second.is_ok(), "Second concurrent download: {second:?}");
    server.await.unwrap();
    assert_eq!(tokio::fs::read(&destination).await.unwrap(), payload);
    assert_eq!(
        std::fs::read_dir(destination.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
}
