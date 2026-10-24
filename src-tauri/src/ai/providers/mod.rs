//! Provider implementations. Private to `ai`: only the gateway constructs them.

pub(super) mod claude_cli;
#[cfg(test)]
pub(super) mod mock;
