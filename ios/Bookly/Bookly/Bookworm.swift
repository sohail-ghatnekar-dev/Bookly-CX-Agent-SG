import SwiftUI

// Bookly's support agent is a bookworm: green, round glasses, a red bow tie, and it lives in a book.

/// The bookworm's profile picture: peeking out of its book. When `arriving`, it plays the end of the
/// typing animation once: back from crawling, it dives into its book hole, then peeks out again.
struct BookwormAvatar: View {
    var size: CGFloat = 36
    var arriving = false
    /// The worm is out crawling, so only the book and its empty hole show.
    var empty = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var settled = false

    var body: some View {
        Group {
            if arriving && !settled && !reduceMotion {
                TimelineView(.animation) { context in
                    portrait(rise: Self.arrivalRise(context.date.timeIntervalSince(start)))
                }
            } else {
                portrait(rise: empty && !reduceMotion ? 0 : Bookworm.restingRise)
            }
        }
        .frame(width: size, height: size)
        .background(Theme.traceBackground, in: Circle())
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.hairline, lineWidth: Theme.hairlineWidth))
        .accessibilityHidden(true)
        .onAppear { start = Date() }
        .task(id: arriving) {
            guard arriving else { return }
            try? await Task.sleep(for: .seconds(Self.arrivalDuration))
            settled = true
        }
    }

    private func portrait(rise: CGFloat) -> some View {
        Canvas { context, canvasSize in
            Bookworm.draw(in: context, size: canvasSize, rise: rise)
        }
    }

    static let arrivalDuration = 1.3

    // Stretched up high when it gets back, dives into the hole, pauses, then peeks out.
    static func arrivalRise(_ t: Double) -> CGFloat {
        let ease = { (x: Double) in CGFloat(x * x * (3 - 2 * x)) }
        let peek = Bookworm.restingRise
        switch t {
        case ..<0.4: return 1.3 * (1 - ease(t / 0.4))
        case ..<0.6: return 0
        case ..<1.1: return (peek + 0.12) * ease((t - 0.6) / 0.5)
        case ..<arrivalDuration: return peek + 0.12 * (1 - ease((t - 1.1) / 0.2))
        default: return peek
        }
    }
}

/// While the agent works: a book-themed status line, and the worm climbs out of its book
/// and inches around the outline of the bubble. Reduce Motion keeps the worm in its book.
struct TypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()

    private static let phrases = [
        "Let me check the archives…",
        "Flipping through the pages…",
        "Checking the shelves…",
        "Looking it up in the ledger…",
        "Dusting off the records…",
    ]

    var body: some View {
        TimelineView(.animation) { context in
            let elapsed = context.date.timeIntervalSince(start)
            let phrase = Self.phrases[Int(elapsed / 2.4) % Self.phrases.count]
            ZStack(alignment: .topLeading) {
                BookwormAvatar(empty: true)
                    .offset(x: CrawlTrack.avatar.minX, y: CrawlTrack.avatar.minY)
                Text(phrase)
                    .font(.system(.subheadline, design: .serif).italic())
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 16)
                    .frame(width: CrawlTrack.bubble.width, height: CrawlTrack.bubble.height, alignment: .leading)
                    .background(Theme.card, in: BubbleShape.agent)
                    .overlay(BubbleShape.agent.stroke(Theme.hairline, lineWidth: Theme.hairlineWidth))
                    .offset(x: CrawlTrack.bubble.minX, y: CrawlTrack.bubble.minY)
                if !reduceMotion {
                    Canvas { canvas, _ in CrawlingWorm.draw(in: canvas, time: elapsed) }
                        .allowsHitTesting(false)
                }
            }
            .frame(width: CrawlTrack.size.width, height: CrawlTrack.size.height, alignment: .topLeading)
        }
        .onAppear { start = Date() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Bookly is checking the archives")
    }
}

// MARK: - Drawing

/// The bookworm in its book, on a 100 x 96 canvas. `rise` is how far it's out:
/// 0 is inside the book, `restingRise` is its profile pose, above 1 it's stretched up high.
enum Bookworm {
    static let restingRise: CGFloat = 0.85

