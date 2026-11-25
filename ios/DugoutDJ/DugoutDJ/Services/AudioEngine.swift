import AVFoundation
import CryptoKit
import Foundation
import MediaPlayer

@MainActor
final class AudioEngine: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var activePlayerID: String?
    @Published var isPlaying: Bool = false
    @Published var isPaused: Bool = false
    @Published var isAnnouncing: Bool = false
    @Published var isYouTubeActive: Bool = false
    @Published var elapsed: Double = 0
    @Published var totalDuration: Double = 0
    @Published var errorMessage: String?

    let youtubePlayer = YouTubeWebPlayer()

    private let announcerCacheDir: URL
    private var announcementPlayer: AVAudioPlayer?
    private var clipPlayer: AVAudioPlayer?
    private var musicPlayer: MPMusicPlayerController?
    private var activeSource: SongSource = .none

    private var playbackTask: Task<Void, Never>?
    private var monitorTask: Task<Void, Never>?
    private var playbackToken = UUID()
    private var announcementContinuation: CheckedContinuation<Void, Never>?

    override init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        self.announcerCacheDir = caches.appendingPathComponent("DugoutDJ/announcer", isDirectory: true)
        super.init()
        try? FileManager.default.createDirectory(at: announcerCacheDir, withIntermediateDirectories: true)
        configureAudioSession()

        youtubePlayer.onProgress = { [weak self] currentElapsed, total in
            guard let self, self.activeSource == .youtube else { return }
            self.elapsed = currentElapsed
            if total > 0 {
                self.totalDuration = total
            }
        }
        youtubePlayer.onFinish = { [weak self] in
            guard let self, self.activeSource == .youtube else { return }
            self.stop(clearError: false)
        }
        youtubePlayer.onError = { [weak self] message in
            guard let self, self.activeSource == .youtube else { return }
            self.failPlayback(message: message)
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            // Keep going; individual playback paths still surface errors if audio fails.
        }
    }

    func play(player: Player, announcerEnabled: Bool, clipsDirectory: URL) {
        if activePlayerID == player.id && (isPlaying || isAnnouncing || isPaused) {
            stop()
            return
        }
        startPlayback(player: player, announcerEnabled: announcerEnabled, clipsDirectory: clipsDirectory)
    }

    func preview(player: Player, clipsDirectory: URL) {
        if activePlayerID == player.id && (isPlaying || isPaused) {
            stop()
            return
        }
        startPlayback(player: player, announcerEnabled: false, clipsDirectory: clipsDirectory)
    }

    func previewAnnouncement(name: String, number: String) {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else { return }

        stop()
        configureAudioSession()
        let token = UUID()
        playbackToken = token
        isAnnouncing = true

        playbackTask = Task { [weak self] in
            guard let self else { return }
            await self.runAnnouncement(name: cleanName, number: number, token: token)
            if self.playbackToken == token {
                self.isAnnouncing = false
            }
        }
    }

    func pause() {
        guard isPlaying, !isPaused else { return }
        monitorTask?.cancel()
        monitorTask = nil
        isPaused = true
        isPlaying = false

        switch activeSource {
        case .mediaLibrary:
            musicPlayer?.pause()
        case .localFile, .r2Clip, .preview:
            clipPlayer?.pause()
        case .youtube:
            youtubePlayer.pause()
        case .none:
            break
        }
    }

    func resume() {
        guard isPaused else { return }
        configureAudioSession()
        isPaused = false
        isPlaying = true

        switch activeSource {
        case .mediaLibrary:
            musicPlayer?.play()
            let remaining = max(0.5, totalDuration - elapsed)
            startMusicMonitor(token: playbackToken, duration: totalDuration, initialElapsed: elapsed, remaining: remaining)
        case .localFile, .r2Clip, .preview:
            clipPlayer?.volume = 1.0
            clipPlayer?.play()
            startClipMonitor(token: playbackToken, duration: totalDuration, initialElapsed: elapsed)
        case .youtube:
            youtubePlayer.resume()
        case .none:
            break
        }
    }

    func stop(clearError: Bool = true) {
        playbackToken = UUID()
        playbackTask?.cancel()
        playbackTask = nil
        monitorTask?.cancel()
        monitorTask = nil

        if let cont = announcementContinuation {
            announcementContinuation = nil
            cont.resume()
        }

        announcementPlayer?.stop()
        announcementPlayer = nil

        clipPlayer?.stop()
        clipPlayer = nil

        musicPlayer?.pause()
        musicPlayer = nil

        youtubePlayer.stop()

        activePlayerID = nil
        activeSource = .none
        isPlaying = false
        isPaused = false
        isAnnouncing = false
        isYouTubeActive = false
        elapsed = 0
        totalDuration = 0
        if clearError {
            errorMessage = nil
        }
    }

    // MARK: - Playback Pipeline

    private func startPlayback(player: Player, announcerEnabled: Bool, clipsDirectory: URL) {
        guard player.hasSong else {
            stop(clearError: false)
            errorMessage = "No song configured for \(player.name)."
            return
        }

        stop(clearError: true)
        configureAudioSession()

        let token = UUID()
        playbackToken = token
        activePlayerID = player.id
        totalDuration = max(1, player.duration)
        elapsed = 0

        playbackTask = Task { [weak self] in
            guard let self else { return }

            if announcerEnabled {
                self.isAnnouncing = true
                await self.runAnnouncement(
                    name: player.effectivePronounced,
                    number: player.number,
                    token: token
                )
                guard !Task.isCancelled, self.playbackToken == token else { return }
                self.isAnnouncing = false
            }

            await self.startWalkUpClip(player: player, clipsDirectory: clipsDirectory, token: token)
        }
    }

    private func runAnnouncement(name: String, number: String, token: UUID) async {
        let cacheURL = announcementCacheURL(name: name, number: number)
        var audioData: Data?

        if let cached = try? Data(contentsOf: cacheURL), !cached.isEmpty {
            audioData = cached
        } else if let fetched = try? await DugoutAPI.fetchAnnouncement(name: name, number: number) {
            audioData = fetched
            try? fetched.write(to: cacheURL, options: .atomic)
        }

        guard !Task.isCancelled, playbackToken == token, let data = audioData else {
            return
        }

        do {
            let avPlayer = try AVAudioPlayer(data: data)
            avPlayer.delegate = self
            avPlayer.prepareToPlay()
            self.announcementPlayer = avPlayer
            avPlayer.play()

            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                if self.playbackToken != token || !avPlayer.isPlaying {
                    continuation.resume()
                } else {
                    self.announcementContinuation = continuation
                }
            }
        } catch {
            // Skip announcement quietly so the walk-up song still plays.
        }
    }

    private func startWalkUpClip(player: Player, clipsDirectory: URL, token: UUID) async {
        guard !Task.isCancelled, playbackToken == token else { return }
        activeSource = player.songSource

        switch player.songSource {
        case .mediaLibrary:
            await playMediaLibraryTrack(player: player, token: token)
        case .localFile:
            guard let fileName = player.localFileName, !fileName.isEmpty else {
                failPlayback(message: "Audio file is missing for \(player.name).")
                return
            }
            let url = clipsDirectory.appendingPathComponent(fileName)
            playLocalAudioURL(url, startTime: player.startTime, duration: player.duration, token: token)
        case .r2Clip:
            guard let key = player.mp3Key, !key.isEmpty else {
                failPlayback(message: "Parent clip is missing for \(player.name).")
                return
            }
            let cachedURL = clipsDirectory.appendingPathComponent(key)
            if !FileManager.default.fileExists(atPath: cachedURL.path) {
                do {
                    let data = try await DugoutAPI.downloadClip(mp3Key: key)
                    guard !Task.isCancelled, playbackToken == token else { return }
                    try data.write(to: cachedURL, options: .atomic)
                } catch {
                    failPlayback(message: "Couldn't download clip: \(error.localizedDescription)")
                    return
                }
            }
            // R2 clips are already trimmed to the walk-up window when uploaded.
            playLocalAudioURL(cachedURL, startTime: 0, duration: player.duration, token: token)
        case .preview:
            guard let rawURL = player.previewURL, !rawURL.isEmpty else {
                failPlayback(message: "Preview audio is missing for \(player.name).")
                return
            }
            let cachedURL = previewCacheURL(for: rawURL, in: clipsDirectory)
            if !FileManager.default.fileExists(atPath: cachedURL.path) {
                do {
                    let data = try await DugoutAPI.downloadPreviewAudio(previewURL: rawURL)
                    guard !Task.isCancelled, playbackToken == token else { return }
                    try data.write(to: cachedURL, options: .atomic)
                } catch {
                    failPlayback(message: "Couldn't load audio preview: \(error.localizedDescription)")
                    return
                }
            }
            playLocalAudioURL(cachedURL, startTime: player.startTime, duration: player.duration, token: token)
        case .youtube:
            guard let vid = player.songVideoId, !vid.isEmpty else {
                failPlayback(message: "YouTube link is missing for \(player.name).")
                return
            }
            isYouTubeActive = true
            isPlaying = true
            isPaused = false
            totalDuration = max(1, player.duration)
            elapsed = 0
            youtubePlayer.play(videoId: vid, startSeconds: player.startTime, duration: player.duration)
        case .none:
            failPlayback(message: "No song configured for \(player.name).")
        }
    }

    private func playLocalAudioURL(_ url: URL, startTime: Double, duration: Double, token: UUID) {
        guard FileManager.default.fileExists(atPath: url.path) else {
            failPlayback(message: "Audio file could not be found on this device.")
            return
        }

        do {
            let avPlayer = try AVAudioPlayer(contentsOf: url)
            avPlayer.delegate = self
            let safeStart = max(0, min(startTime, max(0, avPlayer.duration - 0.5)))
            let effectiveDuration = max(1, min(duration, max(1, avPlayer.duration - safeStart)))

            avPlayer.currentTime = safeStart
            avPlayer.volume = 0
            avPlayer.prepareToPlay()
            avPlayer.play()

            self.clipPlayer = avPlayer
            self.totalDuration = effectiveDuration
            self.elapsed = 0
            self.isPlaying = true
            self.isPaused = false

            startClipMonitor(token: token, duration: effectiveDuration, initialElapsed: 0)
        } catch {
            failPlayback(message: "Unable to play audio file: \(error.localizedDescription)")
        }
    }

    private func playMediaLibraryTrack(player: Player, token: UUID) async {
        #if targetEnvironment(simulator)
        failPlayback(message: "Apple Music library playback requires a physical iPhone or iPad. Import an audio file to test on Simulator.")
        return
        #else
        guard let persistentID = player.mediaPersistentID else {
            failPlayback(message: "No Music Library track selected for \(player.name).")
            return
        }

        let status = await MPMediaLibrary.requestAuthorization()
        guard !Task.isCancelled, playbackToken == token else { return }
        guard status == .authorized else {
            failPlayback(message: "Allow Media & Apple Music access in Settings to play songs from your library.")
            return
        }

        let predicate = MPMediaPropertyPredicate(
            value: NSNumber(value: persistentID),
            forProperty: MPMediaItemPropertyPersistentID
        )
        let query = MPMediaQuery.songs()
        query.addFilterPredicate(predicate)

        guard let item = query.items?.first else {
            failPlayback(message: "Song not found in your Apple Music library. Make sure it's still in your library.")
            return
        }

        let mp = MPMusicPlayerController.applicationMusicPlayer
        mp.stop()
        mp.setQueue(with: MPMediaItemCollection(items: [item]))

        do {
            try await mp.prepareToPlay()
        } catch {
            guard playbackToken == token else { return }
            let hint = item.isCloudItem
                ? "This song isn't downloaded to your iPhone. Open Music and download it for game-day playback."
                : "Couldn't load this track from Apple Music: \(error.localizedDescription)"
            failPlayback(message: hint)
            return
        }

        guard !Task.isCancelled, playbackToken == token else { return }

        let targetStart = max(0, player.startTime)
        mp.currentPlaybackTime = targetStart
        mp.play()

        // Re-apply start time once after play begins in case iOS resets initial offset.
        try? await Task.sleep(nanoseconds: 150_000_000)
        guard !Task.isCancelled, playbackToken == token else { return }
        if targetStart > 1.0 && abs(mp.currentPlaybackTime - targetStart) > 1.5 {
            mp.currentPlaybackTime = targetStart
        }

        self.musicPlayer = mp
        self.totalDuration = max(1, player.duration)
        self.elapsed = 0
        self.isPlaying = true
        self.isPaused = false

        startMusicMonitor(token: token, duration: totalDuration, initialElapsed: 0, remaining: totalDuration)
        #endif
    }

    private func startClipMonitor(token: UUID, duration: Double, initialElapsed: Double) {
        monitorTask?.cancel()
        let startedAt = Date()

        monitorTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.playbackToken == token, let clip = self.clipPlayer else { return }

                let current = initialElapsed + Date().timeIntervalSince(startedAt)
                self.elapsed = min(duration, current)

                // Smooth 0.4s fade-in and 0.6s fade-out.
                let fadeInWindow = 0.4
                let fadeOutWindow = min(0.6, duration * 0.25)
                if current < fadeInWindow {
                    clip.volume = Float(max(0.05, current / fadeInWindow))
                } else if duration - current <= fadeOutWindow {
                    let remainingRatio = max(0, (duration - current) / fadeOutWindow)
                    clip.volume = Float(remainingRatio)
                } else {
                    clip.volume = 1.0
                }

                if current >= duration || !clip.isPlaying {
                    self.stop(clearError: false)
                    return
                }
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
    }

    private func startMusicMonitor(token: UUID, duration: Double, initialElapsed: Double, remaining: Double) {
        monitorTask?.cancel()
        let startedAt = Date()

        monitorTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.playbackToken == token else { return }
                let segmentElapsed = Date().timeIntervalSince(startedAt)
                self.elapsed = min(duration, initialElapsed + segmentElapsed)

                if segmentElapsed >= remaining {
                    self.stop(clearError: false)
                    return
                }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
    }

    private func failPlayback(message: String) {
        stop(clearError: false)
        errorMessage = message
    }

    private func previewCacheURL(for rawURL: String, in directory: URL) -> URL {
        let digest = SHA256.hash(data: Data(rawURL.utf8))
        let hex = digest.prefix(12).map { String(format: "%02x", $0) }.joined()
        let pathExt = URL(string: rawURL)?.pathExtension.lowercased() ?? ""
        let ext = (pathExt == "mp3" || rawURL.lowercased().contains(".mp3")) ? "mp3" : "m4a"
        return directory.appendingPathComponent("preview_\(hex).\(ext)")
    }

    private func announcementCacheURL(name: String, number: String) -> URL {
        let raw = "\(number.trimmingCharacters(in: .whitespacesAndNewlines))_\(name.lowercased())"
        let safe = raw
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        let file = (safe.isEmpty ? "player" : safe) + ".mp3"
        return announcerCacheDir.appendingPathComponent(file)
    }

    // MARK: - AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if player === self.announcementPlayer {
                self.announcementPlayer = nil
                if let cont = self.announcementContinuation {
                    self.announcementContinuation = nil
                    cont.resume()
                }
            } else if player === self.clipPlayer {
                self.stop(clearError: false)
            }
        }
    }
}
