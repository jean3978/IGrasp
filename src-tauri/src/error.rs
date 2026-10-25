//! Application error type, serialized to the frontend as `{ code, message }`.

use serde::{Serialize, Serializer};
use ts_rs::TS;

/// Machine-readable error code sent to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum ErrorCode {
    NoRootOpen,
    OutsideRoot,
    NotFound,
    InvalidPath,
    TooLarge,
    IndexNotReady,
    Io,
    AppData,
    NotText,
    Forbidden,
    InvalidPattern,
    Ai,
    SaveCancelled,
    NotAQuizFile,
}

/// Shape of every error returned by a command.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No folder is open.")]
    NoRootOpen,
    #[error("The path is outside the opened folder: {0}")]
    OutsideRoot(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("The file is too large to open ({size} bytes).")]
    TooLarge { size: u64 },
    #[error("The folder is still being indexed.")]
    IndexNotReady,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("App data error: {0}")]
    AppData(String),
    #[error("{0} is not a text file.")]
    NotText(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    InvalidPattern(String),
    #[error("{0}")]
    Ai(String),
    #[error("The save was cancelled.")]
    SaveCancelled,
    #[error("Not a quiz file: {0}")]
    NotAQuizFile(String),
}

impl AppError {
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::NoRootOpen => ErrorCode::NoRootOpen,
            Self::OutsideRoot(_) => ErrorCode::OutsideRoot,
            Self::NotFound(_) => ErrorCode::NotFound,
            Self::InvalidPath(_) => ErrorCode::InvalidPath,
            Self::TooLarge { .. } => ErrorCode::TooLarge,
            Self::IndexNotReady => ErrorCode::IndexNotReady,
            Self::Io(_) => ErrorCode::Io,
            Self::AppData(_) => ErrorCode::AppData,
            Self::NotText(_) => ErrorCode::NotText,
            Self::Forbidden(_) => ErrorCode::Forbidden,
            Self::InvalidPattern(_) => ErrorCode::InvalidPattern,
            Self::Ai(_) => ErrorCode::Ai,
            Self::SaveCancelled => ErrorCode::SaveCancelled,
            Self::NotAQuizFile(_) => ErrorCode::NotAQuizFile,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        IpcError {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_message() {
        let json = serde_json::to_value(AppError::NotFound("a.md".into())).unwrap();
        assert_eq!(json["code"], "NotFound");
        assert_eq!(json["message"], "Not found: a.md");
    }
}
