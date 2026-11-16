import NyteCore

struct Snippet {
    private(set) var text = ""
    private(set) var stops: [CompletionItem.Stop] = []

    private var units: [UInt16] = []
    private var numbers: [Int] = []
    private var source: [Character]
    private var index = 0

    init(parsing snippet: String) {
        source = Array(snippet)
        parse(until: nil)
        text = String(decoding: units, as: UTF16.self)
        let order = numbers.indices.sorted { left, right in
            let a = numbers[left] == 0 ? Int.max : numbers[left]
            let b = numbers[right] == 0 ? Int.max : numbers[right]
            return a < b
        }
        stops = order.map { stops[$0] }
    }

    private mutating func parse(until terminator: Character?) {
        while index < source.count {
            let character = source[index]
            if character == terminator { return }
            if character == "\\", index + 1 < source.count, "$}\\,|".contains(source[index + 1]) {
                emit(source[index + 1])
                index += 2
            } else if character == "$" {
                index += 1
                dollar()
            } else {
                emit(character)
                index += 1
            }
        }
    }

    private mutating func dollar() {
        if let number = digits() { return stop(number, start: units.count) }
        guard index < source.count else { return emit("$") }
        if source[index] != "{" {
            guard name() != nil else { return emit("$") }
            return
        }
        index += 1
        if let number = digits() {
            let start = units.count
            if index < source.count, source[index] == ":" {
                index += 1
                parse(until: "}")
            } else if index < source.count, source[index] == "|" {
                index += 1
                choice()
            }
            index += 1
            return stop(number, start: start)
        }
        _ = name()
        if index < source.count, source[index] == ":" {
            index += 1
            parse(until: "}")
        } else {
            while index < source.count, source[index] != "}" { index += 1 }
        }
        index += 1
    }

    private mutating func choice() {
        var first = true
        while index < source.count, source[index] != "|" {
            let character = source[index]
            if character == "\\", index + 1 < source.count {
                if first { emit(source[index + 1]) }
                index += 2
                continue
            }
            if character == "," { first = false } else if first { emit(character) }
            index += 1
        }
        index += 1
    }

    private mutating func stop(_ number: Int, start: Int) {
        guard !numbers.contains(number) else { return }
        numbers.append(number)
        stops.append(.init(utf16Offset: start, utf16Length: units.count - start))
    }

    private mutating func digits() -> Int? {
        var value: Int?
        while index < source.count, let digit = source[index].wholeNumberValue, source[index].isASCII {
            value = (value ?? 0) * 10 + digit
            index += 1
        }
        return value
    }

    private mutating func name() -> String? {
        let start = index
        while index < source.count, source[index].isASCII, source[index].isLetter || source[index].isNumber || source[index] == "_" {
            index += 1
        }
        return index > start ? String(source[start..<index]) : nil
    }

    private mutating func emit(_ character: Character) {
        units.append(contentsOf: character.utf16)
    }
}
