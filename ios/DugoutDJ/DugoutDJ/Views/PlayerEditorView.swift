import AVFoundation
import MediaPlayer
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct PlayerEditorView: View {
    let teamID: String
    let existingPlayer: Player?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var teamStore: TeamStore
    @EnvironmentObject private var audioEngine: AudioEngine
    @EnvironmentObject private var proManager: ProManager

    @State private var playerID: String
    @State private var name: String
    @State private var number: String
    @State private var pronounced: String
    @State private var songTitle: String
    @State private var artistName: String
    @State private var songSource: SongSource
    @State private var mediaPersistentID: UInt64?
    @State private var localFileName: String?
    @State private var mp3Key: String?
    @State private var previewURL: String?
    @State private var songVideoId: String?
    @State private var startTime: Double
    @State private var duration: Double
    @State private var songDuration: Double
    @State private var pickedCloudWarning: Bool = false

    @State private var showingMediaPicker = false
    @State private var showingFileImporter = false
    @State private var showingCatalog = false
    @State private var showingPaywall = false
    @State private var paywallReason: String?
    @State private var appliedPreset: WalkUpPreset?
    @State private var isLoadingPresetPreview = false
    @State private var presetLookupFailed = false
    @State private var presetLookupTask: Task<Void, Never>?
    @State private var showingSettingsAlert = false
    @State private var alertMessage: String?
    @State private var importedTempFiles: [String] = []
    @State private var youtubeLinkDraft = ""
    @State private var isLoadingYouTube = false
    @State private var youtubeError: String?
    @AppStorage(AIAnnouncerConsent.storageKey) private var aiAnnouncerConsentGranted = false
    @State private var showingAIConsentAlert = false

    init(teamID: String, existingPlayer: Player?) {
        self.teamID = teamID
        self.existingPlayer = existingPlayer

        _playerID = State(initialValue: existingPlayer?.id ?? UUID().uuidString)
        _name = State(initialValue: existingPlayer?.name ?? "")
        _number = State(initialValue: existingPlayer?.number ?? "")
        _pronounced = State(initialValue: existingPlayer?.pronounced ?? "")
        _songTitle = State(initialValue: existingPlayer?.songTitle ?? "")
        _artistName = State(initialValue: existingPlayer?.artistName ?? "")
        _songSource = State(initialValue: existingPlayer?.songSource ?? .none)
        _mediaPersistentID = State(initialValue: existingPlayer?.mediaPersistentID)
        _localFileName = State(initialValue: existingPlayer?.localFileName)
        _mp3Key = State(initialValue: existingPlayer?.mp3Key)
        _previewURL = State(initialValue: existingPlayer?.previewURL)
        _songVideoId = State(initialValue: existingPlayer?.songVideoId)
        _startTime = State(initialValue: existingPlayer?.startTime ?? 0)
        _duration = State(initialValue: max(5, min(30, existingPlayer?.duration ?? 10)))
        _songDuration = State(initialValue: existingPlayer?.songDuration ?? 0)
    }

    private var isPreviewingThisPlayer: Bool {
        audioEngine.activePlayerID == playerID && (audioEngine.isPlaying || audioEngine.isPaused)
    }

    private var hasSelectedSong: Bool {
        switch songSource {
        case .mediaLibrary: return mediaPersistentID != nil
        case .localFile: return !(localFileName ?? "").isEmpty
        case .r2Clip: return !(mp3Key ?? "").isEmpty
        case .preview: return !(previewURL ?? "").isEmpty
        case .youtube: return !(songVideoId ?? "").isEmpty
        case .none: return false
        }
    }

    private var spokenAnnouncementName: String {
        let trimmedPronounced = pronounced.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedPronounced.isEmpty ? name : trimmedPronounced
    }

    private var clipLengthLimit: Double {
        proManager.isPro ? 30 : 15
    }

    private var maxStartSeconds: Double {
        if songDuration > 5 {
            return max(0, floor(songDuration - 5))
        }
        return 300
    }

    private var maxClipDuration: Double {
        if songDuration > 5 {
            return min(clipLengthLimit, max(5, floor(songDuration - startTime)))
        }
        return clipLengthLimit
    }

    private var endTimeBinding: Binding<Double> {
        Binding(
            get: {
                let minEnd = startTime + 5
                let maxEnd = startTime + maxClipDuration
                return min(maxEnd, max(minEnd, startTime + duration))
            },
            set: { newEnd in
                duration = max(5, min(maxClipDuration, newEnd - startTime))
            }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Player") {
                    TextField("Player Name *", text: $name)
                        .textContentType(.name)
                        .autocorrectionDisabled()

                    TextField("Jersey Number (optional)", text: $number)
                        .keyboardType(.numbersAndPunctuation)

                    VStack(alignment: .leading, spacing: 6) {
                        TextField("Pronounced as (optional)", text: $pronounced)
                            .autocorrectionDisabled()
                        Text("Used for \"Now batting, ...!\" — leave blank to use the player's name.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Button {
                        if !proManager.isPro {
                            paywallReason = "Unlock the AI Stadium Announcer for batter introductions."
                            showingPaywall = true
                        } else if audioEngine.isAnnouncing {
                            audioEngine.stop()
                        } else if !aiAnnouncerConsentGranted {
                            showingAIConsentAlert = true
                        } else {
                            audioEngine.previewAnnouncement(name: spokenAnnouncementName, number: number)
                        }
                    } label: {
                        Label(
                            !proManager.isPro
                                ? "Preview Announcement (Pro)"
                                : (audioEngine.isAnnouncing ? "Stop Announcement" : "Preview Announcement"),
                            systemImage: !proManager.isPro
                                ? "lock.fill"
                                : (audioEngine.isAnnouncing ? "stop.circle.fill" : "speaker.wave.2.fill")
                        )
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                              pronounced.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Section("Walk-Up Song") {
                    if let preset = appliedPreset {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Label("#\(preset.rank) \(preset.title)", systemImage: "sparkles")
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Text("Cue \(formatClipTime(preset.startTime)) · \(Int(preset.duration))s")
                                    .font(.caption2.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }

                            if isLoadingPresetPreview {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .controlSize(.small)
                                    Text("Loading audio preview…")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } else if songSource == .preview {
                                Text("30s catalog preview ready — tap Preview Walk-Up Clip below. For the full track at \(formatClipTime(preset.startTime)), find it on YouTube or attach from Apple Music.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else if presetLookupFailed {
                                Text("No preview audio available — attach via Apple Music, Audio File, or paste a YouTube link below (preset cue \(formatClipTime(preset.startTime)) saved).")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Preset timing applied. Attach via Apple Music, Audio File, or paste a YouTube link below.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            if let searchURL = preset.youtubeSearchURL {
                                Link(destination: searchURL) {
                                    Label("Find on YouTube", systemImage: "magnifyingglass")
                                        .font(.caption.weight(.semibold))
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }

                    if hasSelectedSong {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: iconForSource(songSource))
                                    .foregroundStyle(Color.accentColor)
                                Text(songTitle.isEmpty ? "Selected Song" : songTitle)
                                    .font(.headline)
                                Spacer()
                                Text(songSource.displayLabel)
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(.quaternary, in: Capsule())
                            }
                            if !artistName.isEmpty {
                                Text(artistName)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            if pickedCloudWarning {
                                Label(
                                    "Not downloaded to this iPhone — download it in Apple Music for reliable game-day playback.",
                                    systemImage: "icloud.and.arrow.down"
                                )
                                .font(.caption)
                                .foregroundStyle(.orange)
                                .padding(.top, 2)
                            }
                            if songSource == .youtube {
                                Text("Streams live via YouTube when played.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 2)
                            }
                        }
                        .padding(.vertical, 4)
                    }

                    Button {
                        showingCatalog = true
                    } label: {
                        HStack {
                            Label("Browse Top 300 Walk-Up Songs", systemImage: "star.circle.fill")
                            Spacer()
                            if !proManager.isPro {
                                Text("PRO")
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.orange.opacity(0.18), in: Capsule())
                                    .foregroundStyle(.orange)
                            }
                        }
                    }

                    Button {
                        openMediaLibrary()
                    } label: {
                        Label("Pick from Apple Music / Library", systemImage: "music.note.list")
                    }

                    Button {
                        showingFileImporter = true
                    } label: {
                        Label("Import Audio File (MP3, M4A, WAV)", systemImage: "folder")
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            TextField("YouTube or YouTube Music link", text: $youtubeLinkDraft)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)

                            Button {
                                let raw = UIPasteboard.general.string
                                    ?? UIPasteboard.general.url?.absoluteString
                                    ?? ""
                                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                                if trimmed.isEmpty {
                                    youtubeError = "Clipboard is empty."
                                } else {
                                    youtubeLinkDraft = trimmed
                                    youtubeError = nil
                                }
                            } label: {
                                Image(systemName: "clipboard")
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .disabled(isLoadingYouTube)
                            .accessibilityLabel("Paste link")

                            Button(isLoadingYouTube ? "…" : "Load") {
                                Task { await loadYouTubeLink() }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                            .disabled(isLoadingYouTube || youtubeLinkDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        if let youtubeError {
                            Text(youtubeError)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                }

                Section("Start & End Time") {
                    if songSource == .r2Clip {
                        Text("Parent clip is already trimmed — starts at 0:00.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("Start Time")
                                Spacer()
                                Text(formatClipTime(startTime))
                                    .monospacedDigit()
                                    .fontWeight(.semibold)
                            }
                            if maxStartSeconds > 0 {
                                Slider(value: $startTime, in: 0...maxStartSeconds, step: 1)
                            }
                            Stepper(
                                "Fine-tune start (\(formatClipTime(startTime)))",
                                value: $startTime,
                                in: 0...maxStartSeconds,
                                step: 1
                            )
                            .font(.subheadline)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("End Time")
                            Spacer()
                            Text("\(formatClipTime(endTimeBinding.wrappedValue)) (\(Int(duration))s clip)")
                                .monospacedDigit()
                                .fontWeight(.semibold)
                        }
                        if maxClipDuration > 5 {
                            Slider(
                                value: endTimeBinding,
                                in: (startTime + 5)...(startTime + maxClipDuration),
                                step: 1
                            )
                            Stepper(
                                "Fine-tune end (\(formatClipTime(endTimeBinding.wrappedValue)))",
                                value: endTimeBinding,
                                in: (startTime + 5)...(startTime + maxClipDuration),
                                step: 1
                            )
                            .font(.subheadline)
                        }

                        if !proManager.isPro {
                            Button {
                                paywallReason = "Unlock extended walk-up clips up to 30 seconds."
                                showingPaywall = true
                            } label: {
                                Label("Max 15s on Free · Unlock up to 30s with Pro", systemImage: "lock.fill")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.orange)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Button {
                        let draft = buildDraftPlayer()
                        audioEngine.preview(player: draft, clipsDirectory: teamStore.clipsDirectory)
                    } label: {
                        Label(
                            isPreviewingThisPlayer ? "Stop Preview" : "Preview Walk-Up Clip",
                            systemImage: isPreviewingThisPlayer ? "stop.fill" : "play.fill"
                        )
                    }
                    .disabled(!hasSelectedSong)

                    if hasSelectedSong && songSource == .youtube {
                        YouTubePlayerView(webView: audioEngine.youtubePlayer.webView)
                            .frame(maxWidth: isPreviewingThisPlayer ? .infinity : 1)
                            .frame(height: isPreviewingThisPlayer ? 160 : 1)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .opacity(isPreviewingThisPlayer ? 1 : 0.01)
                            .allowsHitTesting(isPreviewingThisPlayer)
                    }
                }
                .onAppear {
                    duration = max(5, min(duration, maxClipDuration))
                }
                .onChange(of: startTime) { _, _ in
                    if duration > maxClipDuration {
                        duration = maxClipDuration
                    }
                }
                .onChange(of: proManager.isPro) { _, _ in
                    duration = max(5, min(duration, maxClipDuration))
                }

                if songSource != .youtube {
                    YouTubePlayerView(webView: audioEngine.youtubePlayer.webView)
                        .frame(width: 1, height: 1)
                        .opacity(0.01)
                        .allowsHitTesting(false)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                if hasSelectedSong {
                    Section("Song Label") {
                        TextField("Song Title", text: $songTitle)
                    }
                }
            }
            .navigationTitle(existingPlayer == nil ? "Add Player" : "Edit Player")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        cleanupUnsavedImports()
                        audioEngine.stop()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        savePlayer()
                    }
                    .fontWeight(.semibold)
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .sheet(isPresented: $showingCatalog) {
                WalkUpCatalogView { preset in
                    applyPreset(preset)
                }
                .environmentObject(proManager)
                .environmentObject(audioEngine)
                .environmentObject(teamStore)
            }
            .sheet(isPresented: $showingPaywall) {
                ProPaywallView(highlightReason: paywallReason)
                    .environmentObject(proManager)
            }
            .sheet(isPresented: $showingMediaPicker) {
                MediaLibraryPicker { track in
                    presetLookupTask?.cancel()
                    isLoadingPresetPreview = false
                    applyDefaultOrPresetWindow(maxTrackDuration: track.playbackDuration, replacingSong: hasSelectedSong)
                    songSource = .mediaLibrary
                    mediaPersistentID = track.persistentID
                    localFileName = nil
                    mp3Key = nil
                    previewURL = nil
                    songVideoId = nil
                    songTitle = track.artist.isEmpty ? track.title : "\(track.artist) - \(track.title)"
                    artistName = track.artist
                    songDuration = track.playbackDuration
                    pickedCloudWarning = track.isCloudItem
                }
            }
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.audio],
                allowsMultipleSelection: false
            ) { result in
                handleFileImport(result)
            }
            .alert("Music Library Unavailable", isPresented: $showingSettingsAlert) {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Allow DugoutDJ to access Media & Apple Music in iOS Settings so you can pick walk-up songs from your library.")
            }
            .alert("DugoutDJ", isPresented: Binding(
                get: { alertMessage != nil },
                set: { if !$0 { alertMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(alertMessage ?? "")
            }
            .onDisappear {
                presetLookupTask?.cancel()
                if audioEngine.activePlayerID == playerID || audioEngine.isAnnouncing {
                    audioEngine.stop()
                }
            }
        }
        .alert(AIAnnouncerConsent.title, isPresented: $showingAIConsentAlert) {
            Button("Allow & Continue") {
                aiAnnouncerConsentGranted = true
                audioEngine.previewAnnouncement(name: spokenAnnouncementName, number: number)
            }
            Button("Keep Announcer Off", role: .cancel) {}
        } message: {
            Text(AIAnnouncerConsent.message)
        }
    }

    private func loadYouTubeLink() async {
        let raw = youtubeLinkDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let videoID = DugoutAPI.extractYouTubeVideoID(from: raw) else {
            let isCollection = raw.range(of: "youtube\\.com/(?:playlist|browse/)", options: [.regularExpression, .caseInsensitive]) != nil
            youtubeError = isCollection
                ? "Paste a link to a specific song, not a playlist or album."
                : "That doesn't look like a valid YouTube or YouTube Music link."
            return
        }

        isLoadingYouTube = true
        youtubeError = nil
        defer { isLoadingYouTube = false }

        do {
            presetLookupTask?.cancel()
            isLoadingPresetPreview = false
            let hadSong = hasSelectedSong
            let info = try await DugoutAPI.fetchYouTubeInfo(videoId: videoID)
            applyDefaultOrPresetWindow(replacingSong: hadSong)
            songSource = .youtube
            songVideoId = info.videoID
            mediaPersistentID = nil
            localFileName = nil
            mp3Key = nil
            previewURL = nil
            songTitle = info.title
            artistName = info.author
            songDuration = 0
            pickedCloudWarning = false
            youtubeLinkDraft = ""
        } catch {
            youtubeError = error.localizedDescription
        }
    }

    private func openMediaLibrary() {
        #if targetEnvironment(simulator)
        alertMessage = "Apple Music library access isn't available on the iOS Simulator. Use \"Import Audio File\" below to test on Simulator, or run on a physical iPhone."
        #else
        Task {
            let status = await MPMediaLibrary.requestAuthorization()
            switch status {
            case .authorized:
                showingMediaPicker = true
            case .denied, .restricted:
                showingSettingsAlert = true
            case .notDetermined:
                break
            @unknown default:
                showingSettingsAlert = true
            }
        }
        #endif
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            alertMessage = "Couldn't import file: \(error.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                let fileName = try teamStore.importAudioFile(from: url)
                importedTempFiles.append(fileName)

                let baseTitle = url.deletingPathExtension().lastPathComponent
                    .replacingOccurrences(of: "[-_]+", with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)

                presetLookupTask?.cancel()
                isLoadingPresetPreview = false
                let hadSong = hasSelectedSong
                applyDefaultOrPresetWindow(replacingSong: hadSong)
                songSource = .localFile
                localFileName = fileName
                mediaPersistentID = nil
                mp3Key = nil
                previewURL = nil
                songVideoId = nil
                songTitle = baseTitle.isEmpty ? "Audio Clip" : baseTitle
                artistName = "Imported File"
                pickedCloudWarning = false

                let storedURL = teamStore.clipFileURL(for: fileName)
                Task {
                    let asset = AVURLAsset(url: storedURL)
                    if let cmDuration = try? await asset.load(.duration) {
                        let secs = CMTimeGetSeconds(cmDuration)
                        if secs.isFinite && secs > 0 {
                            await MainActor.run {
                                songDuration = secs
                                if secs > 5 {
                                    startTime = min(startTime, floor(secs - 5))
                                } else {
                                    startTime = 0
                                }
                                if secs < duration {
                                    duration = max(5, floor(secs))
                                }
                            }
                        }
                    }
                }
            } catch {
                alertMessage = "Couldn't save audio file: \(error.localizedDescription)"
            }
        }
    }

    private func applyPreset(_ preset: WalkUpPreset) {
        presetLookupTask?.cancel()
        audioEngine.stop()
        presetLookupFailed = false

        let clampedDuration = max(5, min(clipLengthLimit, preset.duration))
        songTitle = preset.displayTitle
        artistName = preset.artist
        startTime = preset.startTime
        duration = clampedDuration
        pickedCloudWarning = false

        if let track = WalkUpCatalog.findAppleMusicMatch(for: preset) {
            isLoadingPresetPreview = false
            songSource = .mediaLibrary
            mediaPersistentID = track.persistentID
            localFileName = nil
            mp3Key = nil
            previewURL = nil
            songVideoId = nil
            songTitle = track.artist.isEmpty ? track.title : "\(track.artist) - \(track.title)"
            artistName = track.artist
            songDuration = track.playbackDuration
            if track.playbackDuration > 5 {
                startTime = min(startTime, floor(track.playbackDuration - 5))
            }
            pickedCloudWarning = track.isCloudItem
            appliedPreset = nil
            return
        }

        appliedPreset = preset
        isLoadingPresetPreview = true
        presetLookupTask = Task {
            let match = try? await DugoutAPI.searchSongPreview(title: preset.title, artist: preset.artist)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                isLoadingPresetPreview = false
                guard appliedPreset?.id == preset.id else { return }
                if let match {
                    songSource = .preview
                    previewURL = match.previewURL
                    mediaPersistentID = nil
                    localFileName = nil
                    mp3Key = nil
                    songVideoId = nil
                    songDuration = 30
                    startTime = 0
                    duration = clampedDuration
                    presetLookupFailed = false
                } else {
                    presetLookupFailed = true
                }
            }
        }
    }

    private func applyDefaultOrPresetWindow(maxTrackDuration: Double = 0, replacingSong: Bool = false) {
        if let preset = appliedPreset {
            let maxStart = maxTrackDuration > 5 ? floor(maxTrackDuration - 5) : preset.startTime
            startTime = max(0, min(preset.startTime, maxStart))
            duration = max(5, min(clipLengthLimit, preset.duration))
            appliedPreset = nil
        } else if replacingSong {
            startTime = 0
            duration = 10
        } else if maxTrackDuration > 5 {
            startTime = max(0, min(startTime, floor(maxTrackDuration - 5)))
            let maxDur = min(clipLengthLimit, max(5, floor(maxTrackDuration - startTime)))
            duration = max(5, min(maxDur, duration))
        }
    }

    private func buildDraftPlayer() -> Player {
        Player(
            id: playerID,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            pronounced: pronounced.trimmingCharacters(in: .whitespacesAndNewlines),
            number: number.trimmingCharacters(in: .whitespacesAndNewlines),
            songTitle: songTitle.trimmingCharacters(in: .whitespacesAndNewlines),
            artistName: artistName,
            songSource: songSource,
            mediaPersistentID: mediaPersistentID,
            localFileName: localFileName,
            mp3Key: mp3Key,
            previewURL: previewURL,
            songVideoId: songVideoId,
            startTime: startTime,
            duration: duration,
            songDuration: songDuration
        )
    }

    private func savePlayer() {
        let draft = buildDraftPlayer()
        guard !draft.name.isEmpty else { return }
        audioEngine.stop()
        // Delete any intermediate imported files that were replaced before Save.
        for fileName in importedTempFiles where fileName != draft.localFileName {
            try? FileManager.default.removeItem(at: teamStore.clipFileURL(for: fileName))
        }
        teamStore.upsertPlayer(draft, in: teamID)
        dismiss()
    }

    private func cleanupUnsavedImports() {
        for fileName in importedTempFiles where fileName != existingPlayer?.localFileName {
            try? FileManager.default.removeItem(at: teamStore.clipFileURL(for: fileName))
        }
    }

    private func iconForSource(_ source: SongSource) -> String {
        switch source {
        case .mediaLibrary: return "music.note"
        case .localFile: return "doc.audio"
        case .r2Clip: return "icloud.and.arrow.down"
        case .preview: return "sparkles"
        case .youtube: return "play.rectangle"
        case .none: return "music.note"
        }
    }
}
