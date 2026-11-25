import Foundation

enum DugoutAPIError: LocalizedError {
    case invalidURL
    case serverError(status: Int, message: String)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid DugoutDJ server URL."
        case .serverError(_, let message):
            return message
        case .emptyResponse:
            return "Empty response from DugoutDJ server."
        }
    }
}

private struct APIErrorPayload: Decodable {
    let error: String?
}

struct DugoutAPI {
    static let baseURL = URL(string: "https://dugoutdj.com/api")!

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config)
    }()

    static func fetchAnnouncement(name: String, number: String) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent("announce"), resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "name", value: name)]
        let cleanNumber = number.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanNumber.isEmpty {
            items.append(URLQueryItem(name: "number", value: cleanNumber))
        }
        components?.queryItems = items

        guard let url = components?.url else {
            throw DugoutAPIError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        try validate(response: response, data: data)
        guard !data.isEmpty else {
            throw DugoutAPIError.emptyResponse
        }
        return data
    }

    static func publishTeam(_ payload: SharedTeamPayload, token: String? = nil) async throws -> String {
        let url = baseURL.appendingPathComponent("team")
        let request = try jsonRequest(url: url, method: "POST", token: token, body: payload)

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        let decoded = try JSONDecoder().decode(CreateTeamResponse.self, from: data)
        return decoded.teamId
    }

    static func fetchSharedTeam(id: String) async throws -> SharedTeamResponse {
        let url = baseURL.appendingPathComponent("team").appendingPathComponent(id)
        let (data, response) = try await session.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(SharedTeamResponse.self, from: data)
    }

    static func updateBattingOrder(teamId: String, order: [String], token: String? = nil) async throws {
        let url = baseURL
            .appendingPathComponent("team")
            .appendingPathComponent(teamId)
            .appendingPathComponent("order")
        let request = try jsonRequest(url: url, method: "PUT", token: token, body: UpdateOrderPayload(order: order))

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    static func downloadClip(mp3Key: String) async throws -> Data {
        let url = baseURL.appendingPathComponent("audio").appendingPathComponent(mp3Key)
        let (data, response) = try await session.data(from: url)
        try validate(response: response, data: data)
        guard !data.isEmpty else {
            throw DugoutAPIError.emptyResponse
        }
        return data
    }

    static func searchSongPreview(title: String, artist: String) async throws -> SongPreviewMatch? {
        let term = "\(title) \(artist)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return nil }

        var components = URLComponents(url: baseURL.appendingPathComponent("search"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "term", value: term),
            URLQueryItem(name: "limit", value: "5")
        ]
        guard let url = components?.url else {
            throw DugoutAPIError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        try validate(response: response, data: data)

        struct SearchTrackDTO: Decodable {
            let trackName: String?
            let artistName: String?
            let previewUrl: String?
        }
        struct SearchResponseDTO: Decodable {
            let results: [SearchTrackDTO]?
        }

        let decoded = try JSONDecoder().decode(SearchResponseDTO.self, from: data)
        guard let match = (decoded.results ?? []).first(where: { !($0.previewUrl ?? "").isEmpty }),
              let previewUrl = match.previewUrl, !previewUrl.isEmpty else {
            return nil
        }

        return SongPreviewMatch(
            title: match.trackName ?? title,
            artist: match.artistName ?? artist,
            previewURL: previewUrl
        )
    }

    static func downloadPreviewAudio(previewURL: String) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent("media"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "url", value: previewURL)]

        if let proxyURL = components?.url {
            do {
                let (data, response) = try await session.data(from: proxyURL)
                try validate(response: response, data: data)
                if !data.isEmpty {
                    return data
                }
            } catch {
                // Fall back to direct CDN fetch below if proxy fetch fails.
            }
        }

        guard let directURL = URL(string: previewURL) else {
            throw DugoutAPIError.invalidURL
        }
        let (data, response) = try await session.data(from: directURL)
        try validate(response: response, data: data)
        guard !data.isEmpty else {
            throw DugoutAPIError.emptyResponse
        }
        return data
    }

    // MARK: - Auth & Coach Account

    static func requestLoginLink(email: String, platform: String = "ios") async throws {
        let url = baseURL.appendingPathComponent("auth/request-link")
        let request = try jsonRequest(url: url, method: "POST", token: nil, body: RequestLinkPayload(email: email, platform: platform))
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    static func verifyLoginToken(_ token: String) async throws -> VerifyLoginResponse {
        let url = baseURL.appendingPathComponent("auth/verify")
        let request = try jsonRequest(url: url, method: "POST", token: nil, body: VerifyLoginPayload(token: token))
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(VerifyLoginResponse.self, from: data)
    }

    static func fetchCurrentCoach(token: String) async throws -> AuthMeResponse {
        let url = baseURL.appendingPathComponent("auth/me")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(AuthMeResponse.self, from: data)
    }

    static func logout(token: String) async {
        let url = baseURL.appendingPathComponent("auth/logout")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }

    static func deleteAccount(token: String) async throws {
        let url = baseURL.appendingPathComponent("account")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    static func fetchAccountTeams(token: String) async throws -> [AccountTeamDTO] {
        let url = baseURL.appendingPathComponent("account/team")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(AccountTeamsResponse.self, from: data).teams
    }

    static func claimAccountTeam(_ payload: ClaimAccountTeamPayload, token: String) async throws {
        let url = baseURL.appendingPathComponent("account/team")
        let request = try jsonRequest(url: url, method: "POST", token: token, body: payload)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    static func syncAccountTeam(_ payload: ClaimAccountTeamPayload, token: String) async throws {
        let url = baseURL.appendingPathComponent("account/team")
        let request = try jsonRequest(url: url, method: "PUT", token: token, body: payload)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    // MARK: - YouTube Helpers

    static func extractYouTubeVideoID(from input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let idPattern = "^[a-zA-Z0-9_-]{11}$"
        if trimmed.range(of: idPattern, options: .regularExpression) != nil {
            return trimmed
        }

        var candidate = trimmed
        if let matchRange = trimmed.range(of: "https?://\\S+", options: [.regularExpression, .caseInsensitive]) {
            candidate = String(trimmed[matchRange]).trimmingCharacters(in: CharacterSet(charactersIn: ".,!?;:)>]"))
        } else if trimmed.range(of: "^(?:(?:www\\.|m\\.|music\\.)?(?:youtube\\.com|youtube-nocookie\\.com)|youtu\\.be)/", options: [.regularExpression, .caseInsensitive]) != nil {
            candidate = "https://\(trimmed)"
        } else {
            return nil
        }

        guard let components = URLComponents(string: candidate),
              let host = components.host?.lowercased() else {
            return nil
        }

        var extracted: String?
        if host == "youtu.be" || host == "www.youtu.be" {
            extracted = components.path.split(separator: "/").first.map(String.init)
        } else if host == "youtube.com" || host.hasSuffix(".youtube.com") || host == "youtube-nocookie.com" || host.hasSuffix(".youtube-nocookie.com") {
            extracted = components.queryItems?.first(where: { $0.name == "v" })?.value
            if extracted == nil {
                let parts = components.path.split(separator: "/").map(String.init)
                if parts.count >= 2, ["embed", "shorts", "live", "v"].contains(parts[0]) {
                    extracted = parts[1]
                }
            }
        }

        guard let extracted,
              extracted.range(of: idPattern, options: .regularExpression) != nil else {
            return nil
        }
        return extracted
    }

    static func fetchYouTubeInfo(videoId: String) async throws -> YouTubeVideoInfo {
        var components = URLComponents(string: "https://www.youtube.com/oembed")
        components?.queryItems = [
            URLQueryItem(name: "url", value: "https://www.youtube.com/watch?v=\(videoId)"),
            URLQueryItem(name: "format", value: "json")
        ]
        guard let url = components?.url else {
            throw DugoutAPIError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw DugoutAPIError.emptyResponse
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw DugoutAPIError.serverError(
                status: http.statusCode,
                message: "This track doesn't allow embedding in other apps — try a different YouTube version or pick from Apple Music / Audio File."
            )
        }
        if http.statusCode == 404 {
            throw DugoutAPIError.serverError(
                status: 404,
                message: "Couldn't find that YouTube song — check the link and try again."
            )
        }
        try validate(response: response, data: data)

        struct OEmbedDTO: Decodable {
            let title: String?
            let author_name: String?
        }
        let dto = try JSONDecoder().decode(OEmbedDTO.self, from: data)
        return YouTubeVideoInfo(
            videoID: videoId,
            title: dto.title ?? "YouTube Song",
            author: dto.author_name ?? ""
        )
    }

    private static func jsonRequest<T: Encodable>(url: URL, method: String, token: String?, body: T) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private static func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw DugoutAPIError.emptyResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let apiError = (try? JSONDecoder().decode(APIErrorPayload.self, from: data))?.error
            throw DugoutAPIError.serverError(
                status: http.statusCode,
                message: apiError ?? "Request failed (HTTP \(http.statusCode))."
            )
        }
    }
}
