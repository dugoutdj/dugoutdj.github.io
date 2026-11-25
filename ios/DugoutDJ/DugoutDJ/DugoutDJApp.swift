import SwiftUI

@main
struct DugoutDJApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var authManager = AuthManager()
    @StateObject private var teamStore = TeamStore()
    @StateObject private var audioEngine = AudioEngine()
    @StateObject private var proManager = ProManager()

    var body: some Scene {
        WindowGroup {
            Group {
                switch authManager.state {
                case .loading:
                    SplashView()
                case .signedOut:
                    LoginView()
                        .environmentObject(authManager)
                case .guest, .signedIn:
                    ContentView()
                        .environmentObject(teamStore)
                        .environmentObject(audioEngine)
                        .environmentObject(authManager)
                        .environmentObject(proManager)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: authManager.state)
            .task {
                await authManager.bootstrap()
            }
            .task {
                await proManager.bootstrap()
            }
            .onOpenURL { url in
                Task {
                    await authManager.handleIncomingURL(url)
                }
            }
            .onChange(of: authManager.state) { _, newState in
                switch newState {
                case .signedIn:
                    teamStore.setAuthToken(authManager.sessionToken)
                    Task {
                        await teamStore.syncFromCloud()
                    }
                case .guest:
                    teamStore.setAuthToken(nil)
                case .signedOut:
                    teamStore.setAuthToken(nil)
                    audioEngine.stop()
                case .loading:
                    break
                }
            }
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase == .background && audioEngine.isYouTubeActive {
                    audioEngine.stop()
                }
            }
        }
    }
}
