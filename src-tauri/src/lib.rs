//! IGrasp backend: Tauri setup, commands and background services.

mod appdata;
mod commands;
mod error;
mod paths;
mod state;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use crate::appdata::AppData;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log = tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some("igrasp".into()),
            }),
        ])
        .level(log::LevelFilter::Info)
        .max_file_size(2_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(3))
        .build();

    tauri::Builder::default()
        .plugin(log)
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(AppState::new(AppData::new(dir)));

            // The window starts hidden and the frontend shows it once the theme is applied.
            // If the frontend fails to start, show it anyway so the app is never invisible.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(window) = handle.get_webview_window("main")
                    && !window.is_visible().unwrap_or(true)
                {
                    log::warn!("frontend did not show the window; showing it");
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::appdata::get_settings,
            commands::appdata::update_settings,
            commands::appdata::get_recent_folders,
            commands::appdata::remove_recent_folder,
            commands::appdata::clear_recent_folders,
            commands::appdata::get_session,
            commands::appdata::save_session,
            commands::appdata::get_app_info,
            commands::workspace::open_root,
            commands::workspace::close_root,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IGrasp");
}
