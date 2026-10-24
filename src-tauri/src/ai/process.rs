//! Ties provider subprocesses to the app's lifetime: on Windows, children are put in a job
//! object that kills them when the app process ends, however it ends. On Unix the providers
//! start their children in their own process group and the gateway kills the group on exit;
//! a hard kill of the app (SIGKILL) can still leave a child until it notices its closed pipes.

use std::process::Child;

pub struct ProcessGuard {
    #[cfg(windows)]
    job: Option<win32job::Job>,
}

impl ProcessGuard {
    pub fn new() -> Self {
        #[cfg(windows)]
        {
            let job = win32job::Job::create().ok().and_then(|job| {
                let mut info = job.query_extended_limit_info().ok()?;
                info.limit_kill_on_job_close();
                job.set_extended_limit_info(&info).ok()?;
                Some(job)
            });
            if job.is_none() {
                log::warn!("cannot create a job object; AI subprocesses may outlive a crash");
            }
            Self { job }
        }
        #[cfg(not(windows))]
        {
            Self {}
        }
    }

    /// Makes `child` die with the app.
    #[allow(unused_variables)]
    pub fn adopt(&self, child: &Child) {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            use std::os::windows::io::AsRawHandle;
            if let Err(e) = job.assign_process(child.as_raw_handle() as isize) {
                log::warn!("cannot add pid {} to the job object: {e}", child.id());
            }
        }
    }
}

impl Default for ProcessGuard {
    fn default() -> Self {
        Self::new()
    }
}
