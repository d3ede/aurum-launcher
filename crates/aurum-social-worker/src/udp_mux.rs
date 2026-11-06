//! One UDP reader for QUIC and STUN, including refreshes after QUIC starts.
//! A cloned descriptor is used only for sends; no competing recv_from is allowed.
use anyhow::{bail, Context, Result};
use noq::{AsyncUdpSocket, Runtime, UdpSender};
use std::{
    io::{self, IoSliceMut},
    net::SocketAddr,
    num::NonZeroUsize,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context as TaskContext, Poll},
    time::{Duration, Instant},
};
use tokio::sync::oneshot;
type Pending = Arc<Mutex<Option<Probe>>>;
#[derive(Debug)]
struct Probe {
    target: SocketAddr,
    nonce: [u8; 12],
    reply: oneshot::Sender<SocketAddr>,
}
#[derive(Debug)]
pub struct Mux {
    inner: Box<dyn AsyncUdpSocket>,
    pending: Pending,
}
#[derive(Clone)]
pub struct Mapping {
    socket: Arc<std::net::UdpSocket>,
    pending: Pending,
    current: Arc<Mutex<Option<(SocketAddr, Instant)>>>,
}
pub fn wrap(
    socket: std::net::UdpSocket,
    initial: Option<SocketAddr>,
) -> Result<(Box<dyn AsyncUdpSocket>, Mapping)> {
    let sender = Arc::new(socket.try_clone()?);
    let pending = Arc::new(Mutex::new(None));
    let current = Arc::new(Mutex::new(initial.map(|a| (a, Instant::now()))));
    Ok((
        Box::new(Mux {
            inner: noq::TokioRuntime.wrap_udp_socket(socket)?,
            pending: pending.clone(),
        }),
        Mapping {
            socket: sender,
            pending,
            current,
        },
    ))
}
impl AsyncUdpSocket for Mux {
    fn create_sender(&self) -> Pin<Box<dyn UdpSender>> {
        self.inner.create_sender()
    }
    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.inner.local_addr()
    }
    fn max_receive_segments(&self) -> NonZeroUsize {
        self.inner.max_receive_segments()
    }
    fn may_fragment(&self) -> bool {
        self.inner.may_fragment()
    }
    fn poll_recv(
        &mut self,
        cx: &mut TaskContext<'_>,
        buffers: &mut [IoSliceMut<'_>],
        meta: &mut [noq::udp::RecvMeta],
    ) -> Poll<io::Result<usize>> {
        for _ in 0..8 {
            let count = std::task::ready!(self.inner.poll_recv(cx, buffers, meta))?;
            let mut kept = 0;
            for index in 0..count {
                if meta[index].len > buffers[index].len() {
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "UDP length exceeds buffer",
                    )));
                }
                let bytes = &buffers[index][..meta[index].len];
                let mut consumed = false;
                if let Ok(mut pending) = self.pending.lock() {
                    if let Some(probe) = pending.as_ref() {
                        if probe.target == meta[index].addr {
                            if let Ok(address) = super::transport::parse_stun(bytes, &probe.nonce) {
                                if let Some(probe) = pending.take() {
                                    let _ = probe.reply.send(address);
                                    consumed = true;
                                }
                            }
                        }
                    }
                }
                if !consumed {
                    if kept != index {
                        let len = meta[index].len;
                        if len > buffers[kept].len() {
                            return Poll::Ready(Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                "UDP destination buffer is too small",
                            )));
                        }
                        let (left, right) = buffers.split_at_mut(index);
                        left[kept][..len].copy_from_slice(&right[0][..len]);
                        meta[kept] = meta[index];
                    }
                    kept += 1;
                }
            }
            if kept > 0 {
                return Poll::Ready(Ok(kept));
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct Cleanup {
    nonce: [u8; 12],
    pending: Pending,
}
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Ok(mut p) = self.pending.lock() {
            if p.as_ref().is_some_and(|p| p.nonce == self.nonce) {
                p.take();
            }
        }
    }
}
impl Mapping {
    pub fn address(&self) -> Option<SocketAddr> {
        self.current.lock().ok().and_then(|a| {
            a.filter(|(_, at)| at.elapsed() < Duration::from_secs(60))
                .map(|(a, _)| a)
        })
    }
    pub async fn refresh(self) -> Result<SocketAddr> {
        let target = tokio::net::lookup_host(("stun.cloudflare.com", 3478))
            .await?
            .find(|a| a.is_ipv4())
            .context("No IPv4 STUN address")?;
        let nonce = aurum_social::identity::random()?;
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| anyhow::anyhow!("STUN state unavailable"))?;
            if pending.is_some() {
                bail!("A STUN refresh is already pending");
            }
            *pending = Some(Probe {
                target,
                nonce,
                reply: tx,
            });
        }
        let _cleanup = Cleanup {
            nonce,
            pending: self.pending.clone(),
        };
        let mut bytes = [0u8; 20];
        bytes[1] = 1;
        bytes[4..8].copy_from_slice(&[0x21, 0x12, 0xa4, 0x42]);
        bytes[8..].copy_from_slice(&nonce);
        self.socket.send_to(&bytes, target)?;
        let address = tokio::time::timeout(Duration::from_secs(5), rx)
            .await
            .context("STUN refresh timed out")??;
        *self
            .current
            .lock()
            .map_err(|_| anyhow::anyhow!("STUN state unavailable"))? =
            Some((address, Instant::now()));
        Ok(address)
    }
}
