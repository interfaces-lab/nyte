mod email;
mod hub;
mod stats;
mod webhook;

use crate::email::Email;
use crate::hub::{Hub, Message};
use crate::webhook::Webhook;

fn main() {
    let mut hub = Hub::new();
    hub.register(Box::new(Email::new("ops@example.com")));
    hub.register(Box::new(Webhook::new("https://hooks.example.com/deploys")));

    let messages = vec![
        Message {
            channel: "email".to_string(),
            subject: "Deploy finished".to_string(),
            body: "v1.8.2 is live.".to_string(),
        },
        Message {
            channel: "webhook".to_string(),
            subject: "Deploy finished".to_string(),
            body: "v1.8.2 is live.".to_string(),
        },
        Message {
            channel: "pager".to_string(),
            subject: "Disk almost full".to_string(),
            body: "92% on db-1.".to_string(),
        },
    ];

    for message in messages {
        if let Err(err) = hub.submit(message, true) {
            eprintln!("submit: {err}");
        }
    }

    let stats = hub.stats();
    println!(  "{} submitted, {} delivered, {} failed", stats.total.submitted, stats.total.delivered, stats.total.failed );
    for name in stats.names() {
        if let Some(counts) = stats.channels.get(&name) {
            println!("  {name:<8} {} delivered, {} failed", counts.delivered, counts.failed);
        }
    }
}
