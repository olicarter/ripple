import { useEffect, useState } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { Link } from '@tanstack/react-router';
import { organisationsCollection } from '../collections';
import type { Organisation } from '../api';
import styles from './LandingPage.module.css';

const FAQS = [
  {
    q: 'What is liquid democracy?',
    a: 'Liquid democracy sits between direct and representative democracy. Vote yourself on issues you care about, or delegate your vote to someone you trust — and delegates can delegate further. You can reclaim your vote at any time on any proposal, instantly, without anyone\'s permission.',
  },
  {
    q: 'Is Ripple free to use?',
    a: 'Yes. The free plan is free forever — 1 organisation, up to 15 members, and unlimited proposals and votes. No credit card required. The Pro plan is $29/month per organisation for unlimited members, analytics, and integrations.',
  },
  {
    q: 'How does delegation work in practice?',
    a: 'Set a delegate for a topic in your settings — someone you trust to vote on your behalf. Their vote carries your weight alongside their own. You can set different delegates for different topics. Vote directly on any proposal to override your delegation for that vote only.',
  },
  {
    q: 'What vote types are supported?',
    a: 'Yes/No/Abstain, ranked choice, approval voting, and score voting. You choose the format when you create a proposal.',
  },
  {
    q: 'Can I keep my organisation private?',
    a: 'Yes. You choose whether your organisation is public (anyone can discover and join) or private (members join via your invite link only). Private organisations and their proposals are not visible to non-members.',
  },
  {
    q: 'Do members need to install anything?',
    a: 'No. Ripple is entirely browser-based. Members sign in with a passkey or magic link — no passwords, no app downloads.',
  },
];

const PRICING_FREE = [
  '1 organisation',
  'Up to 15 members',
  'Unlimited proposals & votes',
  'All voting types',
  'Delegations & weighted voting',
  'Comments & audit log',
];

const PRICING_PRO = [
  'Unlimited organisations',
  'Unlimited members',
  'Everything in Free',
  'Participation analytics',
  'Email domain restriction',
  'Slack integration',
];

const WHY = [
  {
    title: 'Direct democracy doesn\'t scale',
    desc: 'Asking every member to vote on every issue produces fatigue, not wisdom. Participation drops off. The people who stay engaged aren\'t necessarily the most informed.',
  },
  {
    title: 'Representative democracy loses signal',
    desc: 'One representative for all your views, chosen once, for everything. But your opinion on planning isn\'t your opinion on finance. Nuance collapses into a single vote every few years.',
  },
  {
    title: 'Corporate governance is participation theatre',
    desc: 'AGMs, shareholder votes, all-hands surveys. They create the appearance of participation. Rarely do they change outcomes. Most voices stay advisory at best.',
  },
];

const STEPS = [
  { n: '01', title: 'Create an org', desc: 'Set up in minutes. Name it, describe it, choose whether it\'s public or invite-only. Your governance structure, not ours.' },
  { n: '02', title: 'Invite members', desc: 'Share a private invite link or open your org publicly. Members set their own delegation preferences from day one.' },
  { n: '03', title: 'Open a proposal', desc: 'State the question, set a pass threshold, pick a closing date. Discussion opens immediately. Members are notified.' },
  { n: '04', title: 'Decisions, transparent', desc: 'Votes arrive in real time. Delegated votes flow automatically through chains. Results are final, visible, and permanent.' },
];

const FEATURES = [
  {
    title: 'Liquid delegation',
    desc: 'Delegate to someone you trust on any topic. They can delegate further — chains carry expertise to where it\'s needed. Reclaim your vote any time, on any proposal, without asking permission.',
  },
  {
    title: 'Weighted voting',
    desc: 'Not all votes have to be equal. Assign weight by role, seniority, or stake — whatever your group decides is fair. Works alongside delegation.',
  },
  {
    title: 'Live results',
    desc: 'Every vote and delegation update appears instantly. No end-of-day tallies, no admin counting. The outcome is visible the moment it\'s determined.',
  },
  {
    title: 'Threaded discussion',
    desc: 'Every proposal has its own comment thread. @mention colleagues, reply to specific arguments, pin the context worth surfacing. Vote informed.',
  },
  {
    title: 'Full audit trail',
    desc: 'Every vote, delegation, edit, and comment is permanently logged — who did what, when, and on which proposal. Nothing disappears. Nothing is hidden.',
  },
  {
    title: 'Public or private',
    desc: 'Invite-only with a secret link, or open to the world. Public organisations appear on Ripple for anyone to discover and join.',
  },
];

