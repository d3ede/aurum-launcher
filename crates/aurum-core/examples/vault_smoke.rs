use anyhow::Result;
fn main() -> Result<()> {
    let id = format!("test-{}", uuid::Uuid::new_v4());
    let value = "aurum-ephemeral-vault-test";
    aurum_core::auth::set_secret(&id, value)?;
    let read = aurum_core::auth::secret(&id);
    aurum_core::auth::delete_secret(&id)?;
    assert_eq!(read?, value);
    assert!(aurum_core::auth::secret(&id).is_err());
    println!("PASS: Windows credential vault write/read/delete; test entry removed");
    Ok(())
}
