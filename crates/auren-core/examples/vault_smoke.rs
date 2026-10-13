use anyhow::Result;
fn main() -> Result<()> {
    let id = format!("test-{}", uuid::Uuid::new_v4());
    let value = "auren-ephemeral-vault-test";
    auren_core::auth::set_secret(&id, value)?;
    let read = auren_core::auth::secret(&id);
    auren_core::auth::delete_secret(&id)?;
    assert_eq!(read?, value);
    assert!(auren_core::auth::secret(&id).is_err());
    println!("PASS: Windows credential vault write/read/delete; test entry removed");
    Ok(())
}
