import SwiftUI

// Read-only view of the plain-English procedures the agent follows, with version history.
struct ProceduresView: View {
    @State private var procedures: [Procedure] = []
    @State private var evalRun: EvalRun?
    @State private var loadFailed = false

    private var groups: [(name: String, versions: [Procedure])] {
        Dictionary(grouping: procedures, by: \.name)
            .map { (name: $0.key, versions: $0.value.sorted { $0.version > $1.version }) }
            .sorted { $0.name < $1.name }
    }

    var body: some View {
        List {
            Section {
                ForEach(groups, id: \.name) { group in
                    NavigationLink {
                        ProcedureDetail(name: group.name, versions: group.versions)
                    } label: {
                        HStack {
                            Text(displayName(group.name)).font(Theme.prose).foregroundStyle(Theme.ink)
                            Spacer()
                            if let active = group.versions.first(where: \.isActive) {
                                Badge(text: "active v\(active.version)")
                            }
                        }
                    }
                    .listRowBackground(Theme.card)
                }
            } footer: {
                evalFooter.padding(.top, 16)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.paper.ignoresSafeArea())
        .navigationTitle("Procedures")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if loadFailed { Text(Backend.networkError).font(Theme.label).foregroundStyle(Theme.muted) }
        }
        .task {
            do {
                procedures = try await Backend.procedures()
                evalRun = try await Backend.latestEvalRun()
            } catch {
                loadFailed = true
            }
        }
    }

    private var evalFooter: some View {
        Text(evalRun.map {
            "\($0.model) · \($0.passed) of \($0.total) passed · \($0.resolved) resolved · \($0.escalated) escalated"
        } ?? "No eval run yet.")
            .font(Theme.caption)
            .foregroundStyle(Theme.muted)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
    }
}

struct ProcedureDetail: View {
    let name: String
    let versions: [Procedure]
    @State private var selected: Procedure?

    private var shown: Procedure? { selected ?? versions.first(where: \.isActive) ?? versions.first }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let shown {
                    HStack(alignment: .firstTextBaseline) {
                        Text(displayName(name)).font(Theme.display).foregroundStyle(Theme.ink)
                        Spacer()
                        Badge(text: shown.isActive ? "active v\(shown.version)" : "v\(shown.version)")
                    }
                    Text(shown.body)
                        .font(Theme.prose)
                        .foregroundStyle(Theme.ink)
                        .lineSpacing(5)
                        .textSelection(.enabled)
                }
                Rectangle().fill(Theme.hairline).frame(height: Theme.hairlineWidth)
                Text("Version history").font(Theme.heading).foregroundStyle(Theme.ink)
                ForEach(versions) { version in
                    Button { selected = version } label: {
                        HStack {
                            Text("Version \(version.version)").font(Theme.label)
                            Spacer()
                            Text(version.isActive ? "active" : "inactive").font(Theme.caption)
                                .foregroundStyle(Theme.muted)
                        }
                        .foregroundStyle(version.id == shown?.id ? Theme.accent : Theme.ink)
                        .padding(.vertical, 6)
                    }
                    .accessibilityAddTraits(version.id == shown?.id ? .isSelected : [])
                }
            }
            .padding(16)
        }
        .background(Theme.paper.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct Badge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.caption)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(Theme.accent, lineWidth: Theme.hairlineWidth))
    }
}

private func displayName(_ name: String) -> String {
    ["order_status": "Order status", "returns": "Returns", "policy_qa": "Policy questions"][name] ?? name
}
