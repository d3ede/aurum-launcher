#[derive(Default)]
pub struct CloseConfirmation(std::sync::atomic::AtomicBool);

impl CloseConfirmation {
    pub fn approve(&self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn take(&self) -> bool {
        self.0.swap(false, std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::CloseConfirmation;

    #[test]
    fn approval_is_consumed_by_exactly_one_close_request() {
        let confirmation = CloseConfirmation::default();
        assert!(!confirmation.take());
        confirmation.approve();
        assert!(confirmation.take());
        assert!(!confirmation.take());
    }
}
