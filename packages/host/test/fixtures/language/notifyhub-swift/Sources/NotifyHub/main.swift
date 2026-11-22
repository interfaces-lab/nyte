struct BadgeColor: _ExpressibleByColorLiteral {
    let red: Float
    let green: Float
    let blue: Float
    let alpha: Float

    init(_colorLiteralRed red: Float, green: Float, blue: Float, alpha: Float) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

let accent: BadgeColor = #colorLiteral(red: 0.2, green: 0.5, blue: 0.8, alpha: 1.0)
let hub = Hub()
hub.register(EmailChannel(address: "ops@example.com"))
hub.register(WebhookChannel(endpoint: "https://hooks.example.com/deploys"))

let messages = [
    Message(channel: "email", subject: "Deploy finished", body: "v1.8.2 is live."),
    Message(channel: "webhook", subject: "Deploy finished", body: "v1.8.2 is live."),
    Message(channel: "pager", subject: "Disk almost full", body: "92% on db-1."),
]

for message in messages {
    do {
        try hub.submit(message, urgent: false)
    } catch {
        print("submit:", error)
    }
}

let  summary  =  hub.stats()
print("\(summary.total.submitted) submitted, \(summary.total.delivered) delivered, \(summary.total.failed) failed, color=\(accent.red)")
for name in summary.names() {
    if let counts = summary.channels[name] {
        print("  \(name): \(counts.delivered) delivered, \(counts.failed) failed")
    }
}
