#[tokio::main]
async fn main() {
    #[cfg(windows)]
    {
        let args: Vec<_> = std::env::args().collect();
        let root = args
            .iter()
            .position(|a| a == "--data")
            .and_then(|i| args.get(i + 1))
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(".test-data/social-core-lab"));
        if let Err(error) = aurum_core::social::lab::run(root).await {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("The Social integration lab requires Windows");
        std::process::exit(1);
    }
}