    static let green = Color(red: 0.49, green: 0.74, blue: 0.24)
    static let darkGreen = Color(red: 0.31, green: 0.55, blue: 0.14)
    static let lightGreen = Color(red: 0.72, green: 0.88, blue: 0.47)
    static let bowTie = Color(red: 0.80, green: 0.16, blue: 0.14)
    static let bowKnot = Color(red: 0.58, green: 0.09, blue: 0.08)
    static let mouth = Color(red: 0.36, green: 0.10, blue: 0.08)
    static let hole = Color(red: 0.17, green: 0.12, blue: 0.10)

    static let canvasSize = CGSize(width: 100, height: 96)
    static let holeCenter = CGPoint(x: 50, y: 72)

    static func draw(in canvas: GraphicsContext, size: CGSize, rise: CGFloat) {
        let scale = min(size.width / canvasSize.width, size.height / canvasSize.height)
        var c = canvas
        c.translateBy(x: (size.width - canvasSize.width * scale) / 2, y: (size.height - canvasSize.height * scale) / 2)
        c.scaleBy(x: scale, y: scale)

        drawBooks(in: c, front: false)
        c.fill(Path(ellipseIn: CGRect(x: 38, y: 69, width: 24, height: 6)), with: .color(hole))

        let base = holeCenter
        let head = CGPoint(x: base.x, y: base.y - 44 * rise)
        if rise > 0.04 {
            let reach = base.y - head.y
            var body = Path()
            body.move(to: base)
            body.addCurve(to: head, control1: CGPoint(x: base.x, y: base.y - reach * 0.35), control2: CGPoint(x: base.x, y: head.y + reach * 0.35))
            c.stroke(body, with: .color(green), style: StrokeStyle(lineWidth: 20, lineCap: .round))
            if rise > 0.3 {
                c.stroke(body.trimmedPath(from: 0.25, to: 0.85).offsetBy(dx: -5, dy: 0), with: .color(lightGreen.opacity(0.8)), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            }
            if rise > 0.5 {
                for y in [base.y - reach * 0.18, base.y - reach * 0.32] {
                    var band = Path()
                    band.move(to: CGPoint(x: base.x - 9, y: y))
                    band.addQuadCurve(to: CGPoint(x: base.x + 9, y: y), control: CGPoint(x: base.x, y: y + 3))
                    c.stroke(band, with: .color(darkGreen.opacity(0.55)), lineWidth: 1.4)
                }
            }
        }

        drawBooks(in: c, front: true)
        if rise > 0.55 { drawBowTie(in: c, at: CGPoint(x: head.x, y: min(head.y + 22, 62))) }
        if rise > 0.45 { drawFace(in: c, head: head) }
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

    private static func drawFace(in canvas: GraphicsContext, head: CGPoint) {
        let lensRadius: CGFloat = 7.5
        let left = CGPoint(x: head.x - 7.5, y: head.y + 3)
        let right = CGPoint(x: head.x + 7.5, y: head.y + 3)
        for eye in [left, right] {
            canvas.fill(Path(ellipseIn: CGRect(x: eye.x - 6, y: eye.y - 6, width: 12, height: 12)), with: .color(.white))
            canvas.fill(Path(ellipseIn: CGRect(x: eye.x - 2.2, y: eye.y - 2.2, width: 5.6, height: 5.6)), with: .color(Theme.ink))
            canvas.fill(Path(ellipseIn: CGRect(x: eye.x - 1, y: eye.y - 1.4, width: 1.6, height: 1.6)), with: .color(.white))
        }
        var glasses = Path()
        for lens in [left, right] {
            glasses.addEllipse(in: CGRect(x: lens.x - lensRadius, y: lens.y - lensRadius, width: lensRadius * 2, height: lensRadius * 2))
        }
        glasses.move(to: CGPoint(x: left.x + lensRadius, y: left.y))
        glasses.addQuadCurve(to: CGPoint(x: right.x - lensRadius, y: right.y), control: CGPoint(x: head.x, y: head.y + 1))
        canvas.stroke(glasses, with: .color(Theme.ink), lineWidth: 1.7)

        let m = CGPoint(x: head.x, y: head.y + 12)
        var smile = Path()
        smile.move(to: CGPoint(x: m.x - 5.5, y: m.y))
        smile.addQuadCurve(to: CGPoint(x: m.x + 5.5, y: m.y), control: CGPoint(x: m.x, y: m.y + 8))
        smile.closeSubpath()
        canvas.fill(smile, with: .color(mouth))
    }
}

/// Where the typing row's pieces sit, and the path the worm crawls: out of the avatar's
/// book hole, then round and round the status bubble's outline.
enum CrawlTrack {
    static let size = CGSize(width: 320, height: 80)
    static let avatar = CGRect(x: 0, y: 42, width: 36, height: 36)
    static let bubble = CGRect(x: 46, y: 18, width: 262, height: 48)

    static let hole: CGPoint = {
        let scale = min(avatar.width / Bookworm.canvasSize.width, avatar.height / Bookworm.canvasSize.height)
        let dy = (avatar.height - Bookworm.canvasSize.height * scale) / 2
        return CGPoint(x: avatar.minX + Bookworm.holeCenter.x * scale, y: avatar.minY + dy + Bookworm.holeCenter.y * scale)
    }()

    static let emerge: Track = {
        let edge = bubble.insetBy(dx: -3, dy: -3)
        var path = Path()
        path.move(to: hole)
        path.addQuadCurve(to: CGPoint(x: edge.minX, y: edge.maxY - 19), control: CGPoint(x: hole.x + 2, y: edge.minY + 30))
        return Track(path, samples: 60)
    }()

    // Up the left side, along the top, down the right, back along the bottom.
    static let loop: Track = {
        let e = bubble.insetBy(dx: -3, dy: -3)
        let r: CGFloat = 20, tail: CGFloat = 8
        var path = Path()
        path.move(to: CGPoint(x: e.minX, y: e.maxY - 19))
        path.addLine(to: CGPoint(x: e.minX, y: e.minY + r))
        path.addArc(tangent1End: CGPoint(x: e.minX, y: e.minY), tangent2End: CGPoint(x: e.minX + r, y: e.minY), radius: r)
        path.addLine(to: CGPoint(x: e.maxX - r, y: e.minY))
        path.addArc(tangent1End: CGPoint(x: e.maxX, y: e.minY), tangent2End: CGPoint(x: e.maxX, y: e.minY + r), radius: r)
        path.addLine(to: CGPoint(x: e.maxX, y: e.maxY - r))
        path.addArc(tangent1End: CGPoint(x: e.maxX, y: e.maxY), tangent2End: CGPoint(x: e.maxX - r, y: e.maxY), radius: r)
        path.addLine(to: CGPoint(x: e.minX + tail, y: e.maxY))
        path.addArc(tangent1End: CGPoint(x: e.minX, y: e.maxY), tangent2End: CGPoint(x: e.minX, y: e.maxY - tail), radius: tail)
        path.addLine(to: CGPoint(x: e.minX, y: e.maxY - 19))
        return Track(path, samples: 500)
    }()

    /// A position anywhere along the crawl; nil while that part of the worm is still inside the book.
    static func point(at distance: CGFloat) -> CGPoint? {
        if distance < 0 { return nil }
        if distance < emerge.length { return emerge.point(at: distance) }
        return loop.point(at: (distance - emerge.length).truncatingRemainder(dividingBy: loop.length))
    }

    /// The side facing away from the bubble, which is the way the worm's back arches.
    static func outward(at distance: CGFloat) -> CGVector {
        let a = point(at: max(distance - 1, 0)) ?? hole
        let b = point(at: distance + 1) ?? hole
        let length = max(hypot(b.x - a.x, b.y - a.y), 0.001)
        return CGVector(dx: (b.y - a.y) / length, dy: -(b.x - a.x) / length)
    }
}

/// A path sampled at even steps, so a distance along it maps straight to a point.
struct Track {
    let points: [CGPoint]
    let length: CGFloat

    init(_ path: Path, samples: Int) {
        let start = path.trimmedPath(from: 0, to: 0.0001).currentPoint ?? .zero
        points = [start] + (1...samples).map { path.trimmedPath(from: 0, to: CGFloat($0) / CGFloat(samples)).currentPoint ?? start }
        length = zip(points, points.dropFirst()).reduce(0) { $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y) }
    }

    func point(at distance: CGFloat) -> CGPoint {
        let f = min(max(distance / length, 0), 1) * CGFloat(points.count - 1)
        let i = min(Int(f), points.count - 2)
        let t = f - CGFloat(i)
        let a = points[i], b = points[i + 1]
        return CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }
}

/// The worm in motion, side on: the tail catches up so the body arches, then the head reaches forward.
enum CrawlingWorm {
    static let bodyLength: CGFloat = 24
    static let stride: CGFloat = 12
    static let period = 0.5
    static let segments = 7

