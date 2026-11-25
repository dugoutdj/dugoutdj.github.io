import Foundation
import SwiftUI

@MainActor
final class TeamStore: ObservableObject {
    @Published var teams: [Team] = []
    @Published var selectedTeamID: String?
    @Published var isSyncing: Bool = false
    @Published var syncMessage: String?
    @Published var lastError: String?

    let clipsDirectory: URL
    private let storeURL: URL
    private var authToken: String?

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let rootDir = appSupport.appendingPathComponent("DugoutDJ", isDirectory: true)
        self.clipsDirectory = rootDir.appendingPathComponent("clips", isDirectory: true)
        self.storeURL = rootDir.appendingPathComponent("store.json")

        try? FileManager.default.createDirectory(at: rootDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: clipsDirectory, withIntermediateDirectories: true)

        load()
        if teams.isEmpty {
            let starter = Team(name: "My Team", announcerEnabled: true, players: [])
            teams = [starter]
            selectedTeamID = starter.id
            save()
        } else if selectedTeamID == nil || !teams.contains(where: { $0.id == selectedTeamID }) {
            selectedTeamID = teams.first?.id
        }
    }

    var currentTeam: Team? {
        guard let selectedTeamID else { return teams.first }
        return teams.first(where: { $0.id == selectedTeamID }) ?? teams.first
    }

    var currentTeamIndex: Int? {
        guard let current = currentTeam else { return nil }
        return teams.firstIndex(where: { $0.id == current.id })
    }

    var shareURL: URL? {
        guard let id = currentTeam?.sharedTeamId, !id.isEmpty else { return nil }
        return URL(string: "https://dugoutdj.com/team/\(id)")
    }

    func setAuthToken(_ token: String?) {
        self.authToken = token
    }

    func resetLocalData() {
        if let files = try? FileManager.default.contentsOfDirectory(at: clipsDirectory, includingPropertiesForKeys: nil) {
            for file in files {
                try? FileManager.default.removeItem(at: file)
            }
        }
        let starter = Team(name: "My Team", announcerEnabled: true, players: [])
        teams = [starter]
        selectedTeamID = starter.id
        syncMessage = nil
        lastError = nil
        save()
    }

    func clipFileURL(for fileName: String) -> URL {
        clipsDirectory.appendingPathComponent(fileName)
    }

    func importAudioFile(from sourceURL: URL) throws -> String {
        let didAccess = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let ext = sourceURL.pathExtension.isEmpty ? "m4a" : sourceURL.pathExtension.lowercased()
        let fileName = "local_\(UUID().uuidString).\(ext)"
        let destination = clipsDirectory.appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: sourceURL, to: destination)
        return fileName
    }

    // MARK: - Team Management

    func selectTeam(_ team: Team) {
        selectedTeamID = team.id
        save()
    }

    func addTeam(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let team = Team(name: trimmed, announcerEnabled: true, players: [])
        teams.append(team)
        selectedTeamID = team.id
        save()
        scheduleCloudSync(for: team.id)
    }

    func renameTeam(id: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let idx = teams.firstIndex(where: { $0.id == id }) else { return }
        teams[idx].name = trimmed
        save()
        scheduleCloudSync(for: id)
    }

    func deleteTeam(id: String) {
        teams.removeAll { $0.id == id }
        if teams.isEmpty {
            let fallback = Team(name: "My Team", announcerEnabled: true, players: [])
            teams = [fallback]
        }
        if selectedTeamID == id || !teams.contains(where: { $0.id == selectedTeamID }) {
            selectedTeamID = teams.first?.id
        }
        save()
    }

    func toggleAnnouncer(for teamID: String) {
        guard let idx = teams.firstIndex(where: { $0.id == teamID }) else { return }
        teams[idx].announcerEnabled.toggle()
        save()
    }

    // MARK: - Player Management

    func upsertPlayer(_ player: Player, in teamID: String) {
        guard let tIdx = teams.firstIndex(where: { $0.id == teamID }) else { return }
        var updated = player
        updated.updatedAt = Date().timeIntervalSince1970 * 1000

        if let pIdx = teams[tIdx].players.firstIndex(where: { $0.id == player.id }) {
            let previousFile = teams[tIdx].players[pIdx].localFileName
            if let previousFile, previousFile != updated.localFileName {
                removeLocalClipIfUnused(previousFile, excludingPlayerID: player.id)
            }
            teams[tIdx].players[pIdx] = updated
        } else {
            teams[tIdx].players.append(updated)
        }
        save()
        scheduleCloudSync(for: teamID)
    }

    func deletePlayers(at offsets: IndexSet, in teamID: String) {
        guard let tIdx = teams.firstIndex(where: { $0.id == teamID }) else { return }
        let removed = offsets.map { teams[tIdx].players[$0] }
        teams[tIdx].players.remove(atOffsets: offsets)
        for p in removed {
            if let fileName = p.localFileName {
                removeLocalClipIfUnused(fileName, excludingPlayerID: p.id)
            }
        }
        save()
        scheduleCloudSync(for: teamID)
    }

    func deletePlayer(id: String, in teamID: String) {
        guard let tIdx = teams.firstIndex(where: { $0.id == teamID }),
              let pIdx = teams[tIdx].players.firstIndex(where: { $0.id == id }) else { return }
        let removed = teams[tIdx].players.remove(at: pIdx)
        if let fileName = removed.localFileName {
            removeLocalClipIfUnused(fileName, excludingPlayerID: removed.id)
        }
        save()
        scheduleCloudSync(for: teamID)
    }

    func movePlayers(from source: IndexSet, to destination: Int, in teamID: String) {
        guard let tIdx = teams.firstIndex(where: { $0.id == teamID }) else { return }
        teams[tIdx].players.move(fromOffsets: source, toOffset: destination)
        save()
        scheduleCloudSync(for: teamID)

        if let sharedId = teams[tIdx].sharedTeamId, !sharedId.isEmpty {
            let order = teams[tIdx].players.map(\.id)
            let token = authToken
            Task {
                try? await DugoutAPI.updateBattingOrder(teamId: sharedId, order: order, token: token)
            }
        }
    }

    // MARK: - Cloud Sync (dugoutdj.com/api/account/team)

    func syncAllNow() async {
        guard authToken != nil else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        for id in teams.map(\.id) {
            await syncTeamToCloud(teamID: id)
        }
        await syncFromCloud()
        if lastError == nil {
            syncMessage = "Teams synced with your Dugout DJ account."
        }
    }

    func syncFromCloud() async {
        guard let token = authToken, !token.isEmpty else { return }
        isSyncing = true
        defer { isSyncing = false }

        do {
            let remoteTeams = try await DugoutAPI.fetchAccountTeams(token: token)
            var r2KeysToCache: [String] = []

            let hasOnlyEmptyStarter = teams.count == 1
                && teams[0].sharedTeamId == nil
                && teams[0].players.isEmpty
                && teams[0].name == "My Team"

            if hasOnlyEmptyStarter && !remoteTeams.isEmpty {
                teams = []
                selectedTeamID = nil
            }

            for remote in remoteTeams {
                if let idx = teams.firstIndex(where: { $0.sharedTeamId == remote.sharedTeamId }) {
                    var localTeam = teams[idx]
                    if !remote.name.isEmpty {
                        localTeam.name = remote.name
                    }
                    var mergedPlayers: [Player] = []
                    var seenIDs = Set<String>()

                    for rp in remote.players {
                        seenIDs.insert(rp.id)
                        if let existing = localTeam.players.first(where: { $0.id == rp.id }) {
                            let remoteUpdated = rp.updatedAt ?? 0
                            if remoteUpdated > existing.updatedAt {
                                mergedPlayers.append(mergePlayer(local: existing, remote: rp, r2KeysToCache: &r2KeysToCache))
                            } else {
                                mergedPlayers.append(existing)
                                if existing.songSource == .r2Clip, let key = existing.mp3Key, !key.isEmpty {
                                    r2KeysToCache.append(key)
                                }
                            }
                        } else {
                            mergedPlayers.append(makeLocalPlayer(from: rp, r2KeysToCache: &r2KeysToCache))
                        }
                    }

                    for localPlayer in localTeam.players where !seenIDs.contains(localPlayer.id) {
                        mergedPlayers.append(localPlayer)
                    }

                    localTeam.players = mergedPlayers
                    teams[idx] = localTeam
                } else {
                    let newPlayers = remote.players.map { makeLocalPlayer(from: $0, r2KeysToCache: &r2KeysToCache) }
                    let newTeam = Team(
                        name: remote.name,
                        sharedTeamId: remote.sharedTeamId,
                        announcerEnabled: true,
                        players: newPlayers
                    )
                    teams.append(newTeam)
                }
            }

            if teams.isEmpty {
                teams = [Team(name: "My Team", announcerEnabled: true, players: [])]
            }
            if selectedTeamID == nil || !teams.contains(where: { $0.id == selectedTeamID }) {
                selectedTeamID = teams.first?.id
            }
            save()

            let unlinkedIDs = teams.filter { $0.sharedTeamId == nil }.map(\.id)
            for id in unlinkedIDs {
                await syncTeamToCloud(teamID: id)
            }

            for key in Set(r2KeysToCache) {
                let dest = clipFileURL(for: key)
                if !FileManager.default.fileExists(atPath: dest.path),
                   let data = try? await DugoutAPI.downloadClip(mp3Key: key) {
                    try? data.write(to: dest, options: .atomic)
                }
            }
        } catch {
            lastError = "Cloud sync failed: \(error.localizedDescription)"
        }
    }

    func syncTeamToCloud(teamID: String) async {
        guard let token = authToken, !token.isEmpty,
              let idx = teams.firstIndex(where: { $0.id == teamID }) else { return }

        var team = teams[idx]
        let dtoPlayers = makeSharedPlayerDTOs(for: team)

        do {
            let sharedId: String
            if let existingId = team.sharedTeamId, !existingId.isEmpty {
                sharedId = existingId
                let payload = ClaimAccountTeamPayload(
                    sharedTeamId: sharedId,
                    name: team.name,
                    players: dtoPlayers
                )
                do {
                    try await DugoutAPI.syncAccountTeam(payload, token: token)
                } catch DugoutAPIError.serverError(let status, _) where status == 404 {
                    try await DugoutAPI.claimAccountTeam(payload, token: token)
                }
                if !team.players.isEmpty {
                    _ = try? await DugoutAPI.publishTeam(SharedTeamPayload(name: team.name, players: dtoPlayers, teamId: sharedId), token: token)
                }
            } else {
                let kvPayload = SharedTeamPayload(name: team.name, players: dtoPlayers, teamId: nil)
                sharedId = try await DugoutAPI.publishTeam(kvPayload, token: token)
                if let liveIdx = teams.firstIndex(where: { $0.id == teamID }) {
                    teams[liveIdx].sharedTeamId = sharedId
                    team = teams[liveIdx]
                    save()
                }
                let accountPayload = ClaimAccountTeamPayload(
                    sharedTeamId: sharedId,
                    name: team.name,
                    players: dtoPlayers
                )
                try await DugoutAPI.claimAccountTeam(accountPayload, token: token)
            }
        } catch {
            // Best-effort background sync; local save remains intact.
        }
    }

    private func scheduleCloudSync(for teamID: String) {
        guard authToken != nil else { return }
        Task {
            await syncTeamToCloud(teamID: teamID)
        }
    }

    // MARK: - Parent Link Sync (dugoutdj.com/api/team)

    func shareTeamWithParents() async -> URL? {
        guard let idx = currentTeamIndex else { return nil }
        let team = teams[idx]
        guard !team.players.isEmpty else {
            lastError = "Add at least one player before sharing with parents."
            return nil
        }

        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        let dtoPlayers = makeSharedPlayerDTOs(for: team)
        let payload = SharedTeamPayload(
            name: team.name,
            players: dtoPlayers,
            teamId: team.sharedTeamId
        )

        do {
            let sharedId = try await DugoutAPI.publishTeam(payload, token: authToken)
            teams[idx].sharedTeamId = sharedId
            save()
            if let token = authToken, !token.isEmpty {
                let claim = ClaimAccountTeamPayload(sharedTeamId: sharedId, name: team.name, players: dtoPlayers)
                try? await DugoutAPI.claimAccountTeam(claim, token: token)
            }
            let url = URL(string: "https://dugoutdj.com/team/\(sharedId)")
            syncMessage = "Parent link ready: dugoutdj.com/team/\(sharedId)"
            return url
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    func pullParentUpdates() async {
        guard let idx = currentTeamIndex,
              let sharedId = teams[idx].sharedTeamId,
              !sharedId.isEmpty else {
            lastError = "Share this team with parents first to get a team link."
            return
        }

        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        do {
            let remote = try await DugoutAPI.fetchSharedTeam(id: sharedId)
            var applied = 0
            var r2KeysToCache: [String] = []

            for remotePlayer in remote.players {
                guard let localIdx = teams[idx].players.firstIndex(where: { $0.id == remotePlayer.id }) else {
                    continue
                }
                let local = teams[idx].players[localIdx]
                let remoteUpdated = remotePlayer.updatedAt ?? 0
                let changedByParent = remotePlayer.lastChangedBy == "parent"
                let isNewerParentEdit = changedByParent && (remoteUpdated > local.updatedAt || !local.hasSong)

                guard isNewerParentEdit else { continue }

                var updated = local
                if let pronounced = remotePlayer.pronounced, !pronounced.isEmpty {
                    updated.pronounced = pronounced
                }
                updated.songTitle = remotePlayer.songTitle ?? ""
                updated.startTime = remotePlayer.startTime ?? 0
                updated.duration = max(1, remotePlayer.duration ?? 10)
                updated.updatedAt = remoteUpdated > 0 ? remoteUpdated : Date().timeIntervalSince1970 * 1000

                if remotePlayer.songSource == "mp3", let key = remotePlayer.mp3Key, !key.isEmpty {
                    updated.songSource = .r2Clip
                    updated.mp3Key = key
                    updated.previewURL = nil
                    updated.songVideoId = nil
                    updated.mediaPersistentID = nil
                    updated.localFileName = nil
                    r2KeysToCache.append(key)
                } else if remotePlayer.songSource == "apple", let url = remotePlayer.previewUrl, !url.isEmpty {
                    updated.songSource = .preview
                    updated.previewURL = url
                    updated.mp3Key = nil
                    updated.songVideoId = nil
                    updated.mediaPersistentID = nil
                    updated.localFileName = nil
                } else if let vid = remotePlayer.songVideoId, !vid.isEmpty {
                    updated.songSource = .youtube
                    updated.songVideoId = vid
                    updated.previewURL = nil
                    updated.mp3Key = nil
                    updated.mediaPersistentID = nil
                    updated.localFileName = nil
                }

                if updated != local {
                    teams[idx].players[localIdx] = updated
                    applied += 1
                }
            }

            if applied > 0 {
                save()
            }

            // Pre-cache any parent-uploaded R2 clips for offline field playback.
            for key in r2KeysToCache {
                let dest = clipFileURL(for: key)
                if !FileManager.default.fileExists(atPath: dest.path),
                   let data = try? await DugoutAPI.downloadClip(mp3Key: key) {
                    try? data.write(to: dest, options: .atomic)
                }
            }

            syncMessage = applied > 0
                ? "Applied \(applied) parent song update\(applied == 1 ? "" : "s")."
                : "Roster is up to date."
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - DTO Mapping

    private func makeSharedPlayerDTOs(for team: Team) -> [SharedPlayerDTO] {
        team.players.map { p in
            let webSource: String
            switch p.songSource {
            case .r2Clip: webSource = "mp3"
            case .preview: webSource = "apple"
            case .youtube: webSource = "youtube"
            case .mediaLibrary, .localFile, .none: webSource = ""
            }
            return SharedPlayerDTO(
                id: p.id,
                name: p.name,
                pronounced: p.effectivePronounced,
                number: p.number,
                songTitle: p.songTitle,
                previewUrl: p.songSource == .preview ? (p.previewURL ?? "") : "",
                artworkUrl: "",
                appleTrackId: "",
                songVideoId: p.songVideoId ?? "",
                songThumbnail: "",
                mp3Key: p.mp3Key ?? "",
                startTime: p.startTime,
                duration: p.duration,
                songSource: webSource,
                updatedAt: p.updatedAt,
                lastChangedBy: "coach"
            )
        }
    }

    private func mergePlayer(local: Player, remote: SharedPlayerDTO, r2KeysToCache: inout [String]) -> Player {
        var updated = local
        if !remote.name.isEmpty {
            updated.name = remote.name
        }
        if let pronounced = remote.pronounced, !pronounced.isEmpty {
            updated.pronounced = pronounced
        }
        if let number = remote.number {
            updated.number = number
        }
        if let title = remote.songTitle, !title.isEmpty {
            updated.songTitle = title
        }
        updated.startTime = remote.startTime ?? local.startTime
        updated.duration = max(1, remote.duration ?? local.duration)
        updated.updatedAt = remote.updatedAt ?? local.updatedAt

        if remote.songSource == "mp3", let key = remote.mp3Key, !key.isEmpty {
            updated.songSource = .r2Clip
            updated.mp3Key = key
            updated.previewURL = nil
            updated.songVideoId = nil
            updated.mediaPersistentID = nil
            updated.localFileName = nil
            r2KeysToCache.append(key)
        } else if remote.songSource == "apple", let url = remote.previewUrl, !url.isEmpty {
            updated.songSource = .preview
            updated.previewURL = url
            updated.mp3Key = nil
            updated.songVideoId = nil
            updated.mediaPersistentID = nil
            updated.localFileName = nil
        } else if let vid = remote.songVideoId, !vid.isEmpty {
            updated.songSource = .youtube
            updated.songVideoId = vid
            updated.previewURL = nil
            updated.mp3Key = nil
            updated.mediaPersistentID = nil
            updated.localFileName = nil
        }
        return updated
    }

    private func makeLocalPlayer(from remote: SharedPlayerDTO, r2KeysToCache: inout [String]) -> Player {
        var source: SongSource = .none
        var mp3Key: String? = nil
        var previewURL: String? = nil
        var videoId: String? = nil

        if remote.songSource == "mp3", let key = remote.mp3Key, !key.isEmpty {
            source = .r2Clip
            mp3Key = key
            r2KeysToCache.append(key)
        } else if remote.songSource == "apple", let url = remote.previewUrl, !url.isEmpty {
            source = .preview
            previewURL = url
        } else if let vid = remote.songVideoId, !vid.isEmpty {
            source = .youtube
            videoId = vid
        }

        return Player(
            id: remote.id,
            name: remote.name,
            pronounced: remote.pronounced ?? "",
            number: remote.number ?? "",
            songTitle: remote.songTitle ?? "",
            artistName: "",
            songSource: source,
            mediaPersistentID: nil,
            localFileName: nil,
            mp3Key: mp3Key,
            previewURL: previewURL,
            songVideoId: videoId,
            startTime: remote.startTime ?? 0,
            duration: max(1, remote.duration ?? 10),
            updatedAt: remote.updatedAt ?? Date().timeIntervalSince1970 * 1000
        )
    }

    // MARK: - Disk Persistence

    private func load() {
        guard let data = try? Data(contentsOf: storeURL),
              let snapshot = try? JSONDecoder().decode(AppStateSnapshot.self, from: data) else {
            return
        }
        teams = snapshot.teams
        selectedTeamID = snapshot.selectedTeamID
    }

    private func save() {
        let snapshot = AppStateSnapshot(teams: teams, selectedTeamID: selectedTeamID)
        if let data = try? JSONEncoder().encode(snapshot) {
            try? data.write(to: storeURL, options: .atomic)
        }
    }

    private func removeLocalClipIfUnused(_ fileName: String, excludingPlayerID: String) {
        let stillUsed = teams.flatMap(\.players).contains {
            $0.id != excludingPlayerID && $0.localFileName == fileName
        }
        guard !stillUsed else { return }
        let url = clipFileURL(for: fileName)
        try? FileManager.default.removeItem(at: url)
    }
}
