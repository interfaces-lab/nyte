enum NotifyError: Error, Equatable {
    case unknownChannel(String)
    case invalidAddress(String)
    case invalidEndpoint(String)
}

struct Message {
    let channel: String
    let subject: String
    let body: String
}

protocol Channel {
    var name: String { get }
    func send(_ message: Message) throws
}

final class Hub {
    private var channels: [String: Channel] = [:]
    private var runningStats = Stats()

    func register(_ channel: Channel) {
        channels[channel.name] = channel
        runningStats.track(channel.name)
    }

    func submit(_ message: Message, urgent: Bool = false) throws {
        guard let channel = channels[message.channel] else {
            record(name: "", delivered: false)
            throw NotifyError.unknownChannel(message.channel)
        }
        do {
            try channel.send(message)
            record(name: channel.name, delivered: true)
        } catch {
            record(name: channel.name, delivered: false)
            if urgent {
                throw error
            }
            throw error
        }
    }

    func stats() -> Stats {
        runningStats
    }

    private func record(name: String, delivered: Bool) {
        runningStats.add(name: name, delivered: delivered)
    }
}

func describe(_ channel: Channel) -> String {
    var label = channel.name
    return label
}
