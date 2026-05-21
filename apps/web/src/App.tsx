import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Link,
  Outlet,
  useParams,
  useRouterState,
} from '@tanstack/react-router';
import { useLiveQuery } from '@tanstack/react-db';
import { request, authApi, type User, type Organisation, type Membership } from './api';
import { organisationsCollection, membershipsCollection } from './collections';
import { UserContext } from './context';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineBanner } from './components/OfflineBanner';
import { NotificationBell } from './components/NotificationBell';
import { Avatar } from './components/Avatar';
import { ProposalsPage } from './pages/ProposalsPage';
import { ProposalDetailPage } from './pages/ProposalDetailPage';
import { DelegationsPage } from './pages/DelegationsPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { MembersPage } from './pages/MembersPage';
import { OrgListPage } from './pages/OrgListPage';
import { LandingPage } from './pages/LandingPage';
import { OrgHomePage } from './pages/OrgHomePage';
import { JoinPage } from './pages/JoinPage';
import { AdminPage } from './pages/AdminPage';
import { PublicResultsPage } from './pages/PublicResultsPage';
import { ActivityFeedPage } from './pages/ActivityFeedPage';
import { DelegationNetworkPage } from './pages/DelegationNetworkPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { PricingPage } from './pages/PricingPage';
import { DecisionRecordPage } from './pages/DecisionRecordPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { MagicLinkPage } from './pages/MagicLinkPage';
import { UnsubscribePage } from './pages/UnsubscribePage';
import { EmbedProposalPage } from './pages/EmbedProposalPage';
import { VoteConfirmedPage } from './pages/VoteConfirmedPage';
import { SetupPage } from './pages/SetupPage';
import { OrgProvider } from './OrgContext';
import styles from './styles/Shell.module.css';

const STORAGE_KEY = 'ripple_user';

function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

