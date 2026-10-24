//! Shared application state managed by Tauri.

use crate::appdata::AppData;

pub struct AppState {
    pub appdata: AppData,
}

impl AppState {
    pub fn new(appdata: AppData) -> Self {
        Self { appdata }
    }
}
