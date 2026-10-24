//! IGrasp backend: Tauri setup, commands and background services.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running IGrasp");
}