    static func draw(in canvas: GraphicsContext, time t: Double) {
        let cycle = (t / period).rounded(.down)
        let phase = t / period - cycle
        let ease = { (x: Double) in CGFloat(x * x * (3 - 2 * x)) }
        let start = CGFloat(cycle) * stride - bodyLength  // starts with the whole body inside the book
        let tail: CGFloat, head: CGFloat, arch: CGFloat
        if phase < 0.5 {
            let s = ease(phase * 2)
            (tail, head, arch) = (start + stride * s, start + bodyLength, s)
        } else {
            let s = ease((phase - 0.5) * 2)
            (tail, head, arch) = (start + stride, start + bodyLength + stride * s, 1 - s)
        }

        for i in 0..<segments {
            let u = CGFloat(i) / CGFloat(segments - 1)
            let d = tail + (head - tail) * u
            guard let p = CrawlTrack.point(at: d) else { continue }
            let n = CrawlTrack.outward(at: d)
            let lift = 7 * arch * sin(.pi * u)
            let center = CGPoint(x: p.x + n.dx * lift, y: p.y + n.dy * lift)
            if i == segments - 1 {
                drawHead(in: canvas, at: center, outward: n)
            } else {
                let r = 2.8 + 0.9 * sin(.pi * u)
                canvas.fill(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)),
                            with: .color(i.isMultiple(of: 2) ? Bookworm.green : Bookworm.darkGreen.opacity(0.9)))
                if i == segments - 2 {
                    let bow = CGPoint(x: center.x + n.dx * 1.5, y: center.y + n.dy * 1.5)
                    canvas.fill(Path(ellipseIn: CGRect(x: bow.x - 1.8, y: bow.y - 1.8, width: 3.6, height: 3.6)), with: .color(Bookworm.bowTie))
                }
            }
        }
    }

    private static func drawHead(in canvas: GraphicsContext, at c: CGPoint, outward n: CGVector) {
        let r: CGFloat = 4.8
        canvas.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(Bookworm.green))
        // Two lenses side by side across the head, a little toward the outside.
        let along = CGVector(dx: -n.dy, dy: n.dx)
        let lenses = [-1.0, 1.0].map { side in
            CGPoint(x: c.x + along.dx * 2.3 * side + n.dx * 1.2, y: c.y + along.dy * 2.3 * side + n.dy * 1.2)
        }
        var glasses = Path()
        for lens in lenses {
            glasses.addEllipse(in: CGRect(x: lens.x - 2.1, y: lens.y - 2.1, width: 4.2, height: 4.2))
        }
        canvas.fill(glasses, with: .color(.white))
        canvas.stroke(glasses, with: .color(Theme.ink), lineWidth: 0.9)
        for lens in lenses {
            canvas.fill(Path(ellipseIn: CGRect(x: lens.x - 0.9, y: lens.y - 0.9, width: 1.8, height: 1.8)), with: .color(Theme.ink))
        }
    }
}

/// Message-app bubbles: one corner tucked in on the speaker's side.
enum BubbleShape {
    static let agent = UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 5, bottomTrailingRadius: 18, topTrailingRadius: 18)
    static let customer = UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18)
}
