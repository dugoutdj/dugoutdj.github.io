import StoreKit
import SwiftUI
import UIKit

enum AIAnnouncerConsent {
    static let storageKey = "aiAnnouncerConsentGranted"
    static let title = "AI Stadium Announcer"
    static let message = "When AI Stadium Announcer is on, Dugout DJ sends each batter's name and jersey number to ElevenLabs (a third-party AI voice provider) via dugoutdj.com to generate stadium announcement audio. No other personal data is shared. You can turn Announcer off anytime in the team menu."
}

private enum EditorTarget: Identifiable {
    case add(teamID: String)
    case edit(teamID: String, player: Player)

    var id: String {
        switch self {
        case .add(let teamID): return "add-\(teamID)"
        case .edit(_, let player): return "edit-\(player.id)"
        }
    }
}

private struct PaywallRequest: Identifiable {
    let id = UUID()
    let reason: String?
}

struct ContentView: View {
    @EnvironmentObject private var teamStore: TeamStore
    @EnvironmentObject private var audioEngine: AudioEngine
    @EnvironmentObject private var authManager: AuthManager
    @EnvironmentObject private var proManager: ProManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(AIAnnouncerConsent.storageKey) private var aiAnnouncerConsentGranted = false

    @State private var editorTarget: EditorTarget?
    @State private var paywallRequest: PaywallRequest?
    @State private var showingNewTeamAlert = false
    @State private var showingRenameTeamAlert = false
    @State private var showingShareSheet = false
    @State private var showingAccountSheet = false
    @State private var showingAIConsentAlert = false
    @State private var pendingAnnouncerToggleTeamID: String?
    @State private var pendingPlayRequest: (player: Player, team: Team)?
    @State private var teamNameDraft = ""
    @State private var editMode: EditMode = .inactive

    private var currentTeam: Team? {
        teamStore.currentTeam
    }

    private var players: [Player] {
        currentTeam?.players ?? []
    }

    private var activePlayer: Player? {
        guard let activeID = audioEngine.activePlayerID else { return nil }
        return players.first(where: { $0.id == activeID })
    }

