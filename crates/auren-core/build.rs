use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=AURUM_API_URL");
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    let mut origin = String::new();
    for name in [".env.example", ".env"] {
        let path = root.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        if !path.exists() {
            continue;
        }
        for entry in dotenvy::from_path_iter(&path).expect("Cannot read API environment file") {
            let (key, value) = entry.expect("Invalid API environment file");
            if key == "AURUM_API_URL" {
                origin = value;
            }
        }
    }
    if let Ok(value) = env::var("AURUM_API_URL") {
        origin = value;
    }
    assert!(
        !origin.contains(['\r', '\n']),
        "AURUM_API_URL must be a single line"
    );
    // Embed only this public origin, never other values from an environment file.
    println!("cargo:rustc-env=AURUM_API_URL={origin}");
}
