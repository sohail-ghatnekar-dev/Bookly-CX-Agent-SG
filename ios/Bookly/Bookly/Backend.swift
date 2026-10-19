import Foundation
import Supabase

// URL and anon key come from Config.xcconfig via Info.plist. The app never holds any other key.
enum AppConfig {
    static let supabaseURL: URL = {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String,
              let url = URL(string: value), url.host != nil
        else { fatalError("Set SUPABASE_URL in ios/Bookly/Config.xcconfig (see Config.example.xcconfig).") }
        return url
    }()

    static let supabaseAnonKey: String = {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String, !key.isEmpty
        else { fatalError("Set SUPABASE_ANON_KEY in ios/Bookly/Config.xcconfig (see Config.example.xcconfig).") }
        return key
    }()
}

let supabase = SupabaseClient(supabaseURL: AppConfig.supabaseURL, supabaseKey: AppConfig.supabaseAnonKey)

struct TraceLine: Decodable, Hashable {
    let seq: Int
    let kind: String
    let label: String
    let detail: String
    let outcome: String
    let ruleId: String?
    let ms: Int
}

struct Escalation: Decodable, Hashable {
    let summary: String
    let verified: Bool
    let ruleIds: [String]
    let customerName: String?
}

struct AgentReply: Decodable {
    let conversationId: String
    let turn: Int
    let reply: String
    let status: String
    let citations: [String]
    let suggestions: [String]?
    let trace: [TraceLine]
    let escalation: Escalation?
}

struct Procedure: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let version: Int
    let body: String
    let isActive: Bool
}

struct EvalRun: Decodable {
    let model: String
    let total: Int
    let passed: Int
    let resolved: Int
    let escalated: Int
}

// A reloaded conversation: text turns only, with trace events grouped by turn.
struct History {
    struct Turn {
        let user: String
        let reply: String?
        let trace: [TraceLine]
    }

    let status: String
    let turns: [Turn]
    let escalation: Escalation?
}

enum BackendError: LocalizedError {
    case message(String)
    case conversationGone
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return nil
    }
}

enum Backend {
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()

    private struct AgentRequest: Encodable {
        let conversationId: String?
        let message: String
    }

    // The anonymous session persists in the keychain, so a relaunch keeps the same user and conversation.
    static func signInIfNeeded() async throws {
        do {
            _ = try await supabase.auth.session
        } catch {
            try await supabase.auth.signInAnonymously()
        }
    }

    static func send(_ message: String, conversationId: String?) async throws -> AgentReply {
        try await signInIfNeeded()
        do {
            return try await supabase.functions.invoke(
                "agent",
                options: FunctionInvokeOptions(
                    body: AgentRequest(conversationId: conversationId, message: message),
                    encoder: encoder
                ),
                decoder: decoder
            )
        } catch FunctionsError.httpError(let code, _) where code == 404 {
            throw BackendError.conversationGone
        } catch FunctionsError.httpError(let code, let data) where code == 429 || code == 400 {
            // The function's own friendly errors (message limit, bad input) are shown as written.
            let body = try? JSONDecoder().decode([String: String].self, from: data)
            throw BackendError.message(body?["error"] ?? "Couldn't reach Bookly support. Try again.")
        }
    }

    static func history(conversationId: String) async throws -> History? {
        try await signInIfNeeded()
        struct ConversationRow: Decodable { let status: String }
        struct MessageRow: Decodable {
            struct Block: Decodable { let type: String; let text: String? }
            let turn: Int
            let role: String
            let content: [Block]
        }
        struct TraceRow: Decodable {
            let turn: Int, seq: Int, kind: String, label: String, detail: String, outcome: String, ruleId: String?, ms: Int
        }

        let conversations: [ConversationRow] = try await rows(
            supabase.from("conversations").select("status").eq("id", value: conversationId)
        )
        guard let conversation = conversations.first else { return nil }

        let messages: [MessageRow] = try await rows(
            supabase.from("messages").select("turn, role, content")
                .eq("conversation_id", value: conversationId).order("seq")
        )
        let trace: [TraceRow] = try await rows(
            supabase.from("trace_events").select("turn, seq, kind, label, detail, outcome, rule_id, ms")
                .eq("conversation_id", value: conversationId).order("seq")
        )
        let escalations: [Escalation] = try await rows(
            supabase.from("escalations").select("summary, verified, rule_ids, customer_name")
                .eq("conversation_id", value: conversationId).order("created_at", ascending: false).limit(1)
        )

        let text = { (row: MessageRow) in
            row.content.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n")
        }
        let turnNumbers = Array(Set(messages.map(\.turn))).sorted()
        let turns = turnNumbers.map { number in
            let inTurn = messages.filter { $0.turn == number }
            let user = inTurn.first { $0.role == "user" }.map(text) ?? ""
            let reply = inTurn.last { $0.role == "assistant" }.map(text)
            let events = trace.filter { $0.turn == number }.map {
                TraceLine(seq: $0.seq, kind: $0.kind, label: $0.label, detail: $0.detail,
                          outcome: $0.outcome, ruleId: $0.ruleId, ms: $0.ms)
            }
            return History.Turn(user: user, reply: reply, trace: events)
        }
        return History(status: conversation.status, turns: turns, escalation: escalations.first)
    }

    // Red-team versions never reach the app: RLS hides them.
    static func procedures() async throws -> [Procedure] {
        try await signInIfNeeded()
        return try await rows(
            supabase.from("procedures").select("id, name, version, body, is_active")
                .order("name").order("version", ascending: false)
        )
    }

    static func latestEvalRun() async throws -> EvalRun? {
        try await signInIfNeeded()
        let runs: [EvalRun] = try await rows(
            supabase.from("eval_runs").select("model, total, passed, resolved, escalated")
                .order("ran_at", ascending: false).limit(1)
        )
        return runs.first
    }

    private static func rows<T: Decodable>(_ query: PostgrestBuilder) async throws -> [T] {
        try decoder.decode([T].self, from: try await query.execute().data)
    }
}
