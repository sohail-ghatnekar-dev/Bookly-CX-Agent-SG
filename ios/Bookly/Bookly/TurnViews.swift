import SwiftUI

struct TurnView: View {
    let turn: ChatModel.Turn
    let showTrace: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer(minLength: 48)
                Text(turn.user)
                    .font(Theme.prose)
                    .foregroundStyle(Theme.paper)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.ink, in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityLabel("You said: \(turn.user)")
            }
            if let reply = turn.reply {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(reply)
                            .font(Theme.prose)
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth)
                            )
                            .accessibilityLabel("Bookly said: \(reply)")
                        Spacer(minLength: 32)
                    }
                    if !turn.citations.isEmpty {
                        Text("Policy · \(turn.citations.joined(separator: ", "))")
                            .font(Theme.caption)
                            .foregroundStyle(Theme.muted)
                            .padding(.leading, 4)
                    }
                    if showTrace && !turn.trace.isEmpty {
                        TraceBlock(events: turn.trace)
                    }
                }
            }
        }
    }
}

// One monospaced line per event, at most four. Non-ok events are kept first when trimming.
struct TraceBlock: View {
    let events: [TraceLine]
    private static let maxLines = 4

    private var visible: [TraceLine] {
        guard events.count > Self.maxLines else { return events }
        let notable = events.filter { $0.outcome != "ok" } + events.filter { $0.outcome == "ok" }
        let keep = Set(notable.prefix(Self.maxLines).map(\.seq))
        return events.filter { keep.contains($0.seq) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(visible, id: \.seq) { event in
                HStack(spacing: 6) {
                    Text("\(event.label) → \(event.detail)")
                        .font(Theme.trace)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if event.outcome != "ok" {
                        Text(event.outcome)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Theme.denyText)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Theme.denyBackground, in: Capsule())
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.traceBackground, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Trace")
    }
}

struct HandoffCard: View {
    let escalation: Escalation
    let onNewChat: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Handed to a teammate")
                    .font(Theme.heading)
                    .foregroundStyle(Theme.ink)
                Text("What your teammate sees")
                    .font(Theme.caption)
                    .foregroundStyle(Theme.muted)
                Text(escalation.summary)
                    .font(Theme.prose)
                    .foregroundStyle(Theme.ink)
                Rectangle().fill(Theme.hairline).frame(height: Theme.hairlineWidth)
                row("Verified", escalation.verified ? "Yes" : "No")
                row("Rule", escalation.ruleIds.isEmpty ? "None" : escalation.ruleIds.joined(separator: ", "))
                row("Reply time", "Within 1 business day")
            }
            .padding(16)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))

            Button("Start a new chat", action: onNewChat)
                .font(Theme.label)
                .foregroundStyle(Theme.accent)
                .padding(.leading, 4)
        }
        .padding(.top, 4)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Theme.caption).foregroundStyle(Theme.muted)
            Spacer()
            Text(value).font(Theme.label).foregroundStyle(Theme.ink)
        }
        .accessibilityElement(children: .combine)
    }
}

// Bookly's typing indicator: a bookworm in round glasses and a red bow tie, poking out of a
// book and swaying while it reads. It sits still when Reduce Motion is on.
struct TypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: reduceMotion)) { context in
            Canvas { canvas, size in
                let time = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
                let scale = min(size.width / Bookworm.width, size.height / Bookworm.height)
                var scaled = canvas
                scaled.translateBy(x: (size.width - Bookworm.width * scale) / 2, y: (size.height - Bookworm.height * scale) / 2)
                scaled.scaleBy(x: scale, y: scale)
                Bookworm.draw(in: scaled, time: time)
            }
        }
        .frame(width: 92, height: 88)
        .padding(8)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
        .accessibilityElement()
        .accessibilityLabel("Bookly is typing")
    }
}

// Drawn on a 100 x 96 canvas.
private enum Bookworm {
    static let width: CGFloat = 100
    static let height: CGFloat = 96

