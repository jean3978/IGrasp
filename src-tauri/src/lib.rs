//! IGrasp backend: Tauri setup, commands and background services.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running IGrasp");
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_version_is_semver() {
        let parts: Vec<&str> = env!("CARGO_PKG_VERSION").split('.').collect();
        assert_eq!(parts.len(), 3);
    }
}
