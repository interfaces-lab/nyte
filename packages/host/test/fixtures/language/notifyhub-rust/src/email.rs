use crate::hub::{Channel, DeliveryError, Message};

pub struct Email {
    address: String,
    sent: Vec<String>,
}

impl Email {
    pub fn new(address: impl Into<String>) -> Self {
        Self {
            address: address.into(),
            sent: Vec::new(),
        }
    }
}

impl Channel for Email {
    fn name(&self) -> &str {
        "email"
    }

    fn send(&mut self, message: &Message) -> Result<(), DeliveryError> {
        if !self.address.contains('@') {
            return Err(DeliveryError::new(format!(
                "email: {:?} is not an address",
                self.address
            )));
        }
        self.sent.push(message.subject.clone());
        Ok(())
    }
}
