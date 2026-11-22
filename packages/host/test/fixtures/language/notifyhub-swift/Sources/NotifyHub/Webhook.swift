final class WebhookChannel: Channel {
    let name = "webhook"
    private let endpoint: String
    private(set) var attempts = 0

    init(endpoint: String) {
        self.endpoint = endpoint
    }

    func send(_ message: Message) throws {
        attempts += 1
        if !endpoint.hasPrefix("https://") {
            throw NotifyError.invalidEndpoint(endpoint)
        }
    }
}
