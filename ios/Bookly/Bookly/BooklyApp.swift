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