    private var activeIndex: Int? {
        guard let activeID = audioEngine.activePlayerID else { return nil }
        return players.firstIndex(where: { $0.id == activeID })
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                statusBanner

                if players.isEmpty {
                    ContentUnavailableView {
                        Label("No Players Yet", systemImage: "figure.baseball")
                    } description: {
                        Text("Add your roster and assign each player a walk-up song from your Apple Music library or audio files.")
                    } actions: {
                        if let team = currentTeam {
                            Button("Add First Player") {
                                editorTarget = .add(teamID: team.id)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let team = currentTeam {
                    List {
                        Section {
                            ForEach(Array(team.players.enumerated()), id: \.element.id) { index, player in
                                PlayerRowView(
                                    battingOrder: index + 1,
                                    player: player,
                                    isActive: audioEngine.activePlayerID == player.id,
                                    isAnnouncing: audioEngine.activePlayerID == player.id && audioEngine.isAnnouncing,
                                    isPlaying: audioEngine.activePlayerID == player.id && audioEngine.isPlaying,
                                    onPlay: {
                                        playPlayer(player, in: team)
                                    },
                                    onEdit: {
                                        editorTarget = .edit(teamID: team.id, player: player)
                                    },
                                    onDelete: {
                                        if audioEngine.activePlayerID == player.id {
                                            audioEngine.stop()
                                        }
                                        teamStore.deletePlayer(id: player.id, in: team.id)
                                    }
                                )
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(role: .destructive) {
                                        if audioEngine.activePlayerID == player.id {
                                            audioEngine.stop()
                                        }
                                        teamStore.deletePlayer(id: player.id, in: team.id)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }

                                    Button {
                                        editorTarget = .edit(teamID: team.id, player: player)
                                    } label: {
                                        Label("Edit", systemImage: "pencil")
                                    }
                                    .tint(.blue)
                                }
                            }
                            .onMove { source, destination in
                                teamStore.movePlayers(from: source, to: destination, in: team.id)
                            }
                        } header: {
                            HStack {
                                Text("\(team.players.count) \(team.players.count == 1 ? "Player" : "Players")")
                                Spacer()
                                if proManager.isPro {
                                    let announcerActive = isAnnouncerActive(for: team)
                                    Button {
                                        toggleAnnouncer(for: team)
                                    } label: {
                                        Text(announcerActive ? "Announcer ON" : "Announcer OFF")
                                            .font(.caption)
                                            .foregroundStyle(announcerActive ? Color.accentColor : .secondary)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityHint("Toggles AI stadium announcer")
                                } else {
                                    Button {
                                        paywallRequest = PaywallRequest(
                                            reason: "Unlock the AI Stadium Announcer for batter introductions."
                                        )
                                    } label: {
                                        Label("Announcer · PRO", systemImage: "lock.fill")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.orange)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .environment(\.editMode, $editMode)
                }
            }
            .navigationTitle(currentTeam?.name ?? "Dugout DJ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if #available(iOS 26.0, *) {
                    ToolbarItem(placement: .topBarLeading) {
                        toolbarLogo
                    }
                    .sharedBackgroundVisibility(.hidden)
                } else {
                    ToolbarItem(placement: .topBarLeading) {
                        toolbarLogo
                    }
                }

                ToolbarItem(placement: .principal) {
                    Text(currentTeam?.name ?? "")
                        .font(.headline)
                        .lineLimit(1)
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    if editMode == .active {
                        Button("Done") {
                            withAnimation(reduceMotion ? nil : .default) {
                                editMode = .inactive
                            }
                        }
                        .fontWeight(.semibold)
                    } else {
                        if let team = currentTeam {
                            Button {
                                editorTarget = .add(teamID: team.id)
                            } label: {
                                Image(systemName: "plus")
                            }
                            .accessibilityLabel("Add player")
                        }

                        optionsMenu
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    if editorTarget == nil {
                        YouTubePlayerView(webView: audioEngine.youtubePlayer.webView)
                            .frame(maxWidth: audioEngine.isYouTubeActive ? .infinity : 1)
                            .frame(height: audioEngine.isYouTubeActive ? 160 : 1)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .padding(.horizontal, audioEngine.isYouTubeActive ? 12 : 0)
                            .padding(.bottom, audioEngine.isYouTubeActive ? 6 : 0)
                            .opacity(audioEngine.isYouTubeActive ? 1 : 0.01)
                            .allowsHitTesting(audioEngine.isYouTubeActive)
                    }

                    if !players.isEmpty {
                        NowPlayingBar(
                            activePlayer: activePlayer,
                            isAnnouncing: audioEngine.isAnnouncing,
                            isPlaying: audioEngine.isPlaying,
                            isPaused: audioEngine.isPaused,
                            elapsed: audioEngine.elapsed,
                            totalDuration: audioEngine.totalDuration,
                            onPrevious: playPrevious,
                            onPlayPause: togglePlayPause,
                            onStop: { audioEngine.stop() },
                            onReplay: replayCurrent,
                            onNext: playNext
                        )
                    }
                }
            }
            .sheet(item: $paywallRequest) { request in
                ProPaywallView(highlightReason: request.reason)
                    .environmentObject(proManager)
            }
            .sheet(item: $editorTarget) { target in
                switch target {
                case .add(let teamID):
                    PlayerEditorView(teamID: teamID, existingPlayer: nil)
                case .edit(let teamID, let player):
                    PlayerEditorView(teamID: teamID, existingPlayer: player)
                }
            }
            .sheet(isPresented: $showingShareSheet) {
                ParentShareSheet(
                    shareURL: teamStore.shareURL,
                    teamName: currentTeam?.name ?? "Team",
                    isSyncing: teamStore.isSyncing,
                    onGenerateLink: {
                        await teamStore.shareTeamWithParents()
                    },
                    onPullUpdates: {
                        await teamStore.pullParentUpdates()
                    }
                )
                .presentationDetents([.medium])
            }
            .sheet(isPresented: $showingAccountSheet) {
                CoachAccountSheet(
                    isSignedIn: authManager.state.isSignedIn,
                    email: signedInEmail,
                    team: currentTeam,
                    isSyncing: teamStore.isSyncing,
                    onSyncNow: {
                        await teamStore.syncAllNow()
                    },
                    onSignIn: {
                        authManager.promptSignIn()
                    },
                    onSignOut: {
                        audioEngine.stop()
                        await authManager.signOut()
                    },
                    onDeleteAccount: {
                        audioEngine.stop()
                        try await authManager.deleteAccount()
                        teamStore.resetLocalData()
                    }
                )
                .environmentObject(proManager)
                .presentationDetents([.medium, .large])
            }
            .alert("New Team", isPresented: $showingNewTeamAlert) {
                TextField("Team Name", text: $teamNameDraft)
                Button("Create") {
                    audioEngine.stop()
                    teamStore.addTeam(name: teamNameDraft)
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Rename Team", isPresented: $showingRenameTeamAlert) {
                TextField("Team Name", text: $teamNameDraft)
                Button("Save") {
                    if let team = currentTeam {
                        teamStore.renameTeam(id: team.id, name: teamNameDraft)
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .alert(AIAnnouncerConsent.title, isPresented: $showingAIConsentAlert) {
            Button("Allow & Continue") {
                aiAnnouncerConsentGranted = true
                if let teamID = pendingAnnouncerToggleTeamID {
                    pendingAnnouncerToggleTeamID = nil
                    if let team = teamStore.teams.first(where: { $0.id == teamID }), !team.announcerEnabled {
                        teamStore.toggleAnnouncer(for: teamID)
                    }
                }
                if let pending = pendingPlayRequest {
                    pendingPlayRequest = nil
                    audioEngine.play(
                        player: pending.player,
                        announcerEnabled: true,
                        clipsDirectory: teamStore.clipsDirectory
                    )
                }
            }
            Button("Keep Announcer Off", role: .cancel) {
                pendingAnnouncerToggleTeamID = nil
                if let team = currentTeam, team.announcerEnabled {
                    teamStore.toggleAnnouncer(for: team.id)
                }
                if let pending = pendingPlayRequest {
                    pendingPlayRequest = nil
                    audioEngine.play(
                        player: pending.player,
                        announcerEnabled: false,
                        clipsDirectory: teamStore.clipsDirectory
                    )
                }
            }
        } message: {
            Text(AIAnnouncerConsent.message)
        }
    }

    @ViewBuilder
    private var statusBanner: some View {
        if let error = audioEngine.errorMessage ?? teamStore.lastError {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(error)
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    audioEngine.errorMessage = nil
                    teamStore.lastError = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Dismiss error")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color.orange.opacity(0.14))
        } else if let status = teamStore.syncMessage {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text(status)
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    teamStore.syncMessage = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Dismiss status message")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color.green.opacity(0.14))
        }
    }

    private var toolbarLogo: some View {
        HStack(spacing: 6) {
            DugoutLogoMark(size: 30, animated: audioEngine.isPlaying && !reduceMotion)
            Text("DugoutDJ")
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            if proManager.isPro {
                Text("PRO")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(Color.accentColor)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(DugoutColors.ledGreen.opacity(0.18), in: Capsule())
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(proManager.isPro ? "DugoutDJ Pro" : "DugoutDJ")
    }

    private var optionsMenu: some View {
        Menu {
            Section("Teams") {
                if !teamStore.teams.isEmpty {
                    Menu {
                        ForEach(teamStore.teams) { team in
                            Button {
                                audioEngine.stop()
                                teamStore.selectTeam(team)
                            } label: {
                                if team.id == currentTeam?.id {
                                    Label(team.name, systemImage: "checkmark")
                                } else {
                                    Text(team.name)
                                }
                            }
                        }
                    } label: {
                        Label("Switch Team", systemImage: "baseball.diamond.bases")
                    }
                }

                Button {
                    if proManager.isPro || teamStore.teams.isEmpty {
                        teamNameDraft = ""
                        showingNewTeamAlert = true
                    } else {
                        paywallRequest = PaywallRequest(
                            reason: "Upgrade to Dugout DJ Pro to create and manage unlimited teams."
                        )
                    }
                } label: {
                    Label(
                        proManager.isPro || teamStore.teams.isEmpty ? "New Team…" : "New Team… (Pro)",
                        systemImage: proManager.isPro || teamStore.teams.isEmpty ? "plus.circle" : "lock.fill"
                    )
                }

                if let team = currentTeam {
                    Button {
                        teamNameDraft = team.name
                        showingRenameTeamAlert = true
                    } label: {
                        Label("Rename Team…", systemImage: "pencil")
                    }

                    if teamStore.teams.count > 1 {
                        Button(role: .destructive) {
                            audioEngine.stop()
                            teamStore.deleteTeam(id: team.id)
                        } label: {
                            Label("Delete \(team.name)", systemImage: "trash")
                        }
                    }
                }
            }

            if let team = currentTeam {
                Section("Lineup & Audio") {
                    Button {
                        withAnimation(reduceMotion ? nil : .default) {
                            editMode = .active
                        }
                    } label: {
                        Label("Reorder Batting Order", systemImage: "arrow.up.arrow.down")
                    }
                    .disabled(players.count < 2)

                    Button {
                        if !proManager.isPro {
                            paywallRequest = PaywallRequest(
                                reason: "Unlock the AI Stadium Announcer for batter introductions."
                            )
                        } else {
                            toggleAnnouncer(for: team)
                        }
                    } label: {
                        let announcerActive = isAnnouncerActive(for: team)
                        Label(
                            !proManager.isPro
                                ? "Turn Announcer On (Pro)"
                                : (announcerActive ? "Turn Announcer Off" : "Turn Announcer On"),
                            systemImage: !proManager.isPro
                                ? "lock.fill"
                                : (announcerActive ? "speaker.slash" : "speaker.wave.2.fill")
                        )
                    }
                }

                Section("Parents & Cloud Sync") {
                    Button {
                        showingShareSheet = true
                    } label: {
                        Label("Share with Parents…", systemImage: "link")
                    }

                    if team.sharedTeamId != nil {
                        Button {
                            Task {
                                await teamStore.pullParentUpdates()
                            }
                        } label: {
                            Label("Pull Parent Updates", systemImage: "arrow.triangle.2.circlepath")
                        }
                    }

                    if authManager.state.isSignedIn {
                        Button {
                            Task {
                                await teamStore.syncAllNow()
                            }
                        } label: {
                            Label("Sync Teams Now", systemImage: "icloud.and.arrow.up")
                        }
                    }
                }
            }

            Section("Account") {
                Button {
                    paywallRequest = PaywallRequest(reason: nil)
                } label: {
                    Label(
                        proManager.isPro ? "Dugout DJ Pro Active" : "Dugout DJ Pro…",
                        systemImage: proManager.isPro ? "checkmark.seal.fill" : "star.circle"
                    )
                }

                Button {
                    showingAccountSheet = true
                } label: {
                    Label("Coach Account…", systemImage: "person.crop.circle")
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Team and options")
    }

    private var signedInEmail: String {
        if case .signedIn(let email) = authManager.state {
            return email
        }
        return ""
    }

    private func isAnnouncerActive(for team: Team) -> Bool {
        proManager.isPro && team.announcerEnabled && aiAnnouncerConsentGranted
    }

    private func toggleAnnouncer(for team: Team) {
        if isAnnouncerActive(for: team) {
            teamStore.toggleAnnouncer(for: team.id)
        } else if !aiAnnouncerConsentGranted {
            pendingAnnouncerToggleTeamID = team.id
            showingAIConsentAlert = true
        } else {
            teamStore.toggleAnnouncer(for: team.id)
        }
    }

    private func playPlayer(_ player: Player, in team: Team) {
        if proManager.isPro && team.announcerEnabled && !aiAnnouncerConsentGranted {
            pendingPlayRequest = (player, team)
            showingAIConsentAlert = true
        } else {
            audioEngine.play(
                player: player,
                announcerEnabled: isAnnouncerActive(for: team),
                clipsDirectory: teamStore.clipsDirectory
            )
        }
    }

    // MARK: - Transport Controls

    private func togglePlayPause() {
        guard let team = currentTeam, !team.players.isEmpty else { return }
        if audioEngine.isPlaying {
            audioEngine.pause()
        } else if audioEngine.isPaused {
            audioEngine.resume()
        } else if let firstPlayable = team.players.first(where: \.hasSong) {
            playPlayer(firstPlayable, in: team)
        }
    }

    private func replayCurrent() {
        guard let team = currentTeam, let active = activePlayer else { return }
        audioEngine.stop()
        playPlayer(active, in: team)
    }

    private func playNext() {
        guard let team = currentTeam, !team.players.isEmpty else { return }
        let start = activeIndex ?? -1
        for offset in 1...team.players.count {
            let candidate = team.players[(start + offset) % team.players.count]
            if candidate.hasSong {
                playPlayer(candidate, in: team)
                return
            }
        }
    }

    private func playPrevious() {
        guard let team = currentTeam, !team.players.isEmpty else { return }
        let start = activeIndex ?? 0
        for offset in 1...team.players.count {
            let idx = (start - offset + team.players.count) % team.players.count
            let candidate = team.players[idx]
            if candidate.hasSong {
                playPlayer(candidate, in: team)
                return
            }
        }
    }
}

private struct PlayerRowView: View {
    let battingOrder: Int
    let player: Player
    let isActive: Bool
    let isAnnouncing: Bool
    let isPlaying: Bool
    let onPlay: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 12) {
                Text("\(battingOrder)")
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .frame(width: 28, height: 28)
                    .background(isActive ? Color.accentColor : Color.secondary.opacity(0.18), in: Circle())
                    .foregroundStyle(isActive ? .white : .primary)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(player.name)
                            .font(.headline)
                        if !player.number.isEmpty {
                            Text("#\(player.number)")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.15), in: Capsule())
                        }
                    }

                    if player.hasSong {
                        HStack(spacing: 6) {
                            Text(player.songTitle.isEmpty ? player.songSource.displayLabel : player.songTitle)
                                .lineLimit(1)
                            Text("· \(formatClipTime(player.startTime)) (\(Int(player.duration))s)")
                                .monospacedDigit()
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else {
                        Text("No walk-up song selected")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                if isActive {
                    Image(systemName: isAnnouncing ? "mic.fill" : (isPlaying ? "waveform" : "pause.fill"))
                        .foregroundStyle(Color.accentColor)
                        .font(.title3)
                } else if player.hasSong {
                    Image(systemName: "play.circle.fill")
                        .foregroundStyle(Color.accentColor)
                        .font(.title3)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: onPlay)
            .opacity(player.hasSong ? 1.0 : 0.65)

            Menu {
                Button(action: onEdit) {
                    Label("Edit Player", systemImage: "pencil")
                }
                Button(role: .destructive, action: onDelete) {
                    Label("Delete Player", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Options for \(player.name)")
        }
        .padding(.vertical, 4)
    }
}

private struct NowPlayingBar: View {
    let activePlayer: Player?
    let isAnnouncing: Bool
    let isPlaying: Bool
    let isPaused: Bool
    let elapsed: Double
    let totalDuration: Double
    let onPrevious: () -> Void
    let onPlayPause: () -> Void
    let onStop: () -> Void
    let onReplay: () -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            if totalDuration > 0 && (isPlaying || isPaused) {
                ProgressView(value: min(elapsed, totalDuration), total: totalDuration)
                    .tint(.accentColor)
            }

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    if let activePlayer {
                        Text(activePlayer.number.isEmpty ? activePlayer.name : "#\(activePlayer.number) \(activePlayer.name)")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(statusSubtitle(for: activePlayer))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        Text("Dugout Ready")
                            .font(.subheadline.weight(.semibold))
                        Text("Tap a player above or press Play")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                HStack(spacing: 16) {
                    Button(action: onPrevious) {
                        Image(systemName: "backward.end.fill")
                    }
                    .accessibilityLabel("Previous player")

                    Button(action: onPlayPause) {
                        Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.title)
                    }
                    .accessibilityLabel(isPlaying ? "Pause" : "Play")

                    Button(action: onStop) {
                        Image(systemName: "stop.fill")
                    }
                    .accessibilityLabel("Stop")
                    .disabled(activePlayer == nil)

                    Button(action: onReplay) {
                        Image(systemName: "arrow.counterclockwise")
                    }
                    .accessibilityLabel("Replay")
                    .disabled(activePlayer == nil)

                    Button(action: onNext) {
                        Image(systemName: "forward.end.fill")
                    }
                    .accessibilityLabel("Next player")
                }
                .font(.title3)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .overlay(Divider(), alignment: .top)
    }

    private func statusSubtitle(for player: Player) -> String {
        if isAnnouncing {
            return "Announcing batter…"
        }
        let song = player.songTitle.isEmpty ? player.songSource.displayLabel : player.songTitle
        if isPlaying || isPaused {
            return "\(song) · \(Int(elapsed))s / \(Int(totalDuration))s"
        }
        return song
    }
}

private struct ParentShareSheet: View {
    let shareURL: URL?
    let teamName: String
    let isSyncing: Bool
    let onGenerateLink: () async -> URL?
    let onPullUpdates: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Image(systemName: "person.2.wave.2.fill")
                    .font(.largeTitle)
                    .imageScale(.large)
                    .foregroundStyle(Color.accentColor)

                Text("Share with Parents")
                    .font(.title2.bold())

                Text("Send one link so parents can choose or update their player's walk-up song from any browser — no app install required.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if let shareURL {
                    VStack(spacing: 10) {
                        Text(shareURL.absoluteString)
                            .font(.footnote.monospaced())
                            .padding(10)
                            .frame(maxWidth: .infinity)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))

                        HStack(spacing: 12) {
                            Button {
                                UIPasteboard.general.string = shareURL.absoluteString
                                copied = true
                            } label: {
                                Label(copied ? "Copied" : "Copy Link", systemImage: copied ? "checkmark" : "doc.on.doc")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)

                            ShareLink(item: shareURL, message: Text("Pick your player's walk-up song for \(teamName):")) {
                                Label("Share", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        Button {
                            Task { await onPullUpdates() }
                        } label: {
                            Label(isSyncing ? "Checking…" : "Pull Parent Updates", systemImage: "arrow.triangle.2.circlepath")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(isSyncing)
                    }
                } else {
                    Button {
                        Task { _ = await onGenerateLink() }
                    } label: {
                        Label(isSyncing ? "Creating Link…" : "Create Parent Share Link", systemImage: "link.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSyncing)
                }

                Spacer()
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct CoachAccountSheet: View {
    let isSignedIn: Bool
    let email: String
    let team: Team?
    let isSyncing: Bool
    let onSyncNow: () async -> Void
    let onSignIn: () -> Void
    let onSignOut: () async -> Void
    let onDeleteAccount: () async throws -> Void

    @EnvironmentObject private var proManager: ProManager
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDeleteAccount = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var showingPaywall = false
    @State private var showingManageSubscriptions = false

    private var privacyPolicyURL: URL {
        URL(string: "https://dugoutdj.com/privacy.html")!
    }

    var body: some View {
        NavigationStack {
            List {
                if isSignedIn {
                    Section("Signed In As") {
                        Label(email.isEmpty ? "Coach" : email, systemImage: "person.crop.circle.fill")
                    }

                    if let team {
                        Section("Cloud Backup") {
                            HStack {
                                Text("Team")
                                Spacer()
                                Text(team.name)
                                    .foregroundStyle(.secondary)
                            }
                            HStack {
                                Text("Cloud ID")
                                Spacer()
                                Text(team.sharedTeamId ?? "Not yet synced")
                                    .font(.footnote.monospaced())
                                    .foregroundStyle(.secondary)
                            }
                            Button {
                                Task { await onSyncNow() }
                            } label: {
                                Label(isSyncing ? "Syncing…" : "Sync Teams Now", systemImage: "arrow.triangle.2.circlepath")
                            }
                            .disabled(isSyncing || isDeleting)
                        }
                    }
                } else {
                    Section("Local Mode (Not Signed In)") {
                        Text("Your teams and walk-up songs are stored on this device only. Sign in to back up and sync rosters across devices.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Button {
                            dismiss()
                            onSignIn()
                        } label: {
                            Label("Sign In to Sync…", systemImage: "person.crop.circle.badge.plus")
                        }
                    }
                }

                Section("Subscription") {
                    if proManager.isPro {
                        Label("Dugout DJ Pro Active", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(Color.accentColor)

                        Button {
                            showingManageSubscriptions = true
                        } label: {
                            Label("Manage Subscription", systemImage: "creditcard")
                        }
                    } else {
                        Button {
                            showingPaywall = true
                        } label: {
                            Label("Upgrade to Dugout DJ Pro — \(proManager.displayPrice)/yr", systemImage: "star.circle.fill")
                        }

                        Button {
                            Task { await proManager.restorePurchases() }
                        } label: {
                            Label("Restore Purchases", systemImage: "arrow.clockwise")
                        }
                        .disabled(proManager.isPurchasing)
                    }

                    if let status = proManager.statusMessage {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let error = proManager.errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    Link(destination: privacyPolicyURL) {
                        Label("Privacy Policy & Support", systemImage: "hand.raised")
                    }
                }

                if isSignedIn {
                    Section {
                        Button(role: .destructive) {
                            Task {
                                await onSignOut()
                                dismiss()
                            }
                        } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        .disabled(isDeleting)

                        Button(role: .destructive) {
                            confirmDeleteAccount = true
                        } label: {
                            Label(
                                isDeleting ? "Deleting Account…" : "Delete Account…",
                                systemImage: "trash"
                            )
                        }
                        .disabled(isDeleting)
                    }
                }
            }
            .navigationTitle("Coach Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isDeleting)
                }
            }
            .sheet(isPresented: $showingPaywall) {
                ProPaywallView()
                    .environmentObject(proManager)
            }
            .confirmationDialog(
                "Delete your Dugout DJ account?",
                isPresented: $confirmDeleteAccount,
                titleVisibility: .visible
            ) {
                Button("Delete Account and Cloud Data", role: .destructive) {
                    Task {
                        isDeleting = true
                        defer { isDeleting = false }
                        do {
                            try await onDeleteAccount()
                            dismiss()
                        } catch {
                            deleteError = error.localizedDescription
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently deletes your coach account, cloud-synced teams, and local cache. This cannot be undone.")
            }
            .alert(
                "Couldn't Delete Account",
                isPresented: Binding(
                    get: { deleteError != nil },
                    set: { if !$0 { deleteError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteError ?? "")
            }
        }
        .manageSubscriptionsSheet(isPresented: $showingManageSubscriptions)
    }
}
