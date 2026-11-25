import Foundation
import MediaPlayer

struct WalkUpPreset: Identifiable, Codable, Hashable {
    let id: String
    let rank: Int
    let title: String
    let artist: String
    let genre: String
    let vibe: String
    let clean: Bool
    let startTime: Double
    let duration: Double

    var displayTitle: String {
        artist.isEmpty ? title : "\(artist) - \(title)"
    }

    var youtubeSearchURL: URL? {
        var components = URLComponents(string: "https://www.youtube.com/results")
        components?.queryItems = [
            URLQueryItem(name: "search_query", value: "\(title) \(artist)")
        ]
        return components?.url
    }
}

enum WalkUpCatalog {
    static let genres: [String] = [
        "All", "Rock", "Hip-Hop", "Pop", "Country", "EDM", "Classic", "Latin"
    ]

    static let presets: [WalkUpPreset] = loadFromBundle()

    private static func loadFromBundle() -> [WalkUpPreset] {
        guard let url = Bundle.main.url(forResource: "walkup_catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([WalkUpPreset].self, from: data) else {
            return []
        }
        return decoded
    }

    static func findAppleMusicMatch(for preset: WalkUpPreset) -> PickedMediaTrack? {
        #if targetEnvironment(simulator)
        return nil
        #else
        guard MPMediaLibrary.authorizationStatus() == .authorized else {
            return nil
        }

        let targetTitle = normalizeForMatch(preset.title)
        let primaryArtist = normalizeForMatch(stripFeaturedArtist(preset.artist))
        guard !targetTitle.isEmpty else { return nil }

        let titlePredicate = MPMediaPropertyPredicate(
            value: preset.title,
            forProperty: MPMediaItemPropertyTitle,
            comparisonType: .contains
        )
        let query = MPMediaQuery.songs()
        query.addFilterPredicate(titlePredicate)

        guard let items = query.items, !items.isEmpty else {
            return nil
        }

        let scored: [(item: MPMediaItem, score: Int)] = items.compactMap { item in
            let itemTitle = normalizeForMatch(item.title ?? "")
            let itemArtist = normalizeForMatch(item.artist ?? "")
            guard itemTitle == targetTitle || itemTitle.contains(targetTitle) else {
                return nil
            }
            var score = (itemTitle == targetTitle) ? 50 : 20
            if !primaryArtist.isEmpty {
                if itemArtist == primaryArtist || itemArtist.contains(primaryArtist) || primaryArtist.contains(itemArtist) {
                    score += 50
                } else {
                    return nil
                }
            }
            if !item.isCloudItem {
                score += 10
            }
            return (item, score)
        }

        guard let best = scored.max(by: { $0.score < $1.score })?.item else {
            return nil
        }

        return PickedMediaTrack(
            persistentID: best.persistentID,
            title: best.title ?? preset.title,
            artist: best.artist ?? preset.artist,
            playbackDuration: best.playbackDuration,
            isCloudItem: best.isCloudItem
        )
        #endif
    }

    private static func stripFeaturedArtist(_ artist: String) -> String {
        artist.replacingOccurrences(
            of: #"\s+(?:feat\.?|ft\.?|&|x)\s+.*$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
    }

    private static func normalizeForMatch(_ raw: String) -> String {
        let stripped = raw.replacingOccurrences(
            of: #"\([^)]*\)"#,
            with: " ",
            options: .regularExpression
        )
        let alnum = stripped.lowercased().replacingOccurrences(
            of: #"[^a-z0-9]+"#,
            with: " ",
            options: .regularExpression
        )
        return alnum.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
