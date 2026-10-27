'use client';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  Command,
  FileText,
  FolderOpen,
  House,
  Menu,
  Search,
  Settings,
  Users,
  X,
  ArrowRight,
} from 'lucide-react';
import { api, clearToken } from '@/lib/api/client';
import { toast } from 'sonner';
import type { Activity } from '@/lib/api/types';
const navItems = [
  { href: '/dashboard', label: 'Dashboard', Icon: House },
  { href: '/settings/profile', label: 'Settings', Icon: Settings },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    router = useRouter();
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState(false),
    [authReady, setAuthReady] = useState(false),
    [displayName, setDisplayName] = useState('Aarav Mehta'),
    [displayRole, setDisplayRole] = useState('Advocate'),
    [notifications, setNotifications] = useState(false),
    [noticeItems, setNoticeItems] = useState<Activity[]>([]),
    [palette, setPalette] = useState(false),
    [q, setQ] = useState(''),
    [profile, setProfile] = useState(false),
    [hits, setHits] = useState<Array<{ title: string; href: string; kind: string }>>([]),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const isPreview = localStorage.getItem('tantara_preview') === 'true';
    document.documentElement.dataset.theme = localStorage.getItem('tantara_theme') || 'light';
    document.documentElement.dataset.density = localStorage.getItem('tantara_density') || 'comfortable';
    document.documentElement.dataset.font = localStorage.getItem('tantara_font') || 'inter';
    setPreview(isPreview);
    const hasToken =
      !!document.cookie.split('; ').find((x) => x.startsWith('tantara_token=')) ||
      !!localStorage.getItem('tantara_token');
    if (isPreview) {
      setAuthReady(true);
    } else if (!hasToken) {
      router.replace('/');
    } else {
      api
        .get<{ name: string; role: string }>('/auth/me')
        .then((u) => {
          setDisplayName(u.name);
          setDisplayRole(u.role);
          setAuthReady(true);
        })
        .catch(() => router.replace('/'));
    }
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        setTimeout(() => input.current?.focus(), 0);
      }
      if (e.key === 'Escape') {
        setPalette(false);
        setOpen(false);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [router]);
  const search = async (term: string) => {
    setQ(term);
    if (term.trim().length < 2) {
      setHits([]);
      setOffline(false);
      return;
    }
    setBusy(true);
    setOffline(false);
    try {
      const [cases, docs] = await Promise.allSettled([
        api.get<{ items: Array<{ id: string; title: string }> }>(`/cases?q=${encodeURIComponent(term)}`),
        api.get<{ items: Array<{ document_id: string; document_title: string }> }>(
          `/search/documents?query=${encodeURIComponent(term)}&page=1&page_size=5`,
        ),
      ]);
      const h: Array<{ title: string; href: string; kind: string }> = [];
      if (cases.status === 'fulfilled')
        cases.value.items?.forEach((x) => h.push({ title: x.title, href: `/cases/${x.id}`, kind: 'Case' }));
      if (docs.status === 'fulfilled')
        docs.value.items?.forEach((x) =>
          h.push({ title: x.document_title, href: `/documents/${x.document_id}`, kind: 'Document' }),
        );
      setHits(h.slice(0, 8));
      if (cases.status === 'rejected' && docs.status === 'rejected') setOffline(true);
    } finally {
      setBusy(false);
    }
  };
  const showNotifications = async () => {
    const next = !notifications;
    setNotifications(next);
    if (next) {
      try {
        setNoticeItems(await api.get<Activity[]>('/dashboard/activity'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Notifications unavailable');
      }
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const links = Array.from(document.querySelectorAll<HTMLElement>('.nav a'));
    const i = links.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const n =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? links.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % links.length
            : (i - 1 + links.length) % links.length;
    links[n]?.focus();
  };
  return (
    <div className="workspace">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {open && <button className="sidebar-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brandmark">T</span>
          <span className="brandword">TANTARA</span>
        </div>
        <nav className="nav" aria-label="Main navigation" onKeyDown={onKey}>
          {navItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                path === href || (path.startsWith('/settings') && label === 'Settings') ? 'page' : undefined
              }
              onClick={() => setOpen(false)}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-art">
          <div>
            <strong>
              Focused on
              <br />
              Arbitration Law
            </strong>
            <small>
              Smarter Tools.
              <br />
              Faster Resolution.
            </small>
          </div>
        </div>
      </aside>
      <button className="mobile-toggle" aria-label="Open navigation" onClick={() => setOpen(true)}>
        <Menu size={19} />
      </button>
      <header className="topbar">
        <button
          aria-label="Open global search"
          className="mobile-toggle search-toggle"
          style={{ position: 'static' }}
          onClick={() => setPalette(true)}
        >
          <Search size={17} />
        </button>
        <div
          className="searchbox"
          onClick={() => setPalette(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setPalette(true)}
        >
          <Search size={16} style={{ margin: 'auto 0 auto 13px', color: '#64748b' }} />
          <span
            aria-label="Search arbitration workspace"
            style={{ flex: 1, alignContent: 'center', paddingLeft: 14, fontSize: 12, color: '#64748b' }}
          >
            Search arbitration cases, documents, provisions, or ask TANTARA…
          </span>
          <button aria-label="Search">
            <Search size={17} />
          </button>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            aria-label="Notifications"
            onClick={() => void showNotifications()}
            style={{
              position: 'relative',
              border: 0,
              background: 'transparent',
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            <Bell size={19} />
            <span
              style={{
                position: 'absolute',
                width: 7,
                height: 7,
                borderRadius: 9,
                background: '#e11d48',
                right: 0,
                top: 0,
              }}
            />
          </button>
          {notifications && (
            <div className="notification-pop">
              <strong>Recent activity</strong>
              {noticeItems.length ? (
                noticeItems.slice(0, 5).map((x) => (
                  <div key={x.id}>
                    {x.title}
                    <small>{x.at}</small>
                  </div>
                ))
              ) : (
                <p className="muted">No recent notifications.</p>
              )}
            </div>
          )}
        </div>
        <div className="user-menu">
          <button
            onClick={() => setProfile(!profile)}
            style={{
              display: 'flex',
              gap: 9,
              alignItems: 'center',
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              color: '#0f172a',
            }}
          >
            <span className="user-avatar">AM</span>
            <span className="user-caption" style={{ textAlign: 'left' }}>
              <strong style={{ fontSize: 12 }}>{displayName}</strong>
              <small style={{ display: 'block', fontSize: 10, color: '#64748b' }}>{displayRole}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {profile && (
            <div className="profile-pop">
              <Link href="/settings/profile">Profile</Link>
              <Link href="/settings/profile">Settings</Link>
              <button
                onClick={() => {
                  clearToken();
                  router.push('/');
                  toast.success('Signed out');
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="main" className="main">
        {authReady ? (
          children
        ) : (
          <div className="card" style={{ padding: 22, color: '#64748b' }}>
            Opening your workspace…
          </div>
        )}
      </main>
      <Dialog.Root open={palette} onOpenChange={setPalette}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content className="dialog">
            <Dialog.Title className="sr-only">Global search</Dialog.Title>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Command size={18} />
              <input
                ref={input}
                value={q}
                onChange={(e) => search(e.target.value)}
                aria-label="Search cases and documents"
                placeholder="Search cases and documents…"
                style={{ flex: 1, border: 0, outline: 0, padding: '9px 0' }}
              />
              <button onClick={() => setPalette(false)} aria-label="Close">
                <X size={17} />
              </button>
            </div>
            {offline ? (
              <div className="offline" style={{ marginTop: 14 }}>
                Backend not reachable at 127.0.0.1:8010
              </div>
            ) : busy ? (
              <p className="muted">Searching…</p>
            ) : hits.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                {hits.map((h, i) => (
                  <Link
                    key={i}
                    href={h.href}
                    onClick={() => setPalette(false)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: 11,
                      borderTop: '1px solid #eef1f5',
                    }}
                  >
                    <span>{h.title}</span>
                    <small className="muted">
                      {h.kind}
                      <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 6 }} />
                    </small>
                  </Link>
                ))}
              </div>
            ) : q.length > 1 ? (
              <p className="muted">No matching records. Try another search.</p>
            ) : (
              <p className="muted">Type to search your cases and documents. Press Esc to close.</p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {preview && <div className="mobile-preview">Read-only preview · Changes disabled</div>}
    </div>
  );
}