function SsoSignInForm({ onBack }: { onBack: () => void }) {
  const [orgSlug, setOrgSlug] = useState('');
  const [error, setError] = useState('');

  function handleSso(e: React.FormEvent) {
    e.preventDefault();
    const slug = orgSlug.trim();
    if (!slug) { setError('Enter your organisation slug'); return; }
    const apiBase = import.meta.env.VITE_API_URL ?? '/api';
    window.location.href = `${apiBase}/auth/sso/${encodeURIComponent(slug)}`;
  }

  return (
    <form onSubmit={handleSso} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <label htmlFor="sso-slug" style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)' }}>Organisation slug</label>
        <input
          id="sso-slug"
          type="text"
          value={orgSlug}
          onChange={(e) => setOrgSlug(e.target.value)}
          required
          autoFocus
          placeholder="my-company"
          style={{ width: '100%', height: 32, padding: '0 var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none', color: 'var(--color-fg)' }}
        />
      </div>
      {error && <p style={{ fontSize: 'var(--text-sm)', color: 'red', margin: 0 }}>{error}</p>}
      <button
        type="submit"
        style={{ width: '100%', height: 36, background: 'var(--color-accent)', color: 'var(--color-accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}
      >
        Continue with SSO
      </button>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', margin: 0 }}>
        <button
          type="button"
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          ← Back to sign in
        </button>
      </p>
    </form>
  );
}

function AuthPanel({ onLogin, onDismiss }: { onLogin: (user: User) => void; onDismiss?: () => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'magic' | 'sso'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError('');
    setLoading(true);
    try {
      const options = await request<never>('/auth/login/begin', { method: 'POST' });
      const credential = await startAuthentication({ optionsJSON: options });
      const user = await request<User>('/auth/login/finish', {
        method: 'POST',
        body: JSON.stringify(credential),
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.magicLinkBegin(email.trim());
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send sign-in link');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName) { setError('Name is required.'); return; }
    if (trimmedName.length < 2) { setError('Name must be at least 2 characters.'); return; }
    if (!trimmedEmail) { setError('Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Please enter a valid email address.'); return; }
    setLoading(true);
    try {
      const options = await request<never>('/auth/register/begin', {
        method: 'POST',
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
      });
      const credential = await startRegistration({ optionsJSON: options });
      const user = await request<User>('/auth/register/finish', {
        method: 'POST',
        body: JSON.stringify(credential),
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--color-bg)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        padding: 'var(--space-8)',
        border: 'var(--border)',
        borderRadius: 'var(--radius)',
      }}>
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--color-fg)',
            marginBottom: 'var(--space-5)',
          }}>
            Ripple
          </div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)' }}>
            {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'sso' ? 'Sign in with SSO' : 'Email sign-in'}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)' }}>
            {mode === 'login' ? 'Use your passkey to continue.' : mode === 'register' ? 'Register with a passkey.' : mode === 'sso' ? 'Enter your organisation slug to sign in via your Identity Provider.' : 'We\'ll send a sign-in link to your email.'}
          </p>
        </div>

        {mode === 'login' ? (
          <>
            <button
              onClick={handleLogin}
              disabled={loading}
              style={{
                width: '100%',
                height: 36,
                background: 'var(--color-accent)',
                color: 'var(--color-accent-fg)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-base)',
                fontWeight: 'var(--weight-medium)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                marginBottom: 'var(--space-4)',
                transition: 'background var(--transition-fast)',
              }}
            >
              {loading ? 'Waiting for passkey…' : 'Sign in with passkey'}
            </button>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', margin: '0 0 var(--space-2)' }}>
              No account?{' '}
              <button
                onClick={() => { setMode('register'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                Register
              </button>
            </p>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', margin: '0 0 var(--space-2)' }}>
              No passkey?{' '}
              <button
                onClick={() => { setMode('magic'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                Sign in with email
              </button>
            </p>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', margin: 0 }}>
              Using corporate SSO?{' '}
              <button
                onClick={() => { setMode('sso'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                Sign in with SSO
              </button>
            </p>
          </>
        ) : mode === 'sso' ? (
          <SsoSignInForm onBack={() => { setMode('login'); setError(''); }} />
        ) : mode === 'magic' ? (
          magicSent ? (
            <div>
              <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', marginBottom: 'var(--space-4)' }}>
                Check your inbox — we've sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
              </p>
              <button
                onClick={() => { setMode('login'); setMagicSent(false); setEmail(''); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="magic-email" style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)' }}>Email</label>
                <input
                  id="magic-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  style={{ width: '100%', height: 32, padding: '0 var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none', color: 'var(--color-fg)' }}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{ width: '100%', height: 36, background: 'var(--color-accent)', color: 'var(--color-accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
              >
                {loading ? 'Sending…' : 'Send sign-in link'}
              </button>
              <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', margin: 0 }}>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  ← Back to sign in
                </button>
              </p>
            </form>
          )
        ) : (
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label htmlFor="reg-name" style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)' }}>Name</label>
              <input
                id="reg-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: '100%', height: 32, padding: '0 var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none', color: 'var(--color-fg)' }}
              />
            </div>
            <div>
              <label htmlFor="reg-email" style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)' }}>Email</label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: '100%', height: 32, padding: '0 var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none', color: 'var(--color-fg)' }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                height: 36,
                background: 'var(--color-accent)',
                color: 'var(--color-accent-fg)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-base)',
                fontWeight: 'var(--weight-medium)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                marginTop: 'var(--space-1)',
              }}
            >
              {loading ? 'Waiting for passkey…' : 'Create passkey'}
            </button>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-fg-muted)', margin: 0 }}>
              Already have an account?{' '}
              <button
                onClick={() => { setMode('login'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0, fontWeight: 'var(--weight-medium)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                Sign in
              </button>
            </p>
          </form>
        )}

        {error && (
          <p data-testid="auth-error" style={{ color: 'var(--color-error)', marginTop: 'var(--space-4)', marginBottom: 0, fontSize: 'var(--text-base)' }}>
            {error}
          </p>
        )}
        {onDismiss && (
          <p style={{ marginTop: 'var(--space-5)', marginBottom: 0 }}>
            <button
              onClick={onDismiss}
              style={{ background: 'none', border: 'none', color: 'var(--color-fg-muted)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', cursor: 'pointer', padding: 0 }}
            >
              ← Continue browsing
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

const navLinkStyle = { className: styles.navLink };
const navLinkActiveStyle = { className: `${styles.navLink} ${styles.navLinkActive}` };

function NavLinks({ user, orgSlug, orgId, onClose }: { user: User | null; orgSlug?: string; orgId?: string; onClose?: () => void }) {
  const { data: allMemberships } = useLiveQuery(membershipsCollection);
  const { t } = useTranslation();
  const isAdmin = user && orgId
    ? (allMemberships ?? []).some((m: Membership) => m.organisation_id === orgId && m.user_id === user.id && m.role === 'admin')
    : false;

  return (
    <nav className={styles.nav}>
      {orgSlug ? (
        <>
          <Link to="/orgs/$slug/proposals" params={{ slug: orgSlug }} {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>{t('nav.proposals')}</Link>
          <Link to="/orgs/$slug/delegations" params={{ slug: orgSlug }} {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>{t('nav.delegations')}</Link>
          <Link to="/orgs/$slug/members" params={{ slug: orgSlug }} {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>{t('nav.members')}</Link>
          <Link to="/orgs/$slug/activity" params={{ slug: orgSlug }} {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>Activity</Link>
          <Link to="/orgs/$slug/decisions" params={{ slug: orgSlug }} {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>Decisions</Link>
          {isAdmin && (
            <Link to="/orgs/$slug/admin" params={{ slug: orgSlug }} {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>{t('nav.admin')}</Link>
          )}
        </>
      ) : (
        <Link to="/" {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>Organisations</Link>
      )}
      {user && (
        <Link to="/settings" {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>{t('nav.settings')}</Link>
      )}
      <Link to="/pricing" {...navLinkStyle} activeProps={navLinkActiveStyle} onClick={onClose}>Pricing</Link>
    </nav>
  );
}

function Shell({ user, onLogout, onSignIn, orgSlug, orgId, children, notificationOrgSlug }: {
  user: User | null;
  onLogout: () => void;
  onSignIn?: () => void;
  orgSlug?: string;
  orgId?: string;
  notificationOrgSlug?: string;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  const userSection = (
    <div className={styles.userSection}>
      {user ? (
        <>
          <div className={styles.userRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, overflow: 'hidden' }}>
              <Avatar name={user.name} avatarUrl={user.avatar_url ?? null} size={24} />
              {orgSlug ? (
                <Link to="/orgs/$slug/users/$id" params={{ slug: orgSlug, id: user.id }} className={styles.userName}>
                  {user.name}
                </Link>
              ) : (
                <span className={styles.userName}>{user.name}</span>
              )}
            </div>
            <NotificationBell orgSlug={notificationOrgSlug ?? orgSlug} />
          </div>
          <button onClick={onLogout} className={styles.signOut}>{t('nav.signOut')}</button>
        </>
      ) : onSignIn ? (
        <button
          onClick={onSignIn}
          style={{ background: 'none', border: 'none', color: 'var(--color-sidebar-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', cursor: 'pointer', padding: 0, textAlign: 'left', fontWeight: 'var(--weight-medium)' }}
        >
          Sign in
        </button>
      ) : (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-sidebar-fg-muted)' }}>Not signed in</span>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className={styles.mobileShell}>
        <a href="#main-content" className={styles.skipLink}>Skip to main content</a>
        <header className={styles.mobileHeader}>
          <button onClick={() => setSidebarOpen(true)} aria-label="Open menu" aria-expanded={sidebarOpen} aria-controls="mobile-drawer" className={styles.menuButton}>
            ☰
          </button>
          <span className={styles.mobileWordmark}>Ripple</span>
        </header>

        {sidebarOpen && (
          <>
            <div onClick={() => setSidebarOpen(false)} className={styles.overlay} />
            <div
              id="mobile-drawer"
              className={styles.drawer}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              onKeyDown={(e) => { if (e.key === 'Escape') setSidebarOpen(false); }}
            >
              <div className={styles.drawerHeader}>
                <span className={styles.drawerWordmark}>Ripple</span>
                <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className={styles.closeButton}>✕</button>
              </div>
              <NavLinks user={user} orgSlug={orgSlug} orgId={orgId} onClose={() => setSidebarOpen(false)} />
              {userSection}
            </div>
          </>
        )}

        <main id="main-content" className={styles.mobileMain}>{children}</main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>Skip to main content</a>
      <aside className={styles.sidebar}>
        <span className={styles.wordmark}>Ripple</span>
        <NavLinks user={user} orgSlug={orgSlug} orgId={orgId} />
        {userSection}
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {user && !user.email_verified && (
          <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '0.6rem 1.5rem', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Please verify your email address. Check your inbox for a verification link.</span>
          </div>
        )}
        <main id="main-content" className={styles.main}>{children}</main>
      </div>
    </div>
  );
}

// Root layout — no org context yet (used for /, /pricing, /settings and /users/:id)
function RootComponent() {
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [showAuth, setShowAuth] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleLogin(u: User) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    setShowAuth(false);
  }

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }

  if (!user) {
    if (pathname === '/') {
      return (
        <UserContext.Provider value={null}>
          <LandingPage onSignIn={() => setShowAuth(true)} />
          {showAuth && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--color-bg)' }}>
              <AuthPanel onLogin={handleLogin} onDismiss={() => setShowAuth(false)} />
            </div>
          )}
        </UserContext.Provider>
      );
    }
    // Public routes (e.g. /pricing) render with null user context but no auth wall
    return (
      <UserContext.Provider value={null}>
        <Outlet />
      </UserContext.Provider>
    );
  }

  return (
    <UserContext.Provider value={user}>
      <Shell user={user} onLogout={handleLogout}>
        <Outlet />
      </Shell>
    </UserContext.Provider>
  );
}

// Org layout — resolves org from slug, wraps with OrgProvider
function OrgLayout() {
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [showAuthOverlay, setShowAuthOverlay] = useState(false);
  const { slug } = useParams({ from: '/orgs/$slug' });
  const { data: allOrgs } = useLiveQuery(organisationsCollection);
  const org = (allOrgs ?? []).find((o: unknown) => (o as Organisation).slug === slug) as Organisation | undefined ?? null;
  const isLoading = !allOrgs;

  async function handleLogin(u: User) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    setShowAuthOverlay(false);
  }

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }

  // While org data loads, show a minimal loading state — we need the org to
  // decide whether to require auth, so we can't hard-block unauthed users yet.
  if (isLoading) {
    return (
      <UserContext.Provider value={user}>
        {user ? (
          <Shell user={user} onLogout={handleLogout} orgSlug={slug}>
            <p style={{ color: 'var(--color-fg-subtle)', fontSize: 'var(--text-base)' }}>Loading…</p>
          </Shell>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
            <p style={{ color: 'var(--color-fg-subtle)', fontSize: 'var(--text-base)' }}>Loading…</p>
          </div>
        )}
      </UserContext.Provider>
    );
  }

  // Private orgs (and unknown slugs) require sign-in.
  if (!user && (!org || !org.is_public)) {
    return (
      <UserContext.Provider value={null}>
        <AuthPanel onLogin={handleLogin} />
      </UserContext.Provider>
    );
  }

  if (!org) {
    return (
      <UserContext.Provider value={user}>
        <Shell user={user} onLogout={handleLogout}>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-error)' }}>Organisation "{slug}" not found.</p>
        </Shell>
      </UserContext.Provider>
    );
  }

  return (
    <UserContext.Provider value={user}>
      <OrgProvider org={org}>
        <Shell
          user={user}
          onLogout={handleLogout}
          onSignIn={!user ? () => setShowAuthOverlay(true) : undefined}
          orgSlug={slug}
          orgId={org.id}
        >
          <Outlet />
        </Shell>
      </OrgProvider>
      {showAuthOverlay && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <AuthPanel onLogin={handleLogin} onDismiss={() => setShowAuthOverlay(false)} />
        </div>
      )}
    </UserContext.Provider>
  );
}

// Routes
const rootRoute = createRootRoute();

const globalLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'global',
  component: RootComponent,
});

const indexRoute = createRoute({
  getParentRoute: () => globalLayout,
  path: '/',
  component: OrgListPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => globalLayout,
  path: '/settings',
  component: SettingsPage,
});

const orgLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orgs/$slug',
  component: OrgLayout,
});

const joinRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/join',
  component: JoinPage,
});

const orgIndexRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/',
  component: OrgHomePage,
});

const proposalsRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/proposals',
  component: ProposalsPage,
});

const proposalDetailRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/proposals/$id',
  component: ProposalDetailPage,
});

const delegationsRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/delegations',
  component: DelegationsPage,
});

const membersRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/members',
  component: MembersPage,
});

const userProfileRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/users/$id',
  component: UserProfilePage,
});

const activityRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/activity',
  component: ActivityFeedPage,
});

const adminRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/admin',
  component: AdminPage,
});

const delegationNetworkRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/delegations/network',
  component: DelegationNetworkPage,
});

const decisionRecordRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/decisions',
  component: DecisionRecordPage,
});

const publicResultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orgs/$slug/results',
  component: PublicResultsPage,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  component: VerifyEmailPage,
});

const pricingRoute = createRoute({
  getParentRoute: () => globalLayout,
  path: '/pricing',
  component: PricingPage,
});

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accept-invite',
  component: AcceptInvitePage,
});

const magicLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/magic',
  component: MagicLinkPage,
});

const unsubscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/unsubscribe',
  component: UnsubscribePage,
});

const embedProposalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/embed/proposals/$id',
  component: EmbedProposalPage,
});

const voteConfirmedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vote-confirmed',
  component: VoteConfirmedPage,
});

const setupRoute = createRoute({
  getParentRoute: () => orgLayout,
  path: '/setup',
  component: SetupPage,
});

const routeTree = rootRoute.addChildren([
  globalLayout.addChildren([indexRoute, settingsRoute, pricingRoute]),
  orgLayout.addChildren([orgIndexRoute, proposalsRoute, proposalDetailRoute, delegationsRoute, delegationNetworkRoute, membersRoute, userProfileRoute, joinRoute, activityRoute, adminRoute, decisionRecordRoute, setupRoute]),
  publicResultsRoute,
  verifyEmailRoute,
  acceptInviteRoute,
  magicLinkRoute,
  unsubscribeRoute,
  embedProposalRoute,
  voteConfirmedRoute,
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <RouterProvider router={router} />
        <OfflineBanner />
      </ToastProvider>
    </ErrorBoundary>
  );
}
