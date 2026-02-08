import { useState } from 'react';
import './GameChangerImport.css';

export default function GameChangerImport({ onImport, onCancel }) {
  const [step, setStep] = useState(1);
  const [showBookmarkletCode, setShowBookmarkletCode] = useState(false);

  // The bookmarklet code that users will save as a bookmark
  const bookmarkletCode = `javascript:(async function(){const id=window.location.pathname.match(/teams\\/([^\\/]+)/)?.[1];if(!id){alert('Not on a GameChanger team page.');return;}const teamName=document.querySelector('.NewTeamNavBar__teamName, .TeamInfo__name, h1')?.textContent.trim()||'Imported Team';await new Promise(r=>setTimeout(r,500));const nameEls=document.querySelectorAll('.ListRow__mainContent');const players=[];nameEls.forEach(el=>{const name=el.textContent.trim();if(name&&name.includes(' ')&&/^[A-Z]/.test(name)){players.push({first_name:name.split(' ')[0],last_name:name.split(' ').slice(1).join(' '),number:''});}});if(players.length===0){alert('No players found. Make sure you are on the Team/Roster page.');return;}const data=encodeURIComponent(JSON.stringify({team:{name:teamName},players:players}));window.location.href='${window.location.origin}/?gc_data='+data;})();`;

  const handleCopyBookmarklet = () => {
    navigator.clipboard.writeText(bookmarkletCode).then(() => {
      alert('Bookmarklet code copied to clipboard!');
    }).catch(() => {
      setShowBookmarkletCode(true);
    });
  };

  return (
    <div className="gc-import-overlay">
      <div className="gc-import-dialog">
        <div className="gc-import-header">
          <h2>Import from GameChanger</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <div className="gc-import-content">
          {step === 1 && (
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

          {step === 2 && (
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
