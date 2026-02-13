import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateParentFormUrl } from '../utils/updateCode';
import './PlayerShareDialog.css';

export default function PlayerShareDialog({ player, teamId, onClose }) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  if (!player) return null;

  const shareUrl = generateParentFormUrl(player.id, player.name, teamId);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSendText = () => {
    const message = `Hi! Please choose ${player.name}'s walk-up song using this link:\n\n${shareUrl}`;
    window.open(`sms:?body=${encodeURIComponent(message)}`);
  };

  const handleSendEmail = () => {
    const subject = `Choose Walk-up Song for ${player.name}`;
    const body = `Hi!\n\nPlease use this link to choose ${player.name}'s walk-up song:\n\n${shareUrl}\n\nThanks!`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog player-share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Share Song Form</h3>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-body">
          <p className="share-instructions">
            Send this link to {player.name}'s parent so they can choose a walk-up song.
          </p>

          {!showQR ? (
            <>
              <div className="share-url-box">
                <code className="share-url">{shareUrl}</code>
              </div>

              <div className="share-actions">
                <button className="btn btn-primary" onClick={handleCopy}>
                  {copied ? '✓ Copied!' : '📋 Copy Link'}
                </button>
                <button className="btn btn-secondary" onClick={handleSendText}>
                  💬 Send Text
                </button>
                <button className="btn btn-secondary" onClick={handleSendEmail}>
                  📧 Send Email
                </button>
                <button className="btn btn-secondary" onClick={() => setShowQR(true)}>
                  📱 Show QR Code
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="qr-code-container">
                <QRCodeSVG
                  value={shareUrl}
                  size={256}
                  level="M"
                  includeMargin={true}
                />
                <p className="qr-instructions">
                  Scan this QR code with a phone camera to open the song selection form
                </p>
              </div>

              <button className="btn btn-secondary" onClick={() => setShowQR(false)}>
                ← Back to Options
              </button>
            </>
          )}

          <div className="share-help">
            <p className="help-title">How it works:</p>
            <ol>
              <li>Parent opens the link</li>
              <li>Parent searches for and selects a song</li>
              <li>Parent gets an update code to send back to you</li>
              <li>You paste the code in "Import Update" to add the song</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
