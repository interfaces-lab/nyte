import AppKit
import CoreText

private let weightAxis = 0x7767_6874
private let opticalSizeAxis = 0x6F70_737A

public final class FontBook: @unchecked Sendable {
  public static let shared = FontBook()

  private struct Variable {
    let descriptor: CTFontDescriptor
    let opticalSize: ClosedRange<CGFloat>?
  }

  private struct Key: Hashable {
    let family: String
    let size: CGFloat
    let weight: CGFloat
    let italic: Bool
  }

  private let lock = NSLock()
  private var variable: [String: Variable] = [:]
  private var cache: [Key: CTFont] = [:]
  private var fallback = "system"

  @discardableResult
  public func register(family: String, file: URL, asDefault: Bool = true) -> Bool {
    guard
      let descriptors = CTFontManagerCreateFontDescriptorsFromURL(file as CFURL)
        as? [CTFontDescriptor],
      let descriptor = descriptors.first
    else { return false }

    let font = CTFontCreateWithFontDescriptor(descriptor, 14, nil)
    var optical: ClosedRange<CGFloat>?
    for axis in (CTFontCopyVariationAxes(font) as? [[CFString: Any]]) ?? [] {
      guard (axis[kCTFontVariationAxisIdentifierKey] as? Int) == opticalSizeAxis,
        let low = axis[kCTFontVariationAxisMinimumValueKey] as? CGFloat,
        let high = axis[kCTFontVariationAxisMaximumValueKey] as? CGFloat
      else { continue }
      optical = low...high
    }

    lock.lock()
    variable[family.lowercased()] = Variable(descriptor: descriptor, opticalSize: optical)
    if asDefault { fallback = family.lowercased() }
    cache.removeAll()
    lock.unlock()
    return true
  }

  public func font(family: String?, size: CGFloat, weight: CGFloat, italic: Bool = false) -> CTFont {
    lock.lock()
    defer { lock.unlock() }
    let name = (family ?? fallback).lowercased()
    let key = Key(family: name, size: size, weight: weight, italic: italic)
    if let cached = cache[key] { return cached }
    let font = make(name, size: size, weight: weight, italic: italic)
    cache[key] = font
    return font
  }

  private func make(_ family: String, size: CGFloat, weight: CGFloat, italic: Bool) -> CTFont {
    if let entry = variable[family] {
      var descriptor = CTFontDescriptorCreateCopyWithVariation(
        entry.descriptor, weightAxis as CFNumber, weight)
      if let range = entry.opticalSize {
        descriptor = CTFontDescriptorCreateCopyWithVariation(
          descriptor, opticalSizeAxis as CFNumber, min(max(size, range.lowerBound), range.upperBound))
      }
      return slanted(CTFontCreateWithFontDescriptor(descriptor, size, nil), italic, size)
    }

    let system = systemWeight(weight)
    switch family {
    case "system", "sans":
      return slanted(NSFont.systemFont(ofSize: size, weight: system), italic, size)
    case "mono":
      return slanted(NSFont.monospacedSystemFont(ofSize: size, weight: system), italic, size)
    case "serif", "rounded":
      let base = NSFont.systemFont(ofSize: size, weight: system)
      let design: NSFontDescriptor.SystemDesign = family == "serif" ? .serif : .rounded
      let font = base.fontDescriptor.withDesign(design).flatMap { NSFont(descriptor: $0, size: size) }
      return slanted(font ?? base, italic, size)
    default:
      let attributes: [CFString: Any] = [
        kCTFontFamilyNameAttribute: family,
        kCTFontTraitsAttribute: [kCTFontWeightTrait: system.rawValue],
      ]
      let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
      return slanted(CTFontCreateWithFontDescriptor(descriptor, size, nil), italic, size)
    }
  }

  private func slanted(_ font: CTFont, _ italic: Bool, _ size: CGFloat) -> CTFont {
    guard italic else { return font }
    return CTFontCreateCopyWithSymbolicTraits(font, size, nil, .traitItalic, .traitItalic) ?? font
  }
}

private func systemWeight(_ weight: CGFloat) -> NSFont.Weight {
  switch weight {
  case ..<150: return .ultraLight
  case ..<250: return .thin
  case ..<350: return .light
  case ..<450: return .regular
  case ..<550: return .medium
  case ..<650: return .semibold
  case ..<750: return .bold
  case ..<850: return .heavy
  default: return .black
  }
}
