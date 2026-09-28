import { useCallback, useEffect, useState } from 'react';
import {
  inviteGuestDj,
  listGuestDjInvites,
  revokeGuestDjInvite
} from '../utils/dj';

// Coach-facing panel: invite a parent to run the walk-up songs for 3 days.
//
// The invite emails a /dj/<token> link that opens a play-only console. The
// link is shown here once (the server stores only its hash), and each invite
// can be revoked at any time — revoking ends that parent's console on their
// next action.

function timeLeft(expiresAt) {
  const ms = Number(expiresAt || 0) - Date.now();
  if (ms <= 0) return 'expired';
  const hours = ms / 3600000;
  // Round to whole days so a window of, say, 47.9 hours reads "2 days left".
  if (hours >= 24) {
    const days = Math.max(1, Math.round(hours / 24));
    return days === 1 ? '1 day left' : `${days} days left`;
  }
  if (hours >= 1) return `${Math.floor(hours)} hr left`;
  return `${Math.max(1, Math.floor(ms / 60000))} min left`;
}

// Relative so it stays short: "opened 20 min ago" beats a full timestamp.
function whenUsed(lastUsedAt) {
  if (!lastUsedAt) return 'not opened yet';
  const minutes = Math.floor((Date.now() - Number(lastUsedAt)) / 60000);
  if (minutes < 1) return 'opened just now';
  if (minutes < 60) return `opened ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `opened ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'opened yesterday' : `opened ${days} days ago`;
}

export default function GuestDjInvite({ sharedTeamId }) {
  const [email, setEmail] = useState('');
  const [invites, setInvites] = useState([]);
  const [freshLink, setFreshLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    if (!sharedTeamId) {
      setInvites([]);
      return;
    }
    try {
      const result = await listGuestDjInvites(sharedTeamId);
      setInvites(result?.invites || []);
    } catch (err) {
      setStatus(err.message);
    }
  }, [sharedTeamId]);

  useEffect(() => { refresh(); }, [refresh]);

  const invite = async (event) => {
    event.preventDefault();
    if (busy || !sharedTeamId) return;
    setBusy(true);
    setStatus('Sending invite…');
    try {
      const result = await inviteGuestDj(sharedTeamId, email.trim());
      setFreshLink({ url: result.invite.url, email: result.invite.email });
      setStatus(`Invite emailed to ${result.invite.email}.`);
      setEmail('');
      await refresh();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inviteId, inviteEmail) => {
    if (busy) return;
    if (!confirm(`End guest DJ access for ${inviteEmail}?`)) return;
    setBusy(true);
    try {
      await revokeGuestDjInvite(sharedTeamId, inviteId);
      setStatus(`${inviteEmail} can no longer run the songs.`);
      setFreshLink((current) => (current?.email === inviteEmail ? null : current));
      await refresh();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-section dj-invite">
      <h4>🎧 Guest DJ for game day</h4>
      <p>
        Invite a parent to run the walk-up songs from their own phone for 3 days.
        They get a play-only console — they can&apos;t change the roster, songs, or order.
      </p>

      {!sharedTeamId ? (
        <p className="dj-invite-note">
          Create your parent link above first, then you can invite a guest DJ.
        </p>
      ) : (
        <>
          <form className="dj-invite-form" onSubmit={invite}>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="parent@example.com"
              required
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Invite for 3 days'}
            </button>
          </form>

          {freshLink && (
            <div className="dj-invite-link">
              <span className="dj-invite-link-label">
                Emailed to {freshLink.email}. You can also text this link —
                it&apos;s only shown once:
              </span>
              <code className="share-link-code">{freshLink.url}</code>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(freshLink.url)
                    .then(() => setStatus('Link copied to clipboard.'))
                    .catch(() => setStatus('Could not copy — select the link above.'));
                }}
              >
                Copy link
              </button>
            </div>
          )}

          {invites.length > 0 && (
            <ul className="dj-invite-list">
              {invites.map((item) => (
                <li key={item.id} className="dj-invite-item">
                  <span className="dj-invite-item-info">
                    <strong>{item.email}</strong>
                    <span className="dj-invite-item-meta">
                      {timeLeft(item.expiresAt)} · {whenUsed(item.lastUsedAt)}
                    </span>
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => revoke(item.id, item.email)}
                    disabled={busy}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}

          {status && <p className="share-status-text">{status}</p>}
        </>
      )}
    </div>
  );
}
