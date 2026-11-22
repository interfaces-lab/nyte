final class EmailChannel: Channel {
    let name = "email"
    private let address: String
    private(set) var sent: [String] = []

    init(address: String) {
        self.address = address
    }

    func send(_ message: Message) throws {
        if !address.contains("@") {
            throw NotifyError.invalidAddress(address)
        }
        sent.append(message.subject)
    }
}
