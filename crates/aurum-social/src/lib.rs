//! Security boundary shared by the launcher broker and its isolated network worker.
//! Constructing or reading local state never starts networking.
pub mod discovery;
#[cfg(windows)]
pub mod firewall;
pub mod identity;
#[cfg(windows)]
pub mod listeners;
pub mod manifest;
#[cfg(windows)]
pub mod sandbox;
#[cfg(windows)]
pub mod service;
pub mod store;
pub mod wire;
#[cfg(windows)]
pub mod worker;
pub mod world;
