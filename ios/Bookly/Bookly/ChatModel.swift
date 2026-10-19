import Foundation
import Observation

@Observable
@MainActor
final class ChatModel {
    struct Turn: Identifiable {
        let id = UUID()
        let user: String
        var reply: String?
        var trace: [TraceLine] = []
        var citations: [String] = []
    }

    private static let conversationKey = "conversationId"
    static let networkError = "Couldn't reach Bookly support. Try again."

    var turns: [Turn] = []
    var isEscalated = false
    var escalation: Escalation?
    // Tap-to-answer options for the latest reply. Typing always works too.
    var suggestions: [String] = []
    /// The reply that just came in, so its avatar can play the bookworm's return.
    private(set) var arrivedTurnID: UUID?
    var isSending = false
    var error: String?
    private var failedMessage: String?

    private var conversationId: String? = UserDefaults.standard.string(forKey: conversationKey) {
        didSet { UserDefaults.standard.set(conversationId, forKey: Self.conversationKey) }
    }

    var canRetry: Bool { failedMessage != nil }

    func load() async {
        guard let conversationId, turns.isEmpty else { return }
        let history: History?
        do {
            history = try await Backend.history(conversationId: conversationId)
        } catch {
            return  // Offline: keep the id and try again next launch.
        }
        // The saved conversation no longer exists (cleaned up, or a different device session).
        guard let history else {
            self.conversationId = nil
            return
        }
        turns = history.turns.map { turn in
            let (reply, citations) = Self.splitSources(turn.reply ?? "", trace: turn.trace)
            return Turn(user: turn.user, reply: reply, trace: turn.trace, citations: citations)
        }
        isEscalated = history.status == "escalated"
        escalation = history.escalation
    }

    func send(_ text: String) async {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !isSending else { return }
        turns.append(Turn(user: message))
        await deliver(message)
    }

    func retry() async {
        guard let failedMessage, !isSending else { return }
        await deliver(failedMessage)
    }

    func newConversation() {
        conversationId = nil
        turns = []
        isEscalated = false
        escalation = nil
        suggestions = []
        arrivedTurnID = nil
        error = nil
        failedMessage = nil
    }

    private func deliver(_ message: String, retryingAsNew: Bool = false) async {
        isSending = true
        error = nil
        failedMessage = nil
        suggestions = []
        defer { isSending = false }
        do {
            let response = try await Backend.send(message, conversationId: conversationId)
            conversationId = response.conversationId
            if !turns.isEmpty {
                arrivedTurnID = turns[turns.count - 1].id
                turns[turns.count - 1].reply = response.reply
                turns[turns.count - 1].trace = response.trace
                turns[turns.count - 1].citations = response.citations
            }
            isEscalated = response.status == "escalated"
            escalation = response.escalation ?? escalation
            suggestions = response.suggestions ?? []
        } catch BackendError.conversationGone where !retryingAsNew {
            // The server no longer has this conversation: start a new one with the same message.
            await startOver(with: message)
        } catch BackendError.sessionExpired where !retryingAsNew {
            // This device's anonymous session is gone. Customers never log in, so just get a new one.
            try? await Backend.startFreshSession()
            await startOver(with: message)
        } catch {
            failedMessage = message
            self.error = (error as? BackendError)?.errorDescription ?? Self.networkError
        }
    }

    private func startOver(with message: String) async {
        conversationId = nil
        isSending = false
        await deliver(message, retryingAsNew: true)
    }

    // Live replies arrive with the Sources line already stripped; stored ones still carry it.
    private static func splitSources(_ reply: String, trace: [TraceLine]) -> (String, [String]) {
        let stripped = reply.replacingOccurrences(
            of: #"\n?[ \t]*Sources?:[^\n]*$"#, with: "", options: .regularExpression
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        let citations = trace.filter { $0.label == "sources" && $0.outcome == "ok" }
            .flatMap { $0.detail.components(separatedBy: ", ") }
        return (stripped, citations)
    }
}
