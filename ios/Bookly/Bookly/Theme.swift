import SwiftUI
import UIKit

// Editorial bookstore palette and type. Every color and font in the app comes from here.
enum Theme {
    static let paper = dynamic(light: 0xF6F0E4, dark: 0x1E1A15)
    static let card = dynamic(light: 0xFFFDF8, dark: 0x2A251E)
    static let hairline = dynamic(light: 0xD9CFB8, dark: 0x433B2F)
    static let ink = dynamic(light: 0x2B2620, dark: 0xF2EBDD)
    static let muted = dynamic(light: 0x6E634E, dark: 0xA89D86)
    static let accent = dynamic(light: 0x7A2E2A, dark: 0xD9877D)
    static let traceBackground = dynamic(light: 0xEDE3CF, dark: 0x2F2920)
    static let denyBackground = dynamic(light: 0xF3DDD6, dark: 0x4A2C26)
    static let denyText = dynamic(light: 0x7A2418, dark: 0xF0B4A8)

    static let hairlineWidth: CGFloat = 0.5

    // System serif (New York) for conversation and headings.
    static let prose = Font.system(.body, design: .serif)
    static let heading = Font.system(.title3, design: .serif).weight(.semibold)
    static let display = Font.system(.largeTitle, design: .serif)
    // SF for chips, captions, and controls.
    static let label = Font.system(.subheadline)
    static let caption = Font.system(.caption)
    // SF Mono for the trace.
    static let trace = Font.system(.caption, design: .monospaced)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
