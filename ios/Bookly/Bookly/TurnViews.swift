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

struct TypingIndicator: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.35)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / 0.35) % 3
            HStack(spacing: 5) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(Theme.muted)
                        .frame(width: 6, height: 6)
                        .opacity(index == step ? 1 : 0.35)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
        }
        .accessibilityLabel("Bookly is typing")
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
