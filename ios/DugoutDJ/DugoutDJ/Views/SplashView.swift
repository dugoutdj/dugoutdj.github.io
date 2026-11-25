import SwiftUI

struct SplashView: View {
    var body: some View {
        ZStack {
            DugoutBrandBackground()

            VStack(spacing: 22) {
                DugoutLogoMark(size: 112, animated: true)
                    .shadow(color: .black.opacity(0.4), radius: 18, y: 8)

                VStack(spacing: 10) {
                    Text("Dugout DJ")
                        .font(.largeTitle.weight(.bold))
                        .fontDesign(.rounded)
                        .foregroundStyle(.white)

                    Text("WALK-UP SONG MANAGER")
                        .font(.caption.weight(.bold))
                        .tracking(1.0)
                        .foregroundStyle(DugoutColors.waveMint)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .background(DugoutColors.ledGreen.opacity(0.14), in: Capsule())
                        .overlay(
                            Capsule().stroke(DugoutColors.ledGreen.opacity(0.45), lineWidth: 1)
                        )
                }

                VStack(spacing: 10) {
                    ProgressView()
                        .tint(DugoutColors.waveMint)
                        .scaleEffect(1.1)

                    Text("Loading your dugout…")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.72))
                }
                .padding(.top, 10)
            }
            .padding(32)
        }
    }
}
