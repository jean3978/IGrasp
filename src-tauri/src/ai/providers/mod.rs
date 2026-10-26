//! Provider implementations. Private to `ai`: only the gateway constructs them (the test-only
//! mock is visible to the crate's tests).

pub(super) mod claude_cli;
#[cfg(test)]
pub(crate) mod mock;
