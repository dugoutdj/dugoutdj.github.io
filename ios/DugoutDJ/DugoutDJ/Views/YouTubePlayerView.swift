import SwiftUI
import WebKit

struct YouTubePlayerView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: .zero)
        container.backgroundColor = .clear
        attachWebView(to: container)
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        attachWebView(to: uiView)
    }

    private func attachWebView(to container: UIView) {
        if webView.superview !== container {
            webView.removeFromSuperview()
            webView.frame = container.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.addSubview(webView)
        }
    }
}
