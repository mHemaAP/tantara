import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  Files,
  FileText,
  Fingerprint,
  Gavel,
  Layers3,
  Search,
  UsersRound,
} from 'lucide-react';
import { HeroSceneLoader } from '@/components/marketing/hero-scene-loader';

export const metadata: Metadata = {
  title: 'TANTARA — Grounded Arbitration Research, in Your Workspace',
  description:
    'Research Indian arbitration law with answers grounded in retrieved passages and citations that point to the page. Keep your legal workspace on your own infrastructure.',
};

const features = [
  {
    icon: BriefcaseBusiness,
    title: 'Matters & limitation dates',
    text: 'Keep contract records, parties, claim values, hearings and critical dates together.',
  },
  {
    icon: BookOpenCheck,
    title: 'Statute shelf & OCR',
    text: 'Work with Indian bare acts and searchable text from scanned documents.',
  },
  {
    icon: Search,
    title: 'Hybrid search, page anchors',
    text: 'Combine full-text and vector search to find relevant passages by page.',
  },
  {
    icon: Gavel,
    title: 'Grounded research desk',
    text: 'Research answers use retrieved statute passages, with inline page citations and ranked sources.',
  },
  {
    icon: Files,
    title: 'Filing bundles',
    text: 'Select document pages or passages and bring them together in a downloadable PDF.',
  },
  {
    icon: CalendarDays,
    title: 'Tasks & calendar',
    text: 'Track work alongside hearings and limitation dates in one workspace.',
  },
  {
    icon: UsersRound,
    title: 'Community',
    text: 'Share a post privately or with your workspace when collaboration helps.',
  },
  {
    icon: Fingerprint,
    title: 'Roles & workspace isolation',
    text: 'Each account sees its own records, with access shaped by its assigned role.',
  },
];

export default function MarketingPage() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <Link href="/" className="landing-brand" aria-label="TANTARA home">
          <img src="/brand/t-mark.svg" alt="" />
          <span>TANTARA</span>
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#research">Research</a>
          <a href="#sovereignty">Sovereignty</a>
        </nav>
        <div className="landing-header-actions">
          <Link className="landing-button landing-button-quiet" href="/signin">
            Sign in
          </Link>
          <Link className="landing-button landing-button-primary" href="/signup">
            Create an account
          </Link>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span /> A workspace for Indian arbitration practice
          </p>
          <h1 id="landing-title">Arbitration practice, organised end to end.</h1>
          <p className="landing-hero-description">
            Research from retrieved legal material and see the page behind every citation. Bring matters,
            documents and day-to-day work into one considered workspace.
          </p>
          <div className="landing-hero-actions">
            <Link className="landing-button landing-button-primary landing-button-large" href="/signup">
              Create a free account <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="landing-button landing-button-outline landing-button-large" href="/signin">
              Sign in
            </Link>
          </div>
          <p className="landing-infrastructure-note">
            Runs on your own infrastructure. Model, database and files stay in your cluster.
          </p>
        </div>
        <HeroSceneLoader />
        <a href="#research" className="landing-scroll-cue">
          Explore the workspace <ArrowDownRight size={15} aria-hidden="true" />
        </a>
      </section>

      <section className="landing-process" id="research" aria-labelledby="research-title">
        <div className="landing-section-heading">
          <p className="landing-eyebrow landing-eyebrow-light">Research with a trail back to the source</p>
          <h2 id="research-title">From document to cited passage.</h2>
          <p>Move from source material to a focused answer while keeping the authority in view.</p>
        </div>
        <div className="landing-steps">
          <article className="landing-step">
            <span className="landing-step-number">01</span>
            <div className="landing-step-icon">
              <FileText size={22} aria-hidden="true" />
            </div>
            <h3>Upload</h3>
            <p>Bring in PDF, DOCX, TXT and Markdown files.</p>
          </article>
          <div className="landing-step-connector" aria-hidden="true" />
          <article className="landing-step">
            <span className="landing-step-number">02</span>
            <div className="landing-step-icon">
              <Layers3 size={22} aria-hidden="true" />
            </div>
            <h3>Index</h3>
            <p>Split pages, run OCR on scans, then create chunks and embeddings.</p>
          </article>
          <div className="landing-step-connector" aria-hidden="true" />
          <article className="landing-step">
            <span className="landing-step-number">03</span>
            <div className="landing-step-icon">
              <Search size={22} aria-hidden="true" />
            </div>
            <h3>Ask</h3>
            <p>Get a grounded answer with citation chips that point to the page it came from.</p>
          </article>
        </div>
        <div className="landing-citation-preview" aria-label="Citation example">
          <span className="landing-grounding-badge">
            <span /> Retrieved material only · Source aware
          </span>
          <span className="landing-citation-text">
            Retrieved passage with a direct link back to its source page.
          </span>
          <span className="landing-citation-chip">
            ARBITRATION AND CONCILIATION ACT 1996 <b>·</b> Page 12
          </span>
        </div>
      </section>

      <section className="landing-features" id="features" aria-labelledby="features-title">
        <div className="landing-section-heading landing-section-heading-dark">
          <p className="landing-eyebrow">Made for the work around the hearing</p>
          <h2 id="features-title">One workspace for the whole matter.</h2>
          <p>Keep the record, research and next steps connected as a matter moves forward.</p>
        </div>
        <div className="landing-feature-grid">
          {features.map(({ icon: Icon, title, text }) => (
            <article className="landing-feature-card" key={title}>
              <span className="landing-feature-icon">
                <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-sovereignty" id="sovereignty" aria-labelledby="sovereignty-title">
        <div className="landing-sovereignty-mark" aria-hidden="true">
          <Gavel size={28} />
        </div>
        <div className="landing-sovereignty-copy">
          <p className="landing-eyebrow landing-eyebrow-light">Your practice, your infrastructure</p>
          <h2 id="sovereignty-title">Your Postgres. Your object store. Your model.</h2>
          <p>
            TANTARA runs inside your infrastructure, keeping your database, files and model under your
            control. Each account has an isolated workspace, with role-based access for the team.
          </p>
        </div>
        <div className="landing-sovereignty-points">
          <span>
            <i /> Per-user workspace isolation
          </span>
          <span>
            <i /> Role-based access enforcement
          </span>
          <span>
            <i /> Your model and data services
          </span>
        </div>
      </section>

      <section className="landing-closing" aria-labelledby="closing-title">
        <p className="landing-eyebrow">Make the next step easier to find</p>
        <h2 id="closing-title">Keep your research close to its source.</h2>
        <p>Start with a workspace built around the record, the authority and the work ahead.</p>
        <Link className="landing-button landing-button-primary landing-button-large" href="/signup">
          Create a free account <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>

      <footer className="landing-footer">
        <Link href="/" className="landing-brand" aria-label="TANTARA home">
          <img src="/brand/t-mark.svg" alt="" />
          <span>TANTARA</span>
        </Link>
        <p>For legal research assistance only. Verify all authorities and advice against primary sources.</p>
        <Link href="/signin">Sign in</Link>
      </footer>
    </main>
  );
}
