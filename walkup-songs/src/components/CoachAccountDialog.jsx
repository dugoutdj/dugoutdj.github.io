import { useEffect, useState } from 'react';
import { claimAccountTeam, fetchAccountTeams, getCurrentCoach, logoutCoach, requestLoginLink, verifyLoginToken } from '../utils/api';
import './CoachAccountDialog.css';

export default function CoachAccountDialog({ team, onClose, onConnected }) {
  const [coach, setCoach] = useState(null);
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState(team?.sharedTeamId || '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('login');
    if (!token) return;
    setBusy(true);
    verifyLoginToken(token).then((result) => {
      setCoach({ email: result.email });
      window.history.replaceState({}, '', window.location.pathname);
      setStatus('Signed in successfully.');
    }).catch((error) => setStatus(error.message)).finally(() => setBusy(false));
    getCurrentCoach().then((result) => { if (result.authenticated) setCoach(result); }).catch(() => {});
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true); setStatus('Sending sign-in link…');
    try { await requestLoginLink(email); setStatus('Check your email for a secure sign-in link.'); }
    catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  };

  const connect = async () => {
    setBusy(true); setStatus('Connecting existing team…');
    try {
      await claimAccountTeam({ sharedTeamId: teamId.trim(), name: team.name, players: team.players || [] });
      onConnected(teamId.trim()); setStatus('Team connected and backed up to your account.');
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    setBusy(true); setStatus('Looking for your cloud teams…');
    try {
      const result = await fetchAccountTeams();
      if (!result.teams?.length) { setStatus('No account teams found yet. Connect this team first.'); return; }
      const found = result.teams.find((item) => item.sharedTeamId === team.sharedTeamId) || result.teams[0];
      onConnected(found.sharedTeamId, found); setStatus(`Restored ${found.name}.`);
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  };

  const signOut = async () => { await logoutCoach(); setCoach(null); setStatus('Signed out.'); };

  return <div className="coach-account-overlay" onClick={onClose}>
    <div className="coach-account-dialog" onClick={(event) => event.stopPropagation()}>
      <div className="coach-account-header"><h3>Coach account</h3><button className="btn-icon" onClick={onClose}>✕</button></div>
      <div className="coach-account-content">
        {!coach ? <form onSubmit={signIn}>
          <p>Sign in with a secure email link to recover your roster on any device.</p>
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Coach email" required />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form> : <>
          <p>Signed in as <strong>{coach.email}</strong></p>
          <label className="coach-team-id-label">Existing parent-link team ID
            <input className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)} placeholder="Example: 1uxw0bbv" />
          </label>
          <button className="btn btn-primary" onClick={connect} disabled={busy || !teamId.trim()}>Connect this existing team</button>
          <button className="btn btn-secondary" onClick={restore} disabled={busy}>Restore account team</button>
          <button className="btn btn-secondary" onClick={signOut}>Sign out</button>
        </>}
        {status && <p className="coach-account-status">{status}</p>}
      </div>
    </div>
  </div>;
}
