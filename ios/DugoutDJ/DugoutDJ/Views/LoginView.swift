import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var authManager: AuthManager

    @State private var email = ""
    @State private var pastedLink = ""
    @State private var showTokenInput = false

    var body: some View {
        ZStack {
            DugoutBrandBackground()

            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 12) {
                        DugoutLogoMark(size: 78, animated: true)
                            .shadow(color: .black.opacity(0.35), radius: 14, y: 6)

                        Text("Dugout DJ")
                            .font(.largeTitle.weight(.bold))
                            .fontDesign(.rounded)
                            .foregroundStyle(.white)

                        Text("WALK-UP SONG MANAGER")
                            .font(.caption2.weight(.bold))
                            .tracking(0.8)
                            .foregroundStyle(DugoutColors.waveMint)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(DugoutColors.ledGreen.opacity(0.14), in: Capsule())
                            .overlay(
                                Capsule().stroke(DugoutColors.ledGreen.opacity(0.45), lineWidth: 1)
                            )

                        Text("Sign in to sync your teams and walk-up rosters across your iPhone and the web.")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.82))
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 28)

                    VStack(alignment: .leading, spacing: 16) {
                        Text("Coach Sign In")
                            .font(.title3.bold())

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Email address")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            TextField("coach@dugoutdj.com", text: $email)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .padding(12)
                                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                        }

                        Button {
                            Task {
                                let sent = await authManager.requestLoginLink(email: email)
                                if sent {
                                    showTokenInput = true
                                }
                            }
                        } label: {
                            HStack {
                                if authManager.isWorking && !showTokenInput {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text(authManager.isWorking ? "Sending…" : "Email my sign-in link")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(authManager.isWorking || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        if let info = authManager.infoMessage {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "envelope.badge.fill")
                                    .foregroundStyle(.green)
                                Text(info)
                                    .font(.caption)
                                    .foregroundStyle(.primary)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                        }

                        if let error = authManager.errorMessage {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                Text(error)
                                    .font(.caption)
                                    .foregroundStyle(.primary)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                        }

                        Divider()

                        DisclosureGroup("Already have a sign-in link or token?", isExpanded: $showTokenInput) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Tap the link in your email to open Dugout DJ automatically, or paste your sign-in link or code below.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                TextField("dugoutdj://login?token=... or token", text: $pastedLink)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .font(.footnote.monospaced())
                                    .padding(10)
                                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))

                                Button {
                                    Task {
                                        await authManager.verifyLoginInput(pastedLink)
                                    }
                                } label: {
                                    Text("Verify & Sign In")
                                        .fontWeight(.semibold)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 10)
                                }
                                .buttonStyle(.bordered)
                                .disabled(authManager.isWorking || pastedLink.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                            .padding(.top, 8)
                        }
                        .font(.subheadline.weight(.medium))
                    }
                    .padding(20)
                    .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 18))
                    .shadow(color: .black.opacity(0.22), radius: 18, y: 8)

                    VStack(spacing: 10) {
                        Button {
                            authManager.continueWithoutAccount()
                        } label: {
                            Text("Continue without an account")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 10)
                                .background(.white.opacity(0.14), in: Capsule())
                        }
                        .disabled(authManager.isWorking)

                        HStack(spacing: 6) {
                            Text("Password-free email sign-in")
                            Text("·")
                            Link("Privacy Policy", destination: URL(string: "https://dugoutdj.com/privacy.html")!)
                                .foregroundStyle(DugoutColors.waveMint)
                        }
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                    }
                }
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
        }
    }
}
