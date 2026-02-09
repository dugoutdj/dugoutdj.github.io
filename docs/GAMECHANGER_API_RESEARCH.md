# GameChanger API Research

This document contains research on the GameChanger Team Manager API for potential future integration.

## API Endpoint

```
GET https://api.team-manager.gc.com/teams/{team_id}/players
```

## Example Request (cURL)

```bash
curl 'https://api.team-manager.gc.com/teams/ba91cfd8-4cd1-42a0-8172-57b15e8caa17/players' \
  -X GET \
  -H "Accept-Language: en-US,en;q=0.9" \
  -H "Accept-Encoding: gzip, deflate, br, zstd" \
  -H "Referer: https://web.gc.com/" \
  -H "Sec-Fetch-Dest: empty" \
  -H "Sec-Fetch-Mode: cors" \
  -H "Sec-Fetch-Site: same-site" \
  -H "Origin: https://web.gc.com" \
  -H "Content-Type: application/vnd.gc.com.none+json; version=undefined" \
  -H "Accept: application/vnd.gc.com.player:list+json; version=0.1.0" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36" \
  -H "x-pagination: true" \
  -H "gc-device-id: 91547a8907efe74abade53726186c167" \
  -H "gc-app-name: web" \
  -H "gc-user-action: data_loading:team" \
  -H "sec-ch-ua-mobile: ?0" \
  -H "gc-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImZkNGI0OTA0LTM5ZTAtNDhjYS1hOTMyLTU5ZDFlNDVhY2EzMCJ9..."
```

## Required Headers

| Header | Purpose | Notes |
|--------|---------|-------|
| `gc-token` | JWT authentication token | User-specific, stored in localStorage as `eden-auth-tokens` |
| `gc-device-id` | Device identifier | Persistent device fingerprint |
| `gc-app-name` | Application identifier | Always "web" for web app |
| `gc-user-action` | Action tracking | e.g., "data_loading:team" |
| `Accept` | API version negotiation | `application/vnd.gc.com.player:list+json; version=0.1.0` |
| `x-pagination` | Enable pagination | Set to "true" |
| `Origin` | CORS origin | Must be `https://web.gc.com` |
| `Referer` | CORS referer | Must be `https://web.gc.com/` |

## Response Format

```json
[
  {
    "id": "dc0c56c6-e51c-48be-b7c1-6a793b5308b9",
    "team_id": "ba91cfd8-4cd1-42a0-8172-57b15e8caa17",
    "status": "active",
    "first_name": "Landon",
    "last_name": "Yeh",
    "number": "",
    "person_id": "dc0c56c6-e51c-48be-b7c1-6a793b5308b9"
  },
  {
    "id": "1d537848-bad4-4c93-bd4b-8d1febf3e281",
    "team_id": "ba91cfd8-4cd1-42a0-8172-57b15e8caa17",
    "status": "active",
    "first_name": "Xavier",
    "last_name": "Reyes",
    "number": "",
    "person_id": "1d537848-bad4-4c93-bd4b-8d1febf3e281"
  }
]
```

### Response Fields

- **id**: UUID - Unique player identifier
- **team_id**: UUID - Team identifier (matches URL parameter)
- **status**: String - Player status (e.g., "active")
- **first_name**: String - Player's first name
- **last_name**: String - Player's last name
- **number**: String - Jersey number (can be empty)
- **person_id**: UUID - Person identifier (often same as player id)

## Authentication

The API uses JWT (JSON Web Token) authentication via the `gc-token` header.

### Token Storage
- Stored in browser localStorage under key: `eden-auth-tokens`
- Token structure appears to be a JSON object containing multiple tokens
- Must be extracted and parsed before use

### Token Extraction Pattern
```javascript
const authTokens = localStorage.getItem('eden-auth-tokens');
if (authTokens) {
  const tokens = JSON.parse(authTokens);
  const gcToken = tokens.access_token; // or similar structure
}
```

## CORS Limitations

**Current Blocker**: GameChanger API has strict CORS policies:
- Only allows requests from `https://web.gc.com` origin
- Cannot be called directly from `dugoutdj.com` or `localhost`
- Browser blocks cross-origin requests

### CORS Bypass Options

1. **Bookmarklet Approach** (Current Implementation)
   - Execute code within GameChanger's domain context
   - Extract data via DOM or authenticated API calls
   - Pass data back via URL parameters or postMessage

