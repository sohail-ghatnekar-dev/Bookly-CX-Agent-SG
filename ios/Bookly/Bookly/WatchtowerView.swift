import SwiftUI

// Admin view of how the agent is doing: volume, what customers ask, handoffs, and which controls fired.
// Counts come from the watchtower function, built from every chat in the last 30 days.
struct WatchtowerView: View {
    @State private var summary: Watchtower?
    @State private var loadFailed = false

    var body: some View {
        ScrollView {
            if let summary {
                VStack(alignment: .leading, spacing: 22) {
                    Text("Last \(summary.days) days · \(summary.conversations) chats · counts only, no customer details")
                        .font(Theme.caption)
                        .foregroundStyle(Theme.muted)
                    performance(summary)
                    topics(summary)
                    handoffs(summary)
                    controls(summary)
                    flags(summary)
                }
                .padding(16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.paper.ignoresSafeArea())
        .navigationTitle("Watchtower")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if loadFailed && summary == nil {
                Text(Backend.networkError).font(Theme.label).foregroundStyle(Theme.muted)
            } else if summary == nil {
                ProgressView()
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            summary = try await Backend.watchtower()
            loadFailed = false
        } catch {
            loadFailed = true
        }
    }

    // MARK: Sections

    private func performance(_ s: Watchtower) -> some View {
        Panel(title: "How the agent is doing") {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
                Stat(value: percent(s.handledByAgent, of: s.conversations), label: "Handled by the agent")
                Stat(value: percent(s.sentToEmployee, of: s.conversations), label: "Sent to an employee")
                Stat(value: String(format: "%.1f", s.avgTurns), label: "Messages per chat")
                Stat(value: "\(s.returnsCreated)", label: "Returns created")
                Stat(value: "\(s.flaggedConversations)", label: "Chats flagged for review",
                     highlight: s.flaggedConversations > 0)
                Stat(value: s.latestEval.map { "\($0.passed)/\($0.total)" } ?? "–", label: "Latest eval run")
            }
        }
    }

    private func topics(_ s: Watchtower) -> some View {
        Panel(title: "What customers ask") {
            Card {
                if s.topics.isEmpty { Empty(text: "No chats yet.") }
                ForEach(s.topics, id: \.self) { topic in
                    Bar(name: topic.name, count: topic.count, total: s.conversations)
                }
            }
        }
    }

    private func handoffs(_ s: Watchtower) -> some View {
        Panel(title: "When an employee steps in") {
            Card {
                Text("\(s.sentToEmployee) of \(s.conversations) chats (\(percent(s.sentToEmployee, of: s.conversations)))")
                    .font(Theme.label)
                    .foregroundStyle(Theme.ink)
                ForEach(s.handoffReasons, id: \.self) { reason in
                    Bar(name: reason.name, count: reason.count, total: max(s.sentToEmployee, 1))
                }
                if !s.recentHandoffs.isEmpty {
                    Divider().overlay(Theme.hairline)
                    Text("Latest reasons").font(Theme.caption).foregroundStyle(Theme.muted)
                    ForEach(s.recentHandoffs, id: \.self) { handoff in
                        Row(title: handoff.reason, trailing: relative(handoff.at), mono: false)
                    }
                }
            }
        }
    }

    private func controls(_ s: Watchtower) -> some View {
        Panel(title: "Controls that fired") {
            Card {
                ForEach(s.controls, id: \.self) { control in
                    Row(title: control.name, subtitle: control.what, trailing: "\(control.count)",
                        highlight: control.count > 0)
                }
                if !s.rulesEnforced.isEmpty {
                    Divider().overlay(Theme.hairline)
                    Text("Return rules enforced").font(Theme.caption).foregroundStyle(Theme.muted)
                    ForEach(s.rulesEnforced, id: \.self) { rule in
                        Row(title: rule.name, trailing: "\(rule.count) denied")
                    }
                }
            }
        }
    }

    private func flags(_ s: Watchtower) -> some View {
        Panel(title: "Flagged for review") {
            Card {
                if s.recentFlags.isEmpty {
                    Empty(text: "Nothing flagged. No made-up citations, unbacked claims, refusals or step limits.")
                }
                ForEach(s.recentFlags, id: \.self) { flag in
                    Row(title: flag.name, subtitle: flag.detail.isEmpty ? nil : flag.detail,
                        trailing: relative(flag.at), highlight: true, mono: false)
                }
            }
        }
    }
}

// MARK: Pieces

private struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Theme.heading).foregroundStyle(Theme.ink)
            content
        }
    }
}

private struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
    }
}

private struct Stat: View {
    let value: String
    let label: String
    var highlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(.title2, design: .serif).weight(.semibold))
                .foregroundStyle(highlight ? Theme.accent : Theme.ink)
            Text(label).font(Theme.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
        .accessibilityElement(children: .combine)
    }
}

private struct Bar: View {
    let name: String
    let count: Int
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(name).font(Theme.label).foregroundStyle(Theme.ink)
                Spacer()
                Text("\(count)").font(Theme.trace).foregroundStyle(Theme.muted)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.traceBackground)
                    Capsule().fill(Theme.accent)
                        .frame(width: proxy.size.width * min(Double(count) / Double(max(total, 1)), 1))
                }
            }
            .frame(height: 6)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct Row: View {
    let title: String
    var subtitle: String?
    let trailing: String
    var highlight = false
    var mono = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.label).foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle).font(Theme.caption).foregroundStyle(Theme.muted)
                }
            }
            Spacer()
            Text(trailing)
                .font(mono ? Theme.trace : Theme.caption)
                .foregroundStyle(highlight ? Theme.accent : Theme.muted)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct Empty: View {
    let text: String

    var body: some View {
        Text(text).font(Theme.caption).foregroundStyle(Theme.muted)
    }
}

private func percent(_ part: Int, of whole: Int) -> String {
    whole == 0 ? "–" : "\(Int((Double(part) / Double(whole) * 100).rounded()))%"
}

// Postgres timestamps carry microseconds, which ISO8601DateFormatter can't read; drop them first.
private func relative(_ timestamp: String) -> String {
    let trimmed = timestamp.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
    guard let date = ISO8601DateFormatter().date(from: trimmed) else { return "" }
    return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: .now)
}
