import Foundation

@MainActor
final class AuthManager: ObservableObject {
    enum AuthState: Equatable {
        case loading
        case signedOut
        case guest
        case signedIn(email: String)

        var isSignedIn: Bool {
            if case .signedIn = self { return true }
            return false
        }
    }

    @Published private(set) var state: AuthState = .loading
    @Published private(set) var sessionToken: String?
    @Published var isWorking: Bool = false
    @Published var errorMessage: String?
    @Published var infoMessage: String?

    private static let tokenKey = "sessionToken"
    private static let emailKey = "coachEmail"
    private var didBootstrap = false

    func bootstrap() async {
        guard !didBootstrap else { return }
        didBootstrap = true

        let started = Date()
        let savedToken = KeychainHelper.read(key: Self.tokenKey)
        let savedEmail = KeychainHelper.read(key: Self.emailKey)

        var resolvedState: AuthState = .signedOut
        var resolvedToken: String? = nil

        if let token = savedToken, !token.isEmpty {
            do {
                let me = try await DugoutAPI.fetchCurrentCoach(token: token)
                if me.authenticated, let email = me.email, !email.isEmpty {
                    KeychainHelper.save(email, key: Self.emailKey)
                    resolvedToken = token
                    resolvedState = .signedIn(email: email)
                } else {
                    clearStoredSession()
                }
            } catch {
                // Keep cached credentials if offline so coaches aren't locked out at the field.
                if let savedEmail, !savedEmail.isEmpty {
                    resolvedToken = token
                    resolvedState = .signedIn(email: savedEmail)
                } else {
                    clearStoredSession()
                }
            }
        }

        let elapsed = Date().timeIntervalSince(started)
        if elapsed < 0.7 {
            try? await Task.sleep(nanoseconds: UInt64((0.7 - elapsed) * 1_000_000_000))
        }

        sessionToken = resolvedToken
        state = resolvedState
    }

    func requestLoginLink(email: String) async -> Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else {
            errorMessage = "Enter your email address."
            return false
        }

        isWorking = true
        errorMessage = nil
        infoMessage = nil
        defer { isWorking = false }

        do {
            try await DugoutAPI.requestLoginLink(email: trimmed, platform: "ios")
            infoMessage = "Sign-in link sent to \(trimmed). Tap the link in your email or paste it below."
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func verifyLoginInput(_ rawInput: String) async {
        guard let token = extractLoginToken(from: rawInput) else {
            errorMessage = "Paste the full sign-in link from your email or the login token."
            return
        }
        await verifyToken(token)
    }

    func handleIncomingURL(_ url: URL) async {
        guard let token = extractLoginToken(from: url.absoluteString) else { return }
        await verifyToken(token)
    }

    func continueWithoutAccount() {
        errorMessage = nil
        infoMessage = nil
        state = .guest
    }

    func promptSignIn() {
        errorMessage = nil
        infoMessage = nil
        state = .signedOut
    }

    func signOut() async {
        if let token = sessionToken {
            await DugoutAPI.logout(token: token)
        }
        clearStoredSession()
        sessionToken = nil
        errorMessage = nil
        infoMessage = nil
        state = .signedOut
    }

    func deleteAccount() async throws {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        if let token = sessionToken, !token.isEmpty {
            try await DugoutAPI.deleteAccount(token: token)
        }
        clearStoredSession()
        sessionToken = nil
        infoMessage = nil
        state = .signedOut
    }

    private func verifyToken(_ rawToken: String) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            let result = try await DugoutAPI.verifyLoginToken(rawToken)
            guard let session = result.sessionToken, !session.isEmpty else {
                errorMessage = "Server did not return a mobile session token."
                return
            }
            KeychainHelper.save(session, key: Self.tokenKey)
            KeychainHelper.save(result.email, key: Self.emailKey)
            sessionToken = session
            infoMessage = nil
            state = .signedIn(email: result.email)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func clearStoredSession() {
        KeychainHelper.delete(key: Self.tokenKey)
        KeychainHelper.delete(key: Self.emailKey)
    }

    private func extractLoginToken(from rawInput: String) -> String? {
        let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let components = URLComponents(string: trimmed),
           let items = components.queryItems {
            if let token = items.first(where: { $0.name == "token" || $0.name == "login" })?.value,
               !token.isEmpty {
                return token
            }
        }

        // Fallback if the user pasted a raw token without spaces or URL wrappers.
        if !trimmed.contains(" ") && !trimmed.contains("://") && !trimmed.contains("/") {
            return trimmed
        }
        return nil
    }
}
