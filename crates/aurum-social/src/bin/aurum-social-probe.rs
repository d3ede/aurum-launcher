#![cfg_attr(windows, windows_subsystem = "windows")]
fn main() {
    #[cfg(windows)]
    println!("{:?}", aurum_social::sandbox::current_isolation());
}
