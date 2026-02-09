import { useState } from 'react';
import './GameChangerImport.css';

export default function GameChangerImport({ onImport, onCancel }) {
  const [importMethod, setImportMethod] = useState('paste'); // 'paste' or 'bookmarklet'
  const [step, setStep] = useState(1);
  const [showBookmarkletCode, setShowBookmarkletCode] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [teamName, setTeamName] = useState('');
  const [parsedPlayers, setParsedPlayers] = useState([]);

  // The bookmarklet code that users will save as a bookmark
  const bookmarkletCode = `javascript:(async function(){const id=window.location.pathname.match(/teams\\/([^\\/]+)/)?.[1];if(!id){alert('Not on a GameChanger team page.');return;}const teamName=document.querySelector('.NewTeamNavBar__teamName, .TeamInfo__name, h1')?.textContent.trim()||'Imported Team';await new Promise(r=>setTimeout(r,500));const nameEls=document.querySelectorAll('.ListRow__mainContent');const players=[];nameEls.forEach(el=>{const name=el.textContent.trim();if(name&&name.includes(' ')&&/^[A-Z]/.test(name)){players.push({first_name:name.split(' ')[0],last_name:name.split(' ').slice(1).join(' '),number:''});}});if(players.length===0){alert('No players found. Make sure you are on the Team/Roster page.');return;}const data=encodeURIComponent(JSON.stringify({team:{name:teamName},players:players}));window.location.href='${window.location.origin}/?gc_data='+data;})();`;

  const handleCopyBookmarklet = () => {
    navigator.clipboard.writeText(bookmarkletCode).then(() => {
      alert('Bookmarklet code copied to clipboard!');
    }).catch(() => {
      setShowBookmarkletCode(true);
    });
  };

  const parseRosterText = (text) => {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const players = [];

    lines.forEach(line => {
      // Remove common prefixes like numbers, bullets, dashes
      let cleaned = line.replace(/^\d+[\.\)]\s*/, ''); // Remove "1. " or "1) "
      cleaned = cleaned.replace(/^[-•*]\s*/, ''); // Remove bullets
      cleaned = cleaned.trim();

      // Skip if line doesn't look like a name (too short or no letters)
      if (cleaned.length < 2 || !/[a-zA-Z]/.test(cleaned)) {
        return;
      }

      // Skip initials-only lines (2-3 uppercase letters with no spaces)
      // GameChanger format shows "AV" on one line, "Anthony Vilardi" on next
      if (/^[A-Z]{2,3}$/.test(cleaned)) {
        return;
      }

      // Check for "LastName, FirstName" format
      if (cleaned.includes(',')) {
        const parts = cleaned.split(',').map(p => p.trim());
        if (parts.length >= 2) {
          players.push({
            first_name: parts[1].split(' ')[0],
            last_name: parts[0],
            number: ''
          });
          return;
        }
      }

      // Default: "FirstName LastName" format
      const nameParts = cleaned.split(/\s+/);
      if (nameParts.length >= 2) {
        players.push({
          first_name: nameParts[0],
          last_name: nameParts.slice(1).join(' '),
          number: ''
        });
      } else if (nameParts.length === 1) {
        // Single name - use as full name
        players.push({
          first_name: nameParts[0],
          last_name: '',
          number: ''
        });
      }
    });

    return players;
  };

  const handlePasteImport = () => {
    if (!teamName.trim()) {
      alert('Please enter a team name');
      return;
    }

    const players = parseRosterText(pastedText);

    if (players.length === 0) {
      alert('No players found. Please paste player names (one per line).');
      return;
    }

    setParsedPlayers(players);
    setStep(2); // Show preview
  };

  const handleConfirmImport = () => {
    const data = {
      team: { name: teamName },
      players: parsedPlayers
    };

    // Call the parent's import handler directly
    if (onImport) {
      onImport(data);
    }
    onCancel();
  };

  return (
    <div className="gc-import-overlay">
      <div className="gc-import-dialog">
        <div className="gc-import-header">
          <h2>Import from GameChanger</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        {/* Method Selection */}
        <div className="gc-import-methods">
          <button
            className={`method-btn ${importMethod === 'paste' ? 'active' : ''}`}
            onClick={() => { setImportMethod('paste'); setStep(1); }}
          >
            📋 Paste Roster (Recommended)
          </button>
          <button
            className={`method-btn ${importMethod === 'bookmarklet' ? 'active' : ''}`}
            onClick={() => { setImportMethod('bookmarklet'); setStep(1); }}
          >
            🔖 Bookmarklet (Advanced)
          </button>
        </div>

        <div className="gc-import-content">
          {/* PASTE ROSTER METHOD */}
          {importMethod === 'paste' && step === 1 && (
            <div className="gc-step">
              <h3>📋 Paste Your Roster</h3>
              <p className="method-description">
                Simple copy/paste - no technical setup needed!
              </p>

              <div className="instruction-steps">
                <ol>
                  <li>
                    <strong>Open GameChanger</strong> in another tab
                    <button
                      className="btn btn-secondary open-gc-btn"
                      onClick={() => window.open('https://web.gc.com/', '_blank')}
                    >
                      🔗 Open GameChanger
                    </button>
                  </li>

                  <li>
                    <strong>Go to your team's Roster page</strong>
                  </li>

                  <li>
                    <strong>Select and copy all player names</strong>
                    <br />
                    <small>Long-press, select all names, then tap Copy</small>
                  </li>

                  <li>
                    <strong>Come back here and paste below</strong>
                  </li>
                </ol>
              </div>

              <div className="form-group">
                <label htmlFor="team-name">Team Name *</label>
                <input
                  id="team-name"
                  type="text"
                  className="input"
                  placeholder="e.g., M-Marlins"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="roster-paste">Player Names (one per line) *</label>
                <textarea
                  id="roster-paste"
                  className="roster-textarea"
                  placeholder="Anthony Vilardi&#10;Brahm Rathsack&#10;Dominic Lloyd&#10;..."
                  rows={10}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                />
                <small className="form-hint">
                  Paste your roster here. One player per line.
                </small>
              </div>

              <div className="gc-step-actions">
                <button className="btn btn-secondary" onClick={onCancel}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handlePasteImport}
                  disabled={!teamName.trim() || !pastedText.trim()}
                >
                  Preview Import →
                </button>
              </div>
            </div>
          )}

          {/* PASTE ROSTER PREVIEW */}
          {importMethod === 'paste' && step === 2 && (
            <div className="gc-step">
              <h3>✅ Confirm Import</h3>
              <p>Found <strong>{parsedPlayers.length} players</strong> for <strong>{teamName}</strong></p>

              <div className="player-preview">
                {parsedPlayers.map((player, index) => (
                  <div key={index} className="preview-player">
                    {index + 1}. {player.first_name} {player.last_name}
                  </div>
                ))}
              </div>

              <div className="gc-step-actions">
                <button className="btn btn-secondary" onClick={() => setStep(1)}>
                  ← Back to Edit
                </button>
                <button className="btn btn-primary" onClick={handleConfirmImport}>
                  ✓ Import {parsedPlayers.length} Players
                </button>
              </div>
            </div>
          )}

          {/* BOOKMARKLET METHOD */}
          {importMethod === 'bookmarklet' && step === 1 && (
            <div className="gc-step">
              <h3>Step 1: Create Import Bookmarklet</h3>
              <p>First, you need to create a special bookmark (one-time setup):</p>

              <div className="instruction-steps">
                <ol>
                  <li>
                    <strong>Tap the button below</strong> to copy the bookmarklet code:
                    <button
                      className="btn btn-primary copy-bookmarklet-btn"
                      onClick={handleCopyBookmarklet}
                    >
                      📋 Copy Bookmarklet Code
                    </button>
                  </li>

                  {showBookmarkletCode && (
                    <div className="bookmarklet-code">
                      <p><strong>Bookmarklet code:</strong></p>
                      <textarea
                        readOnly
                        value={bookmarkletCode}
                        rows={4}
                        onClick={(e) => e.target.select()}
                      />
                      <small>Tap and hold to select all, then copy</small>
                    </div>
                  )}

                  <li>
                    <strong>Create a new bookmark:</strong>
                    <ul>
                      <li>Tap Safari's Share button (square with arrow)</li>
                      <li>Scroll down and tap "Add Bookmark"</li>
                      <li>Name it: <code>Import to Dugout DJ</code></li>
                      <li>Save to Favorites for easy access</li>
                    </ul>
                  </li>

                  <li>
                    <strong>Edit the bookmark:</strong>
                    <ul>
                      <li>Go to Bookmarks → Edit</li>
                      <li>Find "Import to Dugout DJ"</li>
                      <li>Delete the URL and paste the bookmarklet code</li>
                      <li>Save</li>
                    </ul>
                  </li>
                </ol>
              </div>

              <div className="gc-step-actions">
                <button className="btn btn-secondary" onClick={onCancel}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => setStep(2)}>
                  Next: Import Team →
                </button>
              </div>
            </div>
          )}

          {importMethod === 'bookmarklet' && step === 2 && (
            <div className="gc-step">
              <h3>Step 2: Import Your Team</h3>
              <p>Now let's import your GameChanger roster:</p>

              <div className="instruction-steps">
                <ol>
                  <li>
                    <strong>Open GameChanger</strong> in a new Safari tab
                    <button
                      className="btn btn-secondary open-gc-btn"
                      onClick={() => window.open('https://web.gc.com/', '_blank')}
                    >
                      🔗 Open GameChanger
                    </button>
                  </li>

                  <li>
                    <strong>Navigate to your team page</strong>
                    <br />
                    <small>Go to Teams → Select your team</small>
                  </li>

                  <li>
                    <strong>Tap your bookmarklet</strong>
                    <br />
                    <small>Safari menu → Bookmarks → "Import to Dugout DJ"</small>
                  </li>

                  <li>
                    <strong>You'll be redirected back</strong> here automatically
                    <br />
                    <small>The roster will import automatically!</small>
                  </li>
                </ol>
              </div>

              <div className="gc-import-tip">
                <strong>💡 Tip:</strong> You only need to create the bookmarklet once!
                Next time you can start directly at Step 2.
              </div>

              <div className="gc-step-actions">
                <button className="btn btn-secondary" onClick={() => setStep(1)}>
                  ← Back
                </button>
                <button className="btn btn-secondary" onClick={onCancel}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
