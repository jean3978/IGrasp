//! Search: "search everything" over names and headings (Ctrl+T) and full-text search in files
//! (Ctrl+Shift+F).

pub mod globs;
pub mod symbols;
pub mod text;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// The text search of a workspace: at most one runs at a time.
#[derive(Default)]
pub struct SearchRegistry {
    next_id: AtomicU32,
    current: Mutex<Option<(u32, Arc<AtomicBool>)>>,
}

impl SearchRegistry {
    /// Cancels the running search, if any, and registers a new one.
    pub fn start(&self) -> (u32, Arc<AtomicBool>) {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let flag = Arc::new(AtomicBool::new(false));
        let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, old)) = current.replace((id, flag.clone())) {
            old.store(true, Ordering::SeqCst);
        }
        (id, flag)
    }

    /// Cancels the search `id` if it is still the current one. Idempotent.
    pub fn cancel(&self, id: u32) {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((current_id, flag)) = current.as_ref()
            && *current_id == id
        {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub fn cancel_all(&self) {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, flag)) = current.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_search_cancels_the_previous_one() {
        let registry = SearchRegistry::default();
        let (first, first_flag) = registry.start();
        let (second, second_flag) = registry.start();
        assert_ne!(first, second);
        assert!(first_flag.load(Ordering::SeqCst));
        assert!(!second_flag.load(Ordering::SeqCst));
        registry.cancel(first);
        assert!(!second_flag.load(Ordering::SeqCst));
        registry.cancel(second);
        assert!(second_flag.load(Ordering::SeqCst));
        registry.cancel_all();
    }
}