    static let green = Color(red: 0.49, green: 0.74, blue: 0.24)
    static let darkGreen = Color(red: 0.31, green: 0.55, blue: 0.14)
    static let lightGreen = Color(red: 0.72, green: 0.88, blue: 0.47)
    static let bowTie = Color(red: 0.80, green: 0.16, blue: 0.14)
    static let bowKnot = Color(red: 0.58, green: 0.09, blue: 0.08)
    static let mouth = Color(red: 0.36, green: 0.10, blue: 0.08)
    static let hole = Color(red: 0.17, green: 0.12, blue: 0.10)

    static func draw(in canvas: GraphicsContext, time t: Double) {
        // Sway side to side, and stretch up out of the book and back down, like an inchworm reading.
        let sway = CGFloat(sin(t * 2.1)) * 7
        let stretch = CGFloat(sin(t * 3.2) * 0.5 + 0.5)
        let base = CGPoint(x: 50, y: 72)
        let head = CGPoint(x: 50 + sway, y: 30 - 6 * stretch)
        let c1 = CGPoint(x: 50, y: 58)
        let c2 = CGPoint(x: 50 - sway * 0.5, y: head.y + 16)
        let point = { (u: CGFloat) -> CGPoint in
            let v = 1 - u
            return CGPoint(
                x: v * v * v * base.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * head.x,
                y: v * v * v * base.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * head.y
            )
        }

        drawBooks(in: canvas, front: false)
        canvas.fill(Path(ellipseIn: CGRect(x: 38, y: 69, width: 24, height: 6)), with: .color(hole))

        var body = Path()
        body.move(to: base)
        body.addCurve(to: head, control1: c1, control2: c2)
        canvas.stroke(body, with: .color(green), style: StrokeStyle(lineWidth: 20, lineCap: .round))
        canvas.stroke(
            body.trimmedPath(from: 0.2, to: 0.85).offsetBy(dx: -5, dy: 0),
            with: .color(lightGreen.opacity(0.8)),
            style: StrokeStyle(lineWidth: 4, lineCap: .round)
        )
        for u in [0.16, 0.3] as [CGFloat] {
            let p = point(u), q = point(u + 0.02)
            let length = max(hypot(q.x - p.x, q.y - p.y), 0.001)
            let normal = CGPoint(x: -(q.y - p.y) / length, y: (q.x - p.x) / length)
            var band = Path()
            band.move(to: CGPoint(x: p.x - normal.x * 9, y: p.y - normal.y * 9))
            band.addQuadCurve(to: CGPoint(x: p.x + normal.x * 9, y: p.y + normal.y * 9), control: CGPoint(x: p.x, y: p.y + 3))
            canvas.stroke(band, with: .color(darkGreen.opacity(0.55)), lineWidth: 1.4)
        }

        drawBooks(in: canvas, front: true)
        drawBowTie(in: canvas, at: point(0.5))
        drawFace(in: canvas, head: head, time: t)
    }

    private static func drawBooks(in canvas: GraphicsContext, front: Bool) {
        if !front {
            // Bottom book, then the top face of the book the worm lives in.
            canvas.fill(Path(roundedRect: CGRect(x: 14, y: 84, width: 72, height: 10), cornerRadius: 2), with: .color(Theme.ink))
            canvas.fill(Path(CGRect(x: 20, y: 85.5, width: 63, height: 7)), with: .color(Theme.paper))
            var top = Path()
            top.addLines([CGPoint(x: 24, y: 66), CGPoint(x: 82, y: 66), CGPoint(x: 78, y: 74), CGPoint(x: 20, y: 74)])
            top.closeSubpath()
            canvas.fill(top, with: .color(Theme.accent.opacity(0.85)))
            return
        }
        // The top book's front edge covers the bottom of the worm.
        canvas.fill(Path(roundedRect: CGRect(x: 20, y: 74, width: 58, height: 10), cornerRadius: 2), with: .color(Theme.accent))
        canvas.fill(Path(CGRect(x: 25, y: 75.5, width: 52, height: 7)), with: .color(Theme.paper))
        var pages = Path()
        for y in [77.5, 80.0] as [CGFloat] {
            pages.move(to: CGPoint(x: 27, y: y))
            pages.addLine(to: CGPoint(x: 75, y: y))
        }
        pages.move(to: CGPoint(x: 22, y: 88))
        pages.addLine(to: CGPoint(x: 81, y: 88))
        canvas.stroke(pages, with: .color(Theme.hairline), lineWidth: 0.8)
    }

