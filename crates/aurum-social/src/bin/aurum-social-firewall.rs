//! Explicit one-shot administrator tool. No network listener or arbitrary paths.
fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
#[cfg(not(windows))]
fn run() -> anyhow::Result<()> {
    anyhow::bail!("Windows Firewall requires Windows");
}
#[cfg(windows)]
fn run() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 1 {
        anyhow::bail!("Use status, install, remove, status-lab, install-lab or remove-lab");
    }
    let program = std::env::current_exe()?.with_file_name("aurum-social-worker.exe");
    match args[0].as_str() {
        "status" | "status-lab" => println!(
            "{}",
            serde_json::to_string_pretty(&aurum_social::firewall::status(
                &program,
                args[0].ends_with("-lab")
            )?)?
        ),
        "self-test-lab" => {
            let before = aurum_social::firewall::status(&program, true)?;
            if before.iter().any(|r| r.present) {
                anyhow::bail!("Remove existing lab rules before the lifecycle test");
            }
            let result = (|| -> anyhow::Result<()> {
                aurum_social::firewall::configure(&program, true, false)?;
                let statuses = aurum_social::firewall::status(&program, true)?;
                if !statuses.iter().all(|r| r.present && r.scoped) {
                    anyhow::bail!("Installed rule scope mismatch");
                }
                Ok(())
            })();
            let cleanup = aurum_social::firewall::configure(&program, true, true);
            cleanup?;
            result?;
            if aurum_social::firewall::status(&program, true)?
                .iter()
                .any(|r| r.present)
            {
                anyhow::bail!("Lab rule cleanup failed");
            }
        }
        "install" | "install-lab" | "remove" | "remove-lab" => aurum_social::firewall::configure(
            &program,
            args[0].ends_with("-lab"),
            args[0].starts_with("remove"),
        )?,
        _ => anyhow::bail!("Unsupported fixed Firewall operation"),
    }
    Ok(())
}
