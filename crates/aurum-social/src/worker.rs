//! Broker-side ownership of an isolated worker. Drop always terminates its Job.
use crate::{
    sandbox::{Container, Worker},
    wire::{self, Command, Response},
};
use anyhow::{bail, Context, Result};
use std::{
    path::Path,
    sync::mpsc::{self, Receiver},
    time::Duration,
};

pub struct WorkerClient {
    pub child: Worker,
    events: Receiver<Result<Response, String>>,
}
impl WorkerClient {
    pub fn spawn(container: &Container, executable: &Path) -> Result<Self> {
        let child = container.spawn(executable)?;
        let mut reader = child.output.try_clone()?;
        let (tx, events) = mpsc::sync_channel(32);
        std::thread::spawn(move || loop {
            let result = wire::read(&mut reader).map_err(|e| e.to_string());
            let failed = result.is_err();
            if tx.send(result).is_err() || failed {
                break;
            }
        });
        Ok(Self { child, events })
    }
    pub fn send(&mut self, command: &Command) -> Result<()> {
        if !self.child.running() {
            bail!(
                "Social worker has stopped (exit 0x{:08x})",
                self.child.exit_code()
            );
        }
        wire::write(&mut self.child.input, command)
    }
    pub fn receive(&self, timeout: Duration) -> Result<Response> {
        self.events
            .recv_timeout(timeout)
            .context("Social worker response timed out")?
            .map_err(anyhow::Error::msg)
    }
    pub fn poll(&self) -> Option<Result<Response>> {
        match self.events.try_recv() {
            Ok(r) => Some(r.map_err(anyhow::Error::msg)),
            Err(_) => None,
        }
    }
    pub fn stop(&mut self) -> Result<()> {
        let _ = self.send(&Command::Stop);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if !self.child.running() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        self.child.stop();
        if self.child.running() {
            bail!("Social worker did not terminate");
        }
        Ok(())
    }
}