2. **Backend Proxy Server**
   - Set up a server-side proxy (Node.js, Python, etc.)
   - Proxy requests through server to bypass CORS
   - User provides token temporarily or via OAuth flow
   - **Cons**: Requires hosting, security concerns with token handling

3. **Browser Extension**
   - Chrome/Firefox extension with host permissions
   - Can bypass CORS restrictions
   - User installs extension, clicks import
   - **Cons**: Distribution/installation friction, maintenance

4. **OAuth Integration** (Future)
   - Official GameChanger partnership
   - OAuth flow for secure authentication
   - Direct API access without token exposure
   - **Cons**: Requires GameChanger approval/partnership

## Potential Use Cases

### 1. Enhanced Bookmarklet Import
Modify current bookmarklet to use API instead of DOM scraping:

**Advantages:**
- More reliable than DOM scraping
- Access to jersey numbers
- Access to player status (active/inactive)
- Can fetch additional data (positions, stats, etc.)

**Implementation:**
```javascript
// Within bookmarklet context on web.gc.com
const teamId = window.location.pathname.match(/teams\/([^\/]+)/)?.[1];
const authTokens = localStorage.getItem('eden-auth-tokens');
const token = JSON.parse(authTokens).access_token;

fetch(`https://api.team-manager.gc.com/teams/${teamId}/players`, {
  headers: {
    'gc-token': token,
    'Accept': 'application/vnd.gc.com.player:list+json; version=0.1.0',
    // ... other required headers
  }
})
.then(res => res.json())
.then(players => {
  // Pass to Dugout DJ
  const data = {
    team: { name: document.querySelector('.teamName').textContent },
    players: players.map(p => ({
      first_name: p.first_name,
      last_name: p.last_name,
      number: p.number
    }))
  };
  window.location.href = `https://dugoutdj.com/?gc_data=${encodeURIComponent(JSON.stringify(data))}`;
});
```

### 2. Real-Time Roster Sync
Poll API for roster changes during a game:

**Use Case:**
- Coach adds/removes players in GameChanger during game
- Dugout DJ automatically syncs roster changes
- No manual refresh needed

**Challenges:**
- Requires continuous authentication
- Token expiration handling
- Background polling implementation

### 3. Team Selection UI
Fetch user's teams list and allow selection:

**API Endpoint:** (Hypothetical)
```
GET https://api.team-manager.gc.com/teams
```

**Use Case:**
- User authenticates once
- See list of all their teams
- Select which team to import
- One-click import without visiting GameChanger

### 4. Jersey Number Auto-Population
Current implementation doesn't capture jersey numbers from paste method.

**Enhancement:**
- API provides `number` field
- Automatically populate jersey numbers during import
- Save user time entering numbers manually

## Security & Privacy Considerations

### Token Security
- **Never store gc-token in Dugout DJ**: Tokens should only be used transiently
- **Short-lived usage**: Extract token, use immediately, discard
- **No server transmission**: Keep tokens client-side only

### User Privacy
- **No data collection**: Don't store or transmit player data to external servers
- **Local-only storage**: All data stays in browser localStorage
- **Transparent usage**: Clearly explain what data is accessed and how

### Rate Limiting
- GameChanger likely has rate limits
- Implement backoff/retry logic
- Cache responses to minimize API calls

## Current Implementation Status

✅ **Implemented:**
- Bookmarklet-based import using DOM scraping
- Paste roster method (manual copy/paste)
- Works without API access

❌ **Not Implemented:**
- Direct API integration (blocked by CORS)
- Jersey number import
- Real-time sync
- Team selection UI

## Recommendations

### Short-term (Current Solution)
Continue with bookmarklet + paste methods:
- No CORS issues
- No backend infrastructure needed
- Works on mobile (paste method)
- Easy for users

### Medium-term (API via Bookmarklet)
Enhance bookmarklet to use API for data fetching:
- More reliable than DOM scraping
- Access to jersey numbers
- Still client-side only
- Minimal code changes

### Long-term (Official Integration)
Partner with GameChanger for OAuth integration:
- Professional integration
- Access to additional features
- Better UX (no bookmarklet needed)
- Potential for two-way sync

## Related Files

- `src/components/GameChangerImport.jsx` - Current import UI
- `src/App.jsx` - Import handler (handleGameChangerDataImport)
- `src/utils/gamechanger.js` - Placeholder API utilities (not currently used)

## Last Updated

February 8, 2026
