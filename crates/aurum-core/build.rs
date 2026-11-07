use std::{env, path::PathBuf};

fn main() {
    build_lan_agent();
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

fn build_lan_agent() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    println!("cargo:rerun-if-changed=java");
    println!("cargo:rerun-if-env-changed=AURUM_JAVAC");
    println!("cargo:rerun-if-env-changed=JAVA_HOME");
    let javac = env::var_os("AURUM_JAVAC")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("JAVA_HOME")
                .map(|home| PathBuf::from(home).join("bin/javac.exe"))
                .filter(|p| p.is_file())
        })
        .unwrap_or_else(|| "javac".into());
    let jar = javac
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join("jar.exe"))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| "jar".into());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let classes = out.join("lan-classes");
    std::fs::create_dir_all(&classes).expect("Create LAN agent output");
    let compiled = std::process::Command::new(javac)
        .args(["--release", "8", "-encoding", "UTF-8", "-d"])
        .arg(&classes)
        .arg("java/app/aurum/social/LanJoinAgent.java")
        .status()
        .expect("Building Aurum requires a JDK (javac), not a JRE");
    assert!(compiled.success(), "LAN agent compilation failed");
    let packaged = std::process::Command::new(jar)
        .arg("cfm")
        .arg(out.join("aurum-lan-join.jar"))
        .arg("java/MANIFEST.MF")
        .arg("-C")
        .arg(classes)
        .arg(".")
        .status()
        .expect("Run JDK jar tool");
    assert!(packaged.success(), "LAN agent packaging failed");
}
