import { useRef } from 'react';
import { exportData, importData } from '../utils/storage';
import './ShareDialog.css';

export default function ShareDialog({ data, onImport, onClose, onShare, shareLink, shareStatus }) {
  const fileInputRef = useRef(null);

  const handleExport = () => {
    exportData(data);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const importedData = await importData(file);

      // Validate the imported data
      if (!importedData.teams || !Array.isArray(importedData.teams)) {
        alert('Invalid file format');
        return;
      }

      if (confirm('This will replace all your current teams and players. Continue?')) {
        onImport(importedData);
        alert('Data imported successfully!');
        onClose();
      }
    } catch (error) {
      alert('Failed to import file. Please check the file format.');
      console.error('Import error:', error);
    }

    // Reset file input
    e.target.value = '';
  };

  const handleCopyJson = () => {
    const jsonStr = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(jsonStr)
      .then(() => alert('Data copied to clipboard! Share this with another parent.'))
      .catch(() => alert('Failed to copy to clipboard'));
  };

  return (
    <div className="share-dialog-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-header">
          <h3>Share & Backup</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div className="share-dialog-content">
          <div className="share-section">
            <h4>🔗 Share with Parents</h4>
            <p>Create one link parents can open to update their player's walk-up song. Changes save directly — no files or copies needed.</p>
            <button className="btn btn-primary" onClick={onShare} disabled={!onShare}>
              Create Share Link
            </button>
            {shareStatus && <p className="share-status-text">{shareStatus}</p>}
            {shareLink && (
              <div className="share-link-box">
                <code className="share-link-code">{shareLink}</code>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(shareLink)
                      .then(() => alert('Link copied to clipboard!'))
                      .catch(() => alert('Could not copy — select the link above.'));
                  }}
                >
                  Copy Link
                </button>
              </div>
            )}
          </div>

          <div className="share-section">
            <h4>📤 Export / Backup</h4>
            <p>Download your teams and players as a file</p>
            <button className="btn btn-primary" onClick={handleExport}>
              Download Backup File
            </button>
          </div>

          <div className="share-section">
            <h4>📋 Copy to Clipboard</h4>
            <p>Copy data to share with another parent via text or email</p>
            <button className="btn btn-secondary" onClick={handleCopyJson}>
              Copy Data to Clipboard
            </button>
          </div>

          <div className="share-section">
            <h4>📥 Import / Restore</h4>
            <p>Load teams and players from a backup file</p>
            <button className="btn btn-secondary" onClick={handleImportClick}>
              Choose File to Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          <div className="share-section share-info">
            <h4>ℹ️ How to Share</h4>
            <ol>
              <li>Click "Copy Data to Clipboard" or "Download Backup File"</li>
              <li>Share the data/file with another parent via text, email, or messaging app</li>
              <li>The other parent can use "Import" to load the teams and players</li>
            </ol>
            <p className="note">
              <strong>Note:</strong> Importing will replace all current data. Make sure to export your current data first if you want to keep it!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