    private static func drawBowTie(in canvas: GraphicsContext, at center: CGPoint) {
        var wings = Path()
        wings.addLines([center, CGPoint(x: center.x - 12, y: center.y - 6), CGPoint(x: center.x - 12, y: center.y + 6)])
        wings.closeSubpath()
        wings.addLines([center, CGPoint(x: center.x + 12, y: center.y - 6), CGPoint(x: center.x + 12, y: center.y + 6)])
        wings.closeSubpath()
        canvas.fill(wings, with: .color(bowTie))
        canvas.fill(Path(ellipseIn: CGRect(x: center.x - 3, y: center.y - 3, width: 6, height: 6)), with: .color(bowKnot))
    }

    private static func drawFace(in canvas: GraphicsContext, head: CGPoint, time t: Double) {
        let lensRadius: CGFloat = 7.5
        let left = CGPoint(x: head.x - 7.5, y: head.y + 3)
        let right = CGPoint(x: head.x + 7.5, y: head.y + 3)
        let blinking = t.truncatingRemainder(dividingBy: 3.6) < 0.14 && t > 0
        let gaze = CGPoint(x: CGFloat(cos(t * 0.8)) * 1.6, y: CGFloat(sin(t * 1.3)) * 1.2)

        for eye in [left, right] {
            let eyeHeight: CGFloat = blinking ? 1.5 : 12
            canvas.fill(Path(ellipseIn: CGRect(x: eye.x - 6, y: eye.y - eyeHeight / 2, width: 12, height: eyeHeight)), with: .color(.white))
            if !blinking {
                let pupil = CGPoint(x: eye.x + gaze.x, y: eye.y + gaze.y)
                canvas.fill(Path(ellipseIn: CGRect(x: pupil.x - 2.8, y: pupil.y - 2.8, width: 5.6, height: 5.6)), with: .color(Theme.ink))
                canvas.fill(Path(ellipseIn: CGRect(x: pupil.x - 1.6, y: pupil.y - 2, width: 1.6, height: 1.6)), with: .color(.white))
            }
        }

        var glasses = Path()
        for lens in [left, right] {
            glasses.addEllipse(in: CGRect(x: lens.x - lensRadius, y: lens.y - lensRadius, width: lensRadius * 2, height: lensRadius * 2))
        }
        glasses.move(to: CGPoint(x: left.x + lensRadius, y: left.y))
        glasses.addQuadCurve(to: CGPoint(x: right.x - lensRadius, y: right.y), control: CGPoint(x: head.x, y: head.y + 1))
        glasses.move(to: CGPoint(x: right.x + lensRadius, y: right.y - 1))
        glasses.addLine(to: CGPoint(x: right.x + lensRadius + 3, y: right.y - 2))
        canvas.stroke(glasses, with: .color(Theme.ink), lineWidth: 1.7)

        let m = CGPoint(x: head.x, y: head.y + 12)
        var smile = Path()
        smile.move(to: CGPoint(x: m.x - 5.5, y: m.y))
        smile.addQuadCurve(to: CGPoint(x: m.x + 5.5, y: m.y), control: CGPoint(x: m.x, y: m.y + 8))
        smile.closeSubpath()
        canvas.fill(smile, with: .color(mouth))
        canvas.fill(Path(ellipseIn: CGRect(x: m.x - 2.5, y: m.y + 2.2, width: 5, height: 2.6)), with: .color(bowTie.opacity(0.9)))
    }
}

struct Chip: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(text, action: action)
            .font(Theme.label)
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
    }
}

// Suggested answers under the latest reply. Tapping one sends it as the customer's message.
struct SuggestionRow: View {
    let options: [String]
    let onPick: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options, id: \.self) { option in
                    Chip(text: option) { onPick(option) }
                        .accessibilityLabel("Suggested reply: \(option)")
                }
            }
            .padding(.vertical, 1)
        }
    }
}

struct ErrorRow: View {
    let text: String
    let canRetry: Bool
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text(text)
                .font(Theme.label)
                .foregroundStyle(Theme.denyText)
            if canRetry {
                Button("Retry", action: onRetry)
                    .font(Theme.label.weight(.semibold))
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(.horizontal, 4)
    }
}
