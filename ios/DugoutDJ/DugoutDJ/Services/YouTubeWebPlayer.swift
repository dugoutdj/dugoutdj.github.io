import Foundation
import WebKit

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

@MainActor
final class YouTubeWebPlayer: NSObject, ObservableObject, WKScriptMessageHandler {
    let webView: WKWebView

    var onProgress: ((Double, Double) -> Void)?
    var onFinish: (() -> Void)?
    var onError: ((String) -> Void)?

    private var isReady = false
    private var pendingCommand: (videoId: String, startSeconds: Double, duration: Double)?

    override init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let controller = WKUserContentController()
        config.userContentController = controller

        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 180), configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        self.webView = webView

        super.init()

        controller.add(WeakScriptMessageHandler(self), name: "ytEvent")
        loadPlayerHTML()
    }

    func play(videoId: String, startSeconds: Double, duration: Double) {
        let safeStart = max(0, startSeconds)
        let safeDuration = max(1, duration)
        if !isReady {
            pendingCommand = (videoId, safeStart, safeDuration)
            return
        }
        pendingCommand = nil
        let escapedID = videoId.replacingOccurrences(of: "'", with: "\\'")
        evaluate("window.dugoutPlay('\(escapedID)', \(safeStart), \(safeDuration));")
    }

    func pause() {
        evaluate("window.dugoutPause();")
    }

    func resume() {
        evaluate("window.dugoutResume();")
    }

    func stop() {
        pendingCommand = nil
        evaluate("window.dugoutStop();")
    }

    private func evaluate(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func loadPlayerHTML() {
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <style>
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              background: #000;
              overflow: hidden;
            }
            #player {
              width: 100%;
              height: 100%;
            }
          </style>
        </head>
        <body>
          <div id="player"></div>
          <script src="https://www.youtube.com/iframe_api"></script>
          <script>
            let player = null;
            let playerReady = false;
            let activeVideoId = '';
            let activeStart = 0;
            let activeDuration = 10;
            let activeEnd = 10;
            let pollTimer = null;
            let isStopping = false;

            function post(type, payload) {
              try {
                window.webkit.messageHandlers.ytEvent.postMessage(Object.assign({ type }, payload || {}));
              } catch (e) {}
            }

            function clearPoll() {
              if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
            }

            function startPoll() {
              clearPoll();
              pollTimer = setInterval(() => {
                if (!player || !playerReady || !activeVideoId || isStopping) return;
                try {
                  const state = player.getPlayerState();
                  if (state !== 1) return;
                  const vd = typeof player.getVideoData === 'function' ? player.getVideoData() : null;
                  if (vd && vd.video_id && vd.video_id !== activeVideoId) {
                    // Pre-roll ad is playing; wait until the requested song starts.
                    return;
                  }
                  const t = Number(player.getCurrentTime()) || 0;
                  const elapsed = Math.max(0, t - activeStart);
                  post('progress', { elapsed: Math.min(activeDuration, elapsed), total: activeDuration });
                  if (t >= activeEnd) {
                    isStopping = true;
                    clearPoll();
                    player.pauseVideo();
                    activeVideoId = '';
                    post('ended');
                  }
                } catch (e) {}
              }, 120);
            }

            window.onYouTubeIframeAPIReady = function() {
              player = new YT.Player('player', {
                width: '100%',
                height: '100%',
                playerVars: {
                  playsinline: 1,
                  controls: 1,
                  rel: 0,
                  modestbranding: 1,
                  origin: 'https://dugoutdj.com'
                },
                events: {
                  onReady: function() {
                    playerReady = true;
                    post('ready');
                  },
                  onStateChange: function(event) {
                    if (!activeVideoId || isStopping) return;
                    if (event.data === YT.PlayerState.PLAYING) {
                      startPoll();
                    } else if (event.data === YT.PlayerState.ENDED) {
                      const vd = typeof player.getVideoData === 'function' ? player.getVideoData() : null;
                      if (!vd || !vd.video_id || vd.video_id === activeVideoId) {
                        isStopping = true;
                        clearPoll();
                        activeVideoId = '';
                        post('ended');
                      }
                    }
                  },
                  onError: function(event) {
                    clearPoll();
                    activeVideoId = '';
                    post('error', { code: event && event.data ? Number(event.data) : 0 });
                  }
                }
              });
            };

            window.dugoutPlay = function(videoId, startSec, durationSec) {
              if (!player || !playerReady) return;
              isStopping = false;
              activeVideoId = videoId;
              activeStart = Math.max(0, Number(startSec) || 0);
              activeDuration = Math.max(1, Number(durationSec) || 10);
              activeEnd = activeStart + activeDuration;
              player.setVolume(100);
              player.unMute();
              player.loadVideoById({ videoId: activeVideoId, startSeconds: activeStart });
              player.playVideo();
              startPoll();
            };

            window.dugoutPause = function() {
              clearPoll();
              if (player && playerReady) {
                try { player.pauseVideo(); } catch (e) {}
              }
            };

            window.dugoutResume = function() {
              if (player && playerReady && activeVideoId) {
                isStopping = false;
                try { player.playVideo(); } catch (e) {}
                startPoll();
              }
            };

            window.dugoutStop = function() {
              isStopping = true;
              clearPoll();
              activeVideoId = '';
              if (player && playerReady) {
                try { player.stopVideo(); } catch (e) {}
              }
            };
          </script>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://dugoutdj.com")!)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let dict = message.body as? [String: Any],
              let type = dict["type"] as? String else { return }

        let elapsed = dict["elapsed"] as? Double ?? 0
        let total = dict["total"] as? Double ?? 0
        let errorCode = dict["code"] as? Int ?? 0

        switch type {
        case "ready":
            isReady = true
            if let pending = pendingCommand {
                pendingCommand = nil
                play(videoId: pending.videoId, startSeconds: pending.startSeconds, duration: pending.duration)
            }
        case "progress":
            onProgress?(elapsed, total)
        case "ended":
            onFinish?()
        case "error":
            if errorCode == 101 || errorCode == 150 {
                onError?("This YouTube track doesn't allow embedding — try another version or pick from Apple Music / Audio File.")
            } else {
                onError?("Couldn't play this YouTube video (error \(errorCode)). Check your connection and link.")
            }
        default:
            break
        }
    }
}
