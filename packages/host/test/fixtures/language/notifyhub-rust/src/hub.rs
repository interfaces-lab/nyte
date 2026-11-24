use std::collections::HashMap;
use std::fmt;

use crate::stats::Stats;

pub struct Message {
    pub channel: String,
    pub subject: String,
    pub body: String,
}

pub trait Channel {
    fn name(&self) -> &str;
    fn send(&mut self, message: &Message) -> Result<(), DeliveryError>;
}

#[derive(Debug)]
pub struct DeliveryError {
    pub detail: String,
}

impl DeliveryError {
    pub fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
        }
    }
}

impl fmt::Display for DeliveryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.detail)
    }
}

pub struct Hub {
    channels: HashMap<String, Box<dyn Channel>>,
    stats: Stats,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            channels: HashMap::new(),
            stats: Stats::new(),
        }
    }

    pub fn register(&mut self, channel: Box<dyn Channel>) {
        let name = channel.name().to_string();
        self.channels.insert(name.clone(), channel);
        self.stats.track(&name);
    }

    pub fn submit(&mut self, message: Message, strict: bool) -> Result<(), DeliveryError> {
        let result = match self.channels.get_mut(&message.channel) {
            Some(channel) => {
                let outcome = channel.send(&message);
                let name = channel.name().to_string();
                self.stats.add(&name, outcome.is_ok());
                outcome
            }
            None => {
                self.stats.add("", false);
                if strict {
                    Err(DeliveryError::new(format!(
                        "unknown channel: {}",
                        message.channel
                    )))
                } else {
                    Ok(())
                }
            }
        };
        result
    }

    pub fn stats(&self) -> Stats {
        self.stats.clone()
    }
}

fn describe(channel: &dyn Channel, verbose: bool) -> String {
    channel.name().to_string()
}
