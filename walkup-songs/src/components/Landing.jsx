import { useEffect, useRef, useState } from 'react';
import { requestLoginLink, verifyLoginToken } from '../utils/api';
import LogoMark from './LogoMark';
import './Landing.css';

const APP_STORE_URL = 'https://apps.apple.com/us/app/dugout-dj-baseball-walk-ups/id6838615996';

// Public landing page shown at dugoutdj.com when no coach is signed in.
// Coaches create an account or sign in with an email magic link; parents
// never need an account (they use the team link their coach sends them).
export default function Landing({ onSignedIn }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'create'
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('info'); // 'info' | 'ok' | 'error'
  const [busy, setBusy] = useState(false);
  const authRef = useRef(null);

  // A magic link opens dugoutdj.com/?login=<token>. Verify it here (the
  // landing page is what a signed-out visitor sees) and enter the app.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('login');
    if (!token) return;
    setBusy(true);
    setStatus('Signing you in…');
    verifyLoginToken(token)
      .then((result) => {
        window.history.replaceState({}, '', window.location.pathname);
        onSignedIn(result.email || 'signed-in coach');
      })
      .catch((error) => {
        setStatusKind('error');
        setStatus(error.message || 'That sign-in link is invalid or expired. Request a new one.');
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseMode = (next) => {
    setMode(next);
    setStatus('');
    setStatusKind('info');
    if (authRef.current) authRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const submit = async (event) => {
    event.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;
    setBusy(true);
    setStatus('');
    setStatusKind('info');
    try {
      await requestLoginLink(target);
      setStatusKind('ok');
      setStatus(
        `We emailed a secure sign-in link to ${target}. Open it to ${
          mode === 'create' ? 'create your account' : 'sign in'
        } — it works on any device.`
      );
    } catch (error) {
      setStatusKind('error');
      const msg = String(error?.message || '');
      setStatus(
        /failed to fetch|networkerror|request failed|load failed|err_/i.test(msg)
          ? "Couldn't reach Dugout DJ — check your connection and try again."
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-header-inner">
          <a className="landing-logo" href="/" onClick={(e) => e.preventDefault()}>
            <LogoMark size={34} />
            <span className="landing-logo-name">Dugout&nbsp;DJ</span>
          </a>
          <nav className="landing-nav">
            <a href="#how-it-works" onClick={(e) => e.preventDefault()}>How it works</a>
            <a href="#features" onClick={(e) => e.preventDefault()}>Features</a>
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">iOS App</a>
            <button type="button" className="btn btn-primary" onClick={() => chooseMode('signin')}>
              Sign in
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="landing-hero">
          <div className="landing-hero-inner">
            <p className="landing-eyebrow">Walk-up songs for youth baseball · Softball</p>
            <h1>
              Every kid steps in with <span className="hero-highlight">their</span> moment of music.
            </h1>
            <p className="landing-hero-sub">
              Dugout DJ lets your team parents pick the exact moment of a song that plays
              when their player steps to the plate — with a stadium-style name announcement
              right before it. You keep one roster. Parents get one link.
            </p>
            <div className="landing-hero-cta">
              <button type="button" className="btn btn-primary landing-btn-lg" onClick={() => chooseMode('create')}>
                Create a free coach account
              </button>
              <button type="button" className="btn btn-secondary landing-btn-lg" onClick={() => chooseMode('signin')}>
                I&apos;m a returning coach
              </button>
            </div>
            <div className="landing-app-store-wrap">
              <a
                className="app-store-badge"
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Download Dugout DJ on the App Store"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.96 6.32c.67-.81 1.12-1.94 1-3.07-.96.04-2.13.64-2.82 1.45-.61.7-.115 1.86-1 2.96 1.07.08 2.15-.53 2.82-1.34" />
                </svg>
                <span className="app-store-badge-text">
                  <span className="app-store-badge-sub">Download on the</span>
                  <span className="app-store-badge-main">App Store</span>
                </span>
              </a>
            </div>
            <p className="landing-hero-note">Available on the iOS App Store · Also works in any mobile browser · No credit card required</p>
          </div>
        </section>

        {/* Auth card */}
        <section className="landing-auth-wrap" ref={authRef} id="auth">
          <div className="landing-auth-card">
            <div className="landing-auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                className={mode === 'signin' ? 'is-active' : ''}
                onClick={() => chooseMode('signin')}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                className={mode === 'create' ? 'is-active' : ''}
                onClick={() => chooseMode('create')}
              >
                Create account
              </button>
            </div>

            <div className="landing-auth-body">
              <h2>{mode === 'create' ? 'Create your coach account' : 'Welcome back, coach'}</h2>
              <p className="landing-auth-desc">
                {mode === 'create'
                  ? 'Enter your email and we’ll send a secure link. Once your team is shared, it syncs to your account and is recoverable from any device.'
                  : 'Enter your email and we’ll send you a secure sign-in link.'}
              </p>
              <form className="landing-auth-form" onSubmit={submit}>
                <label htmlFor="coach-email">Coach email</label>
                <input
                  id="coach-email"
                  className="input"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="coach@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="submit" className="btn btn-primary landing-btn-lg" disabled={busy || !email.trim()}>
                  {busy ? 'Sending…' : 'Email my sign-in link'}
                </button>
              </form>
              {status && <p className={`landing-auth-status is-${statusKind}`}>{status}</p>}
              <p className="landing-auth-footnote">
                🔒 Secure, password-free sign-in. The link expires after a short while.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="landing-section" id="how-it-works">
          <div className="landing-section-inner">
            <h2>How it works</h2>
            <div className="landing-steps">
              <div className="landing-step">
                <span className="landing-step-num">1</span>
                <h3>Build the roster</h3>
                <p>
                  Add players with jersey numbers and pick each one’s walk-up song — paste any
                  YouTube link for the full song or upload your own MP3 clip.
                </p>
              </div>
              <div className="landing-step">
                <span className="landing-step-num">2</span>
                <h3>Dial in the moment</h3>
                <p>
                  Pick and preview the exact moment that plays at the plate. Add a
                  “Now batting, number 21…” announcement in a real announcer voice.
                </p>
              </div>
              <div className="landing-step">
                <span className="landing-step-num">3</span>
                <h3>Share one link with parents</h3>
                <p>
                  Parents open the link and fine-tune their player’s song from their own phone —
                  no account needed. Changes show up on your roster instantly.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="landing-section landing-section-alt" id="features">
          <div className="landing-section-inner">
            <h2>Built for game day</h2>
            <div className="landing-features">
              <div className="landing-feature">
                <span className="landing-feature-icon">🎵</span>
                <h3>Full YouTube songs or MP3 uploads</h3>
                <p>Paste any YouTube link for the full song, or upload your own MP3 clip.</p>
              </div>
              <div className="landing-feature">
                <span className="landing-feature-icon">🎙️</span>
                <h3>Stadium announcer intro</h3>
                <p>“Now batting, number 17, Jordan Lee!” — hear how the name sounds before you save it.</p>
              </div>
              <div className="landing-feature">
                <span className="landing-feature-icon">📲</span>
                <h3>Parents update from their phone</h3>
                <p>One shared link, no accounts for parents, and every change syncs back to the coach.</p>
              </div>
              <div className="landing-feature">
                <span className="landing-feature-icon">📴</span>
                <h3>Plays offline, instantly</h3>
                <p>Songs are saved on the coach’s device so game-day playback is one tap with no buffering.</p>
              </div>
              <div className="landing-feature">
                <span className="landing-feature-icon">🕘</span>
                <h3>Song history that remembers</h3>
                <p>Every section a player has used stays listed, most-played first, so the whole team can go back to a favorite.</p>
              </div>
              <div className="landing-feature">
                <span className="landing-feature-icon">☁️</span>
                <h3>Backed up to your account</h3>
                <p>Share or connect your team and it syncs to your account — sign in on a new phone and restore everything.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Parents */}
        <section className="landing-section landing-parents">
          <div className="landing-section-inner">
            <h2>Are you a parent?</h2>
            <p>
              Your coach shared a <strong>team link</strong> with you. Open that link and you can
              pick or update your player’s walk-up song in a minute — no account or app needed.
            </p>
            <p className="landing-parents-note">Don’t have the link? Ask your coach for it.</p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-brand">
            <LogoMark size={22} />
            <span className="landing-logo-name">Dugout DJ</span>
          </span>
          <div className="landing-footer-links">
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">iOS App</a>
            <a href="/privacy.html">Privacy Policy</a>
          </div>
          <span className="landing-footer-note">Walk-up songs, dialed in.</span>
        </div>
      </footer>
    </div>
  );
}
