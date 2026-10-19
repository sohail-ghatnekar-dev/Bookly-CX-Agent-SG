import SwiftUI

struct ChatView: View {
    @State private var model = ChatModel()
    @AppStorage("showTrace") private var showTrace = false
    @State private var draft = ""
    @State private var showProcedures = false

    private let starters = ["Where's my order?", "I'd like to return a book", "How long does shipping take?"]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if model.turns.isEmpty {
                        emptyState
                    }
                    ForEach(model.turns) { turn in
                        TurnView(turn: turn, showTrace: showTrace)
                    }
                    if model.isSending {
                        TypingIndicator()
                    }
                    if !model.isSending && !model.isEscalated && model.error == nil && !model.suggestions.isEmpty {
                        SuggestionRow(options: model.suggestions) { option in
                            Task { await model.send(option) }
                        }
                    }
                    if let error = model.error {
                        ErrorRow(text: error, canRetry: model.canRetry) {
                            Task { await model.retry() }
                        }
                    }
                    if model.isEscalated, let escalation = model.escalation {
                        HandoffCard(escalation: escalation) { model.newConversation() }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.turns.count) { scrollToBottom(proxy) }
            .onChange(of: model.isSending) { scrollToBottom(proxy) }
            .onChange(of: model.isEscalated) { scrollToBottom(proxy) }
            .onChange(of: model.suggestions) { scrollToBottom(proxy) }
        }
        .safeAreaInset(edge: .bottom) { inputBar }
        .background(Theme.paper.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.paper, for: .navigationBar)
        .toolbar { toolbar }
        .navigationDestination(isPresented: $showProcedures) { ProceduresView() }
        .task { await model.load() }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("How can we help?")
                .font(Theme.display)
                .foregroundStyle(Theme.ink)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(starters, id: \.self) { starter in
                    Chip(text: starter) { Task { await model.send(starter) } }
                }
            }
        }
        .padding(.top, 96)
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField(
                model.isEscalated ? "A Bookly employee has your case" : "Write a message",
                text: $draft,
                axis: .vertical
            )
            .font(Theme.prose)
            .foregroundStyle(Theme.ink)
            .lineLimit(1...4)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
            .onSubmit(submit)

            Button(action: submit) {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.paper)
                    .frame(width: 36, height: 36)
                    .background(Theme.ink, in: Circle())
            }
            .accessibilityLabel("Send")
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || model.isSending)
        }
        .disabled(model.isEscalated)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.paper)
        .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: Theme.hairlineWidth) }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text("Bookly").font(.system(.headline, design: .serif))
                Text("Order support").font(.system(.caption, design: .serif)).italic()
                    .foregroundStyle(Theme.muted)
            }
            .foregroundStyle(Theme.ink)
            .accessibilityElement(children: .combine)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { showTrace.toggle() } label: {
                Text("Trace")
                    .font(Theme.caption.weight(.medium))
                    .foregroundStyle(showTrace ? Theme.paper : Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(showTrace ? Theme.ink : Color.clear, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: Theme.hairlineWidth))
            }
            .accessibilityLabel("Show tool trace")
            .accessibilityValue(showTrace ? "On" : "Off")
            .accessibilityAddTraits(.isToggle)

            Menu {
                Button("New conversation") { model.newConversation() }
                Button("Procedures") { showProcedures = true }
            } label: {
                Image(systemName: "ellipsis.circle").foregroundStyle(Theme.ink)
            }
            .accessibilityLabel("More")
        }
    }

    private func submit() {
        let text = draft
        draft = ""
        Task { await model.send(text) }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
    }
}
