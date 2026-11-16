import Foundation
import NyteCore

extension LanguageService {
    static let samplingInterval: Duration = .seconds(20)

    public func restart(_ id: Int) async {
        guard servers.indices.contains(id) else { return }
        servers[id].restarts = []
        if let connection = servers[id].connection {
            servers[id].stopping = true
            await stop(id, connection)
        }
        servers[id].stopping = false
        servers[id].residentBytes = nil
        servers[id].capabilities = Capabilities()
        setState(id, .starting)
        await launch(id)
    }

    @discardableResult
    public func sampleMemory() async -> [ServerStatus] {
        let sizes = await ProcessMemory.resident(of: servers.map { $0.connection?.identifier })
        for (index, size) in sizes.enumerated() where servers.indices.contains(index) {
            let wasOver = status(of: index).isOverMemoryCeiling
            servers[index].residentBytes = size
            if status(of: index).isOverMemoryCeiling != wasOver { onEvent?(.status(status(of: index))) }
        }
        return statuses
    }

    func startSampling() {
        guard sampling == nil else { return }
        sampling = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: Self.samplingInterval) } catch { return }
                guard let self else { return }
                await sampleMemory()
            }
        }
    }
}
