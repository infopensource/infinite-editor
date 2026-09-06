//! Bounded native workers. Dropped receivers skip queued obsolete work.
#[cfg(not(target_arch = "wasm32"))]
use futures_channel::oneshot;

pub(super) async fn run<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::sync::{mpsc, Arc, Mutex, OnceLock};
        type Job = Box<dyn FnOnce() + Send>;
        static QUEUE: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
        let queue = QUEUE.get_or_init(|| {
            let (sender, receiver) = mpsc::channel::<Job>();
            let receiver = Arc::new(Mutex::new(receiver));
            for index in 0..2 {
                let receiver = receiver.clone();
                std::thread::Builder::new()
                    .name(format!("document-worker-{index}"))
                    .spawn(move || loop {
                        let job = receiver.lock().unwrap().recv();
                        let Ok(job) = job else { break };
                        job();
                    })
                    .expect("start document worker");
            }
            sender
        });
        let (sender, receiver) = oneshot::channel();
        queue
            .send(Box::new(move || {
                if sender.is_canceled() {
                    return;
                }
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
                    .map_err(|_| "后台文档处理失败".to_string());
                let _ = sender.send(result);
            }))
            .map_err(|_| "后台文档队列已关闭".to_string())?;
        receiver
            .await
            .map_err(|_| "后台文档任务已结束".to_string())?
    }
    #[cfg(target_arch = "wasm32")]
    {
        Ok(work())
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use std::{
        future::Future,
        sync::Arc,
        task::{Context, Poll, Wake, Waker},
    };

    struct TestWake(std::thread::Thread);
    impl Wake for TestWake {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }

    #[test]
    fn native_work_does_not_block_the_callers_first_poll() {
        let caller = std::thread::current().id();
        let (release, wait) = std::sync::mpsc::channel();
        let mut future = Box::pin(run(move || {
            wait.recv().unwrap();
            std::thread::current().id()
        }));
        let waker = Waker::from(Arc::new(TestWake(std::thread::current())));
        let mut context = Context::from_waker(&waker);
        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
        release.send(()).unwrap();
        loop {
            match future.as_mut().poll(&mut context) {
                Poll::Ready(result) => {
                    assert_ne!(result.unwrap(), caller);
                    break;
                }
                Poll::Pending => std::thread::park(),
            }
        }
    }
}
