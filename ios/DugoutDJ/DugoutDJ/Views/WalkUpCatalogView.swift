import SwiftUI

struct WalkUpCatalogView: View {
    @EnvironmentObject private var proManager: ProManager
    @EnvironmentObject private var audioEngine: AudioEngine
    @EnvironmentObject private var teamStore: TeamStore
    @Environment(\.dismiss) private var dismiss

    let onSelect: (WalkUpPreset) -> Void

    @State private var searchText = ""
    @State private var selectedGenre = "All"
    @State private var cleanOnly = false
    @State private var showingPaywall = false
    @State private var loadingPresetID: String?
    @State private var previewCache: [String: String] = [:]
    @State private var previewTask: Task<Void, Never>?
    @State private var previewError: String?
    @State private var didStartCatalogAudio = false

    private var filteredPresets: [WalkUpPreset] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return WalkUpCatalog.presets.filter { preset in
            if selectedGenre != "All" && preset.genre != selectedGenre {
                return false
            }
            if cleanOnly && !preset.clean {
                return false
            }
            if !query.isEmpty {
                let matches = preset.title.localizedCaseInsensitiveContains(query)
                    || preset.artist.localizedCaseInsensitiveContains(query)
                    || preset.vibe.localizedCaseInsensitiveContains(query)
                    || preset.genre.localizedCaseInsensitiveContains(query)
                if !matches {
                    return false
                }
            }
            return true
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !proManager.isPro {
                    Button {
                        showingPaywall = true
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "star.circle.fill")
                                .font(.title3)
                                .foregroundStyle(.orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Dugout DJ Pro Preset Catalog")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.primary)
                                Text("Preview the top hits — unlock Season Pass (\(proManager.displayPrice)/yr) to browse and apply all 300 songs.")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("Unlock")
                                .font(.caption.weight(.bold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.accentColor, in: Capsule())
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.orange.opacity(0.12))
                    }
                    .buttonStyle(.plain)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(WalkUpCatalog.genres, id: \.self) { genre in
                            let selected = selectedGenre == genre
                            Button {
                                selectedGenre = genre
                            } label: {
                                Text(genre)
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(
                                        selected ? Color.accentColor : Color.secondary.opacity(0.15),
                                        in: Capsule()
                                    )
                                    .foregroundStyle(selected ? .white : .primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }

                Toggle("Youth-Clean Lyrics Only", isOn: $cleanOnly)
                    .font(.subheadline)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)

                if let err = previewError ?? (didStartCatalogAudio ? audioEngine.errorMessage : nil) {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(err)
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            previewError = nil
                            audioEngine.errorMessage = nil
                            didStartCatalogAudio = false
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityLabel("Dismiss error")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.orange.opacity(0.14))
                }

                Divider()

                if filteredPresets.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                } else {
                    List(filteredPresets) { preset in
                        let catalogPlayerID = "catalog-\(preset.id)"
                        let isPlayingThis = audioEngine.activePlayerID == catalogPlayerID && (audioEngine.isPlaying || audioEngine.isPaused)
                        let isLoadingThis = loadingPresetID == preset.id

                        HStack(spacing: 12) {
                            HStack(spacing: 12) {
                                Text("#\(preset.rank)")
                                    .font(.caption.weight(.bold).monospacedDigit())
                                    .frame(width: 38, height: 28)
                                    .background(Color.accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                                    .foregroundStyle(Color.accentColor)

                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text(preset.title)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)

                                        if !preset.clean {
                                            Text("E")
                                                .font(.caption2.weight(.bold))
                                                .padding(.horizontal, 5)
                                                .padding(.vertical, 1)
                                                .background(Color.secondary.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
                                                .foregroundStyle(.secondary)
                                        }
                                    }

                                    Text(preset.artist)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)

                                    HStack(spacing: 6) {
                                        Text(preset.genre)
                                        Text("·")
                                        Text(preset.vibe)
                                        Text("·")
                                        Text("Start \(formatClipTime(preset.startTime)) (\(Int(preset.duration))s)")
                                            .monospacedDigit()
                                    }
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                                }

                                Spacer(minLength: 4)
                            }
                            .contentShape(Rectangle())
                            .onTapGesture {
                                handleSelect(preset)
                            }

                            Button {
                                togglePreview(for: preset)
                            } label: {
                                Group {
                                    if isLoadingThis {
                                        ProgressView()
                                            .controlSize(.small)
                                    } else {
                                        Image(systemName: isPlayingThis ? "stop.circle.fill" : "play.circle")
                                            .font(.title3)
                                            .foregroundStyle(Color.accentColor)
                                    }
                                }
                                .frame(width: 34, height: 34)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(isPlayingThis ? "Stop preview" : "Preview \(preset.title)")

                            Button {
                                handleSelect(preset)
                            } label: {
                                Image(systemName: proManager.isPro ? "plus.circle.fill" : "lock.fill")
                                    .font(.title3)
                                    .foregroundStyle(proManager.isPro ? Color.accentColor : Color.secondary)
                                    .frame(width: 30, height: 34)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(proManager.isPro ? "Use \(preset.title)" : "Unlock to use \(preset.title)")
                        }
                        .padding(.vertical, 2)
                    }
                    .listStyle(.plain)
                    .scrollDisabled(!proManager.isPro)
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 18)
                            .onChanged { value in
                                guard !proManager.isPro, !showingPaywall else { return }
                                if abs(value.translation.height) > abs(value.translation.width),
                                   abs(value.translation.height) > 20 {
                                    showingPaywall = true
                                }
                            }
                    )
                }
            }
            .navigationTitle("Top 300 Walk-Up Songs")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search song, artist, or vibe")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        stopCatalogPreview()
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showingPaywall) {
                ProPaywallView(highlightReason: "Unlock all 300 curated walk-up presets with pre-set start & stop times.")
                    .environmentObject(proManager)
            }
            .onDisappear {
                stopCatalogPreview()
            }
        }
    }

    private func handleSelect(_ preset: WalkUpPreset) {
        if proManager.isPro {
            stopCatalogPreview()
            onSelect(preset)
            dismiss()
        } else {
            showingPaywall = true
        }
    }

    private func stopCatalogPreview() {
        previewTask?.cancel()
        previewTask = nil
        loadingPresetID = nil
        if audioEngine.activePlayerID?.hasPrefix("catalog-") == true {
            audioEngine.stop()
        }
    }

    private func togglePreview(for preset: WalkUpPreset) {
        let catalogPlayerID = "catalog-\(preset.id)"
        if audioEngine.activePlayerID == catalogPlayerID && (audioEngine.isPlaying || audioEngine.isPaused) {
            audioEngine.stop()
            return
        }
        if loadingPresetID == preset.id {
            previewTask?.cancel()
            previewTask = nil
            loadingPresetID = nil
            return
        }

        previewTask?.cancel()
        previewError = nil
        audioEngine.errorMessage = nil

        if let track = WalkUpCatalog.findAppleMusicMatch(for: preset) {
            loadingPresetID = nil
            didStartCatalogAudio = true
            let draft = Player(
                id: catalogPlayerID,
                name: preset.title,
                songTitle: preset.displayTitle,
                artistName: preset.artist,
                songSource: .mediaLibrary,
                mediaPersistentID: track.persistentID,
                startTime: track.playbackDuration > 5 ? min(preset.startTime, floor(track.playbackDuration - 5)) : 0,
                duration: max(5, min(15, preset.duration)),
                songDuration: track.playbackDuration
            )
            audioEngine.preview(player: draft, clipsDirectory: teamStore.clipsDirectory)
            return
        }

        if let cachedURL = previewCache[preset.id] {
            playPreviewAudioURL(cachedURL, for: preset)
            return
        }

        loadingPresetID = preset.id
        previewTask = Task {
            do {
                let match = try await DugoutAPI.searchSongPreview(title: preset.title, artist: preset.artist)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    loadingPresetID = nil
                    guard let match else {
                        previewError = "No audio preview available for \"\(preset.title)\"."
                        return
                    }
                    previewCache[preset.id] = match.previewURL
                    playPreviewAudioURL(match.previewURL, for: preset)
                }
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    loadingPresetID = nil
                    previewError = "Couldn't load preview: \(error.localizedDescription)"
                }
            }
        }
    }

    private func playPreviewAudioURL(_ previewURL: String, for preset: WalkUpPreset) {
        loadingPresetID = nil
        didStartCatalogAudio = true
        let draft = Player(
            id: "catalog-\(preset.id)",
            name: preset.title,
            songTitle: preset.displayTitle,
            artistName: preset.artist,
            songSource: .preview,
            previewURL: previewURL,
            startTime: 0,
            duration: max(5, min(15, preset.duration)),
            songDuration: 30
        )
        audioEngine.preview(player: draft, clipsDirectory: teamStore.clipsDirectory)
    }
}
