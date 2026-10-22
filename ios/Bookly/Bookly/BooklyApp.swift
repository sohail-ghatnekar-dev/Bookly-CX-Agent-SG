// App entry point: one navigation stack with the chat screen.
import SwiftUI

@main
struct BooklyApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ChatView()
            }
            .tint(Theme.accent)
        }
    }
}
