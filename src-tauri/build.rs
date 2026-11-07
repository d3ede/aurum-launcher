fn main() {
    // Recompile Windows resources when generated application icons change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=social-runtime/manifest.json");
    tauri_build::build()
}