const USE_CASES = [
  { label: 'Neighbourhood groups', desc: "Residents' associations, street committees, planning consultations. Give every neighbour a real voice, not just the ones who show up." },
  { label: 'Worker cooperatives', desc: 'One-member-one-vote, or weighted by stake. Ripple handles the mechanics so you can focus on the work.' },
  { label: 'Local councils', desc: 'Public motions, planning applications, emergency debates. Full transparency, full record.' },
  { label: 'National governments', desc: 'Citizen assemblies, participatory budgeting, large-scale policy consultation. Tested infrastructure for real democratic scale.' },
  { label: 'Companies', desc: 'Async decisions across teams without the meeting overhead. No more threads that go nowhere.' },
  { label: 'DAOs & web3 orgs', desc: 'Off-chain deliberation and delegation to complement on-chain execution. Governance that reflects real opinion, not just token weight.' },
];

interface Stats { orgs: number; members: number; votes: number }

function VoteBar({ label, pct, strong }: { label: string; pct: number; strong?: boolean }) {
  return (
    <div className={styles.vmRow}>
      <span className={styles.vmLabel}>{label}</span>
      <div className={styles.vmTrack}>
        <div className={`${styles.vmFill} ${strong ? styles.vmFillStrong : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.vmPct}>{pct}%</span>
    </div>
  );
}

function VoteMock() {
  return (
    <div className={styles.voteMock}>
      <div className={styles.vmOrg}>Eastside Residents' Association</div>
      <h3 className={styles.vmTitle}>Should we adopt the new neighbourhood charter?</h3>
      <div className={styles.vmMeta}>
        <span className={styles.vmLive}><span className={styles.vmDot} />Live</span>
        <span>18 votes</span>
        <span>Closes in 2 days</span>
      </div>
      <div className={styles.vmBars}>
        <VoteBar label="Yes" pct={67} strong />
        <VoteBar label="No" pct={21} />
        <VoteBar label="Abstain" pct={12} />
      </div>
      <div className={styles.vmFooter}>
        <span>4 votes via delegation</span>
        <span className={styles.vmPassing}>Passing ✓</span>
      </div>
    </div>
  );
}

function DelegationMock() {
  return (
    <div className={styles.delegMock}>
      <div className={styles.delegMockHeader}>
        <span>Members</span>
        <span className={styles.delegMockHeaderNote}>Planning proposal · 4 participants</span>
      </div>
      <div className={styles.delegMockList}>
        <div className={`${styles.delegMockRow} ${styles.delegMockRowActive}`}>
          <div className={styles.delegMockAvatar}>A</div>
          <div className={styles.delegMockInfo}>
            <span className={styles.delegMockName}>Alice Chen</span>
            <span className={styles.delegMockSub}>Voting directly · planning expert</span>
          </div>
          <span className={styles.delegMockWeight}>4×</span>
        </div>
        <div className={styles.delegMockRow}>
          <div className={styles.delegMockAvatar}>B</div>
          <div className={styles.delegMockInfo}>
            <span className={styles.delegMockName}>Bob Martinez</span>
            <span className={styles.delegMockSub}>→ Alice Chen</span>
          </div>
        </div>
        <div className={styles.delegMockRow}>
          <div className={styles.delegMockAvatar}>C</div>
          <div className={styles.delegMockInfo}>
            <span className={styles.delegMockName}>Carol Osei</span>
            <span className={styles.delegMockSub}>→ Alice Chen</span>
          </div>
        </div>
        <div className={styles.delegMockRow}>
          <div className={styles.delegMockAvatar}>D</div>
          <div className={styles.delegMockInfo}>
            <span className={styles.delegMockName}>David Park</span>
            <span className={styles.delegMockSub}>→ Bob → Alice Chen</span>
          </div>
        </div>
      </div>
      <div className={styles.delegMockFooter}>
        Alice carries 4 votes into this proposal
      </div>
    </div>
  );
}

interface Props {
  onSignIn: () => void;
}

export function LandingPage({ onSignIn }: Props) {
  const { data: allOrgs } = useLiveQuery(organisationsCollection);
  const publicOrgs = ((allOrgs ?? []) as Organisation[]).filter((o) => o.is_public);

  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetch('/api/orgs/stats', { credentials: 'include' })
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>◆ Ripple</span>
        <nav className={styles.headerNav}>
          <Link to="/pricing" className={styles.headerNavLink}>Pricing</Link>
          <button onClick={onSignIn} className={styles.headerSignIn}>Sign in</button>
        </nav>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.inner}>
          <div className={styles.heroLayout}>
            <div className={styles.heroContent}>
              <h1 className={styles.heroTitle}>
                Democratic decisions,<br />
                for any group.
              </h1>
              <p className={styles.heroSub}>
                Ripple brings liquid democracy to cooperatives, councils, governments, and any
                organisation that needs to make decisions together — with proposals, delegation,
                and full transparency.
              </p>
              <div className={styles.heroCtas}>
                <button onClick={onSignIn} className={styles.primaryCta}>
                  Get started free
                </button>
                {publicOrgs.length > 0 && (
                  <a href="#organisations" className={styles.secondaryCta}>
                    Explore organisations
                  </a>
                )}
              </div>
            </div>
            <div className={styles.heroVisual}>
              <VoteMock />
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      {stats && (stats.orgs > 0 || stats.votes > 0) && (
        <div className={styles.statsStrip}>
          <div className={styles.inner}>
            <div className={styles.stats}>
              {stats.orgs > 0 && (
                <div className={styles.stat}>
                  <span className={styles.statNum}>{stats.orgs.toLocaleString()}</span>
                  <span className={styles.statLabel}>{stats.orgs === 1 ? 'organisation' : 'organisations'}</span>
                </div>
              )}
              {stats.members > 0 && (
                <div className={styles.stat}>
                  <span className={styles.statNum}>{stats.members.toLocaleString()}</span>
                  <span className={styles.statLabel}>{stats.members === 1 ? 'member' : 'members'}</span>
                </div>
              )}
              {stats.votes > 0 && (
                <div className={styles.stat}>
                  <span className={styles.statNum}>{stats.votes.toLocaleString()}</span>
                  <span className={styles.statLabel}>votes cast</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Why this exists */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>The problem</p>
          <h2 className={styles.sectionTitle}>Participation at scale is an unsolved problem.</h2>
          <p className={styles.sectionSub}>Every existing model makes a compromise. Liquid democracy is a different bet.</p>
          <div className={styles.whyGrid}>
            {WHY.map((w) => (
              <div key={w.title} className={styles.whyCard}>
                <strong className={styles.whyTitle}>{w.title}</strong>
                <p className={styles.whyDesc}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Liquid delegation */}
      <section className={`${styles.section} ${styles.sectionDark}`}>
        <div className={styles.inner}>
          <div className={styles.splitLayout}>
            <div className={styles.splitContent}>
              <p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>Liquid delegation</p>
              <h2 className={`${styles.sectionTitle} ${styles.sectionTitleLight}`}>
                Vote on what you care about.<br />Trust someone else on the rest.
              </h2>
              <p className={styles.splitBody}>
                In a liquid democracy, you don't have to be an expert on everything. Vote directly on the topics you know well. On everything else, delegate your vote to someone you trust — a colleague, a neighbour, a specialist.
              </p>
              <p className={styles.splitBody}>
                Delegation chains. Your delegate can delegate further, and their weight carries through. If they ever vote against your values on something that matters to you, take your vote back instantly — no forms, no approval, no delay.
              </p>
              <div className={styles.splitPillars}>
                <div className={styles.splitPillar}>
                  <strong>Instant</strong>
                  <span>No forms or approval needed to delegate or reclaim</span>
                </div>
                <div className={styles.splitPillar}>
                  <strong>Reversible</strong>
                  <span>Change your delegate at any time on any proposal</span>
                </div>
                <div className={styles.splitPillar}>
                  <strong>Transitive</strong>
                  <span>Chains carry expertise to where it's needed most</span>
                </div>
              </div>
            </div>
            <div className={styles.splitVisual}>
              <DelegationMock />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <p className={styles.sectionSub}>From first proposal to final decision in a matter of days, not months.</p>
          <div className={styles.steps}>
            {STEPS.map((s) => (
              <div key={s.n} className={styles.step}>
                <span className={styles.stepNum}>{s.n}</span>
                <strong className={styles.stepTitle}>{s.title}</strong>
                <p className={styles.stepDesc}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className={`${styles.section} ${styles.sectionDark}`}>
        <div className={styles.inner}>
          <h2 className={`${styles.sectionTitle} ${styles.sectionTitleLight}`}>Everything your group needs</h2>
          <p className={`${styles.sectionSub} ${styles.sectionSubLight}`}>Built for real decisions, not just polls.</p>
          <div className={styles.features}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.feature}>
                <strong className={styles.featureTitle}>{f.title}</strong>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>The technology to run a referendum.<br />The simplicity to run a book club.</h2>
          <div className={styles.useCases}>
            {USE_CASES.map((u) => (
              <div key={u.label} className={styles.useCase}>
                <strong className={styles.useCaseLabel}>{u.label}</strong>
                <p className={styles.useCaseDesc}>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live organisations */}
      {publicOrgs.length > 0 && (
        <section className={styles.section} id="organisations">
          <div className={styles.inner}>
            <h2 className={styles.sectionTitle}>Active organisations</h2>
            <p className={styles.sectionSub}>Browse and join any of these public organisations.</p>
            <div className={styles.orgs}>
              {publicOrgs.map((org) => (
                <Link
                  key={org.id}
                  to="/orgs/$slug/proposals"
                  params={{ slug: org.slug }}
                  className={styles.orgCard}
                >
                  <strong className={styles.orgName}>{org.name}</strong>
                  {org.description && <p className={styles.orgDesc}>{org.description}</p>}
                  <span className={styles.orgSlug}>/{org.slug}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Pricing teaser */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>Pricing</p>
          <h2 className={styles.sectionTitle}>Simple, transparent pricing</h2>
          <p className={styles.sectionSub}>Start free. Upgrade when your organisation grows.</p>
          <div className={styles.pricingTeaser}>
            <div className={styles.pricingTier}>
              <div className={styles.pricingTierHeader}>
                <span className={styles.pricingTierName}>Free</span>
                <div className={styles.pricingTierPrice}>
                  <span className={styles.pricingTierAmount}>$0</span>
                  <span className={styles.pricingTierPer}>/month</span>
                </div>
                <p className={styles.pricingTierNote}>For small teams and personal use</p>
              </div>
              <ul className={styles.pricingTierFeatures}>
                {PRICING_FREE.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
            <div className={`${styles.pricingTier} ${styles.pricingTierHighlighted}`}>
              <div className={styles.pricingTierBadge}>Popular</div>
              <div className={styles.pricingTierHeader}>
                <span className={styles.pricingTierName}>Pro</span>
                <div className={styles.pricingTierPrice}>
                  <span className={styles.pricingTierAmount}>$29</span>
                  <span className={styles.pricingTierPer}>/month per org</span>
                </div>
                <p className={styles.pricingTierNote}>For growing teams that need more</p>
              </div>
              <ul className={styles.pricingTierFeatures}>
                {PRICING_PRO.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          </div>
          <div className={styles.pricingTeaserFooter}>
            <Link to="/pricing" className={styles.pricingTeaserLink}>See full pricing →</Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={`${styles.section} ${styles.sectionDark}`}>
        <div className={styles.inner}>
          <p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>FAQ</p>
          <h2 className={`${styles.sectionTitle} ${styles.sectionTitleLight}`}>Common questions</h2>
          <dl className={styles.faqList}>
            {FAQS.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary className={styles.faqQuestion}>{item.q}</summary>
                <p className={styles.faqAnswer}>{item.a}</p>
              </details>
            ))}
          </dl>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className={styles.ctaStrip}>
        <div className={styles.inner}>
          <p className={styles.ctaStripTitle}>Your organisation is ready for this.</p>
          <p className={styles.ctaStripSub}>
            Free to use. No credit card required.
          </p>
          <button onClick={onSignIn} className={styles.ctaStripBtn}>
            Create your organisation
          </button>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.inner}>
          <div className={styles.footerLeft}>
            <span className={styles.footerLogo}>◆ Ripple</span>
            <span className={styles.footerCopy}>© {new Date().getFullYear()}</span>
          </div>
          <nav className={styles.footerNav}>
            <Link to="/pricing" className={styles.footerNavLink}>Pricing</Link>
            <button onClick={onSignIn} className={styles.footerNavBtn}>Sign in</button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
