fn main() {
    // Recompile Windows resources when generated application icons change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=social-runtime/manifest.json");
    println!("cargo:rustc-check-cfg=cfg(aurum_offline_social)");
    println!("cargo:rerun-if-env-changed=RELEASE_TAG");
    // A locally rebuilt executable cannot download its exact sidecars from an
    // existing public release. Keep it self-contained even when copied alone.
    // Published builds use the pinned objects uploaded by the release workflow.
    if std::env::var_os("RELEASE_TAG").is_none_or(|tag| tag.is_empty()) {
        println!("cargo:rustc-cfg=aurum_offline_social");
        for name in ["aurum-social-worker.exe.gz", "aurum-social-firewall.exe.gz"] {
            println!("cargo:rerun-if-changed=social-runtime/{name}");
        }
    }
    tauri_build::build()
}
