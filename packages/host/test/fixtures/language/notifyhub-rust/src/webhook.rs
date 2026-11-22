use crate::hub::{Channel, DeliveryError, Message};

pub struct Webhook {
    endpoint: String,
    attempts: usize,
}

impl Webhook {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            attempts: 0,
        }
    }
}

impl Channel for Webhook {
    fn name(&self) -> &str {
        "webhook"
    }

    fn send(&mut self, message: &Message) -> Result<(), DeliveryError> {
        self.attempts += 1;
        if !self.endpoint.starts_with("https://") {
            return Err(DeliveryError::new(format!(
                "webhook: {} is not https",
                self.endpoint
            )));
        }
        if message.body.is_empty() {
            return Err(DeliveryError::new("webhook: empty body"));
        }
        Ok(())
    }
}
