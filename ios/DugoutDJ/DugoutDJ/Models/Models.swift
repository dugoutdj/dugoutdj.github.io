import Foundation

enum SongSource: String, Codable, CaseIterable {
    case mediaLibrary
    case localFile
    case r2Clip
    case preview
    case youtube
    case none

    var displayLabel: String {
        switch self {
        case .mediaLibrary: return "Music Library"
        case .localFile: return "Audio File"
        case .r2Clip: return "Parent Clip"
        case .preview: return "Catalog Preview"
        case .youtube: return "YouTube"
        case .none: return "No Song"
        }
    }
}

struct Player: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var pronounced: String = ""
    var number: String = ""
    var songTitle: String = ""
    var artistName: String = ""
    var songSource: SongSource = .none
    var mediaPersistentID: UInt64?
    var localFileName: String?
    var mp3Key: String?
    var previewURL: String?
    var songVideoId: String?
    var startTime: Double = 0
    var duration: Double = 10
    var songDuration: Double = 0
    var updatedAt: Double = Date().timeIntervalSince1970 * 1000

    var effectivePronounced: String {
        let trimmed = pronounced.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? name : trimmed
    }

    var hasSong: Bool {
        switch songSource {
        case .mediaLibrary:
            return mediaPersistentID != nil
        case .localFile:
            return !(localFileName ?? "").isEmpty
        case .r2Clip:
            return !(mp3Key ?? "").isEmpty
        case .preview:
            return !(previewURL ?? "").isEmpty
        case .youtube:
            return !(songVideoId ?? "").isEmpty
        case .none:
            return false
        }
    }

    var isPlayableNatively: Bool {
        switch songSource {
        case .mediaLibrary, .localFile, .r2Clip, .preview, .youtube:
            return hasSong
        case .none:
            return false
        }
    }
}

struct Team: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var sharedTeamId: String?
    var announcerEnabled: Bool = true
    var players: [Player] = []
}

struct AppStateSnapshot: Codable {
    var teams: [Team]
    var selectedTeamID: String?
}

// MARK: - Shared Roster API DTOs (https://dugoutdj.com/api/team)

struct SharedPlayerDTO: Codable {
    var id: String
    var name: String
    var pronounced: String?
    var number: String?
    var songTitle: String?
    var previewUrl: String?
    var artworkUrl: String?
    var appleTrackId: String?
    var songVideoId: String?
    var songThumbnail: String?
    var mp3Key: String?
    var startTime: Double?
    var duration: Double?
    var songSource: String?
    var updatedAt: Double?
    var lastChangedBy: String?
}

struct SharedTeamPayload: Codable {
    let name: String
    let players: [SharedPlayerDTO]
    let teamId: String?
}

struct CreateTeamResponse: Codable {
    let teamId: String
}

struct SharedTeamResponse: Codable {
    let name: String
    let players: [SharedPlayerDTO]
    let updatedAt: Double?
    let order: [String]?
    let orderUpdatedAt: Double?
}

struct UpdateOrderPayload: Codable {
    let order: [String]
}

struct UpdateOrderResponse: Codable {
    let ok: Bool?
    let order: [String]?
    let orderUpdatedAt: Double?
}

// MARK: - Auth & Coach Account DTOs

struct RequestLinkPayload: Codable {
    let email: String
    let platform: String
}

struct VerifyLoginPayload: Codable {
    let token: String
}

struct VerifyLoginResponse: Codable {
    let ok: Bool?
    let email: String
    let sessionToken: String?
}

struct AuthMeResponse: Codable {
    let authenticated: Bool
    let email: String?
}

struct AccountTeamDTO: Codable {
    let sharedTeamId: String
    let name: String
    let players: [SharedPlayerDTO]
    let revision: Int?
    let updatedAt: Double?
}

struct AccountTeamsResponse: Codable {
    let teams: [AccountTeamDTO]
}

struct ClaimAccountTeamPayload: Codable {
    let sharedTeamId: String
    let name: String
    let players: [SharedPlayerDTO]
}

struct AccountTeamWriteResponse: Codable {
    let ok: Bool?
    let sharedTeamId: String?
}

struct YouTubeVideoInfo {
    let videoID: String
    let title: String
    let author: String
}

struct SongPreviewMatch {
    let title: String
    let artist: String
    let previewURL: String
}

func formatClipTime(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded(.down)))
    let mins = total / 60
    let secs = total % 60
    return String(format: "%d:%02d", mins, secs)
}
