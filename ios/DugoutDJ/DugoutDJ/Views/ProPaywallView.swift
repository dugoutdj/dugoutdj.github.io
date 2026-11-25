import SwiftUI

struct ProPaywallView: View {
    @EnvironmentObject private var proManager: ProManager
    @Environment(\.dismiss) private var dismiss

    var highlightReason: String? = nil

    private let privacyPolicyURL = URL(string: "https://dugoutdj.com/privacy.html")!
    private let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    var body: some View {
        NavigationStack {
            ZStack {
                DugoutBrandBackground()

                ScrollView {
                    VStack(spacing: 20) {
                        VStack(spacing: 10) {
                            DugoutLogoMark(size: 68, animated: true)
                                .shadow(color: .black.opacity(0.35), radius: 14, y: 6)

                            Text("Dugout DJ Pro")
                                .font(.title.weight(.bold))
                                .fontDesign(.rounded)
                                .foregroundStyle(.white)

                            Text("SEASON PASS · \(proManager.displayPrice) / YEAR")
                                .font(.caption.weight(.bold))
                                .tracking(0.8)
                                .foregroundStyle(DugoutColors.waveMint)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 5)
                                .background(DugoutColors.ledGreen.opacity(0.14), in: Capsule())
                                .overlay(
                                    Capsule().stroke(DugoutColors.ledGreen.opacity(0.45), lineWidth: 1)
                                )
                        }
                        .padding(.top, 8)

                        if let highlightReason, !highlightReason.isEmpty {
                            HStack(spacing: 8) {
                                Image(systemName: "sparkles")
                                    .foregroundStyle(DugoutColors.waveMint)
                                Text(highlightReason)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.leading)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                        }

                        VStack(alignment: .leading, spacing: 16) {
                            featureRow(
                                icon: "speaker.wave.2.fill",
                                title: "AI Stadium Announcer",
                                detail: "Custom pre-song batter introductions (\"Now batting, #12…\") cached for game day."
                            )
                            Divider()
                            featureRow(
                                icon: "music.note.list",
                                title: "Top 300 Walk-Up Songs & 30s Clips",
                                detail: "Filter 300 pre-timed walk-up hits and extend any player's clip up to 30 seconds (15s on Free)."
                            )
                            Divider()
                            featureRow(
                                icon: "person.3.fill",
                                title: "Unlimited Teams",
                                detail: "Run separate lineups for travel, rec, and tournament squads (Free includes 1 team)."
                            )
                        }
                        .padding(18)
                        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 18))
                        .shadow(color: .black.opacity(0.22), radius: 16, y: 8)

                        if let status = proManager.statusMessage {
                            statusBanner(text: status, icon: "checkmark.circle.fill", tint: .green)
                        }

                        if let error = proManager.errorMessage {
                            statusBanner(text: error, icon: "exclamationmark.triangle.fill", tint: .orange)
                        }

                        VStack(spacing: 12) {
                            Button {
                                Task {
                                    let unlocked = await proManager.purchaseYearly()
                                    if unlocked {
                                        dismiss()
                                    }
                                }
                            } label: {
                                HStack(spacing: 8) {
                                    if proManager.isPurchasing {
                                        ProgressView()
                                            .tint(.white)
                                    }
                                    Text(
                                        proManager.isPurchasing
                                            ? "Processing…"
                                            : "Unlock Season Pass · \(proManager.displayPrice)/yr"
                                    )
                                    .fontWeight(.bold)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(proManager.isPurchasing)

                            Button {
                                Task {
                                    await proManager.restorePurchases()
                                    if proManager.isPro {
                                        dismiss()
                                    }
                                }
                            } label: {
                                Text("Restore Purchases")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.white.opacity(0.9))
                                    .padding(.vertical, 6)
                            }
                            .disabled(proManager.isPurchasing)
                        }

                        VStack(spacing: 6) {
                            Text("Dugout DJ Pro Season Pass (\(proManager.displayPrice)/year) automatically renews annually unless canceled at least 24 hours before the end of the current period. Manage or cancel anytime in App Store Account Settings.")
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.68))
                                .multilineTextAlignment(.center)

                            HStack(spacing: 10) {
                                Link("Privacy Policy", destination: privacyPolicyURL)
                                Text("·")
                                Link("Terms of Use", destination: termsURL)
                            }
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(DugoutColors.waveMint)
                        }
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 28)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                    .foregroundStyle(.white)
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .task {
                if proManager.yearlyProduct == nil {
                    await proManager.refreshProduct()
                }
            }
        }
    }

    private func featureRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func statusBanner(text: String, icon: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(text)
                .font(.caption)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(tint.opacity(0.2), in: RoundedRectangle(cornerRadius: 10))
    }
}
