'use client';

import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Command, House, Menu, Search, Settings, X, ArrowRight } from 'lucide-react';
import { api, clearToken } from '@/lib/api/client';
import { toast } from 'sonner';
import type { Activity } from '@/lib/api/types';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', Icon: House },
  { href: '/settings/profile', label: 'Settings', Icon: Settings },
];
type Hit = { title: string; href: string; kind: string };

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [displayRole, setDisplayRole] = useState('');
  const [notifications, setNotifications] = useState(false);
  const [noticeItems, setNoticeItems] = useState<Activity[]>([]);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');
  const [profile, setProfile] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const isPreview = localStorage.getItem('tantara_preview') === 'true';
    document.documentElement.dataset.theme = localStorage.getItem('tantara_theme') || 'light';
    document.documentElement.dataset.density = localStorage.getItem('tantara_density') || 'comfortable';
    document.documentElement.dataset.font = localStorage.getItem('tantara_font') || 'inter';
    setPreview(isPreview);
    if (isPreview) {
      setDisplayName('Preview workspace');
      setDisplayRole('Read-only preview');
      setAuthReady(true);
    } else {
      const hasToken =
        !!document.cookie.split('; ').find((x) => x.startsWith('tantara_token=')) ||
        !!localStorage.getItem('tantara_token');
      if (!hasToken) router.replace('/');
      else
        api
          .get<{ name: string; role: string }>('/auth/me')
          .then((user) => {
            setDisplayName(user.name);
            setDisplayRole(user.role);
            setAuthReady(true);
          })
          .catch(() => router.replace('/'));
    }
    const onKey = (e: KeyboardEvent) => {
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      const result: Hit[] = [];
      if (cases.status === 'fulfilled')
        cases.value.items?.forEach((x) =>
          result.push({ title: x.title, href: `/cases/${x.id}`, kind: 'Case' }),
        );
      if (docs.status === 'fulfilled')
        docs.value.items?.forEach((x) =>
          result.push({ title: x.document_title, href: `/documents/${x.document_id}`, kind: 'Document' }),
        );
      setHits(result.slice(0, 8));
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
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '—';

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
          onClick={() => setPalette(true)}
        >
          <Search size={17} />
        </button>
        <button
          type="button"
          className="searchbox"
          aria-label="Open global search"
          onClick={() => setPalette(true)}
        >
          <Search size={16} />
          <span>Search arbitration cases, documents, provisions, or ask TANTARA…</span>
          <span className="search-submit">
            <Search size={17} />
          </span>
        </button>
        <div className="notification-wrap">
          <button aria-label="Notifications" onClick={() => void showNotifications()} className="icon-button">
            <Bell size={19} />
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
          <button onClick={() => setProfile(!profile)} className="user-trigger">
            <span className="user-avatar">{initials}</span>
            <span className="user-caption">
              <strong>{displayName}</strong>
              <small>{displayRole}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {profile && (
            <div className="profile-pop">
              <Link href="/settings/profile">Profile</Link>
              <Link href="/settings/profile">Settings</Link>
              {!preview && (
                <button
                  onClick={() => {
                    clearToken();
                    router.push('/');
                    toast.success('Signed out');
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
        {preview && (
          <span className="preview-badge" role="status">
            Read-only preview · Changes disabled
          </span>
        )}
      </header>
      <main id="main" className="main">
        {authReady ? (
          children
        ) : (
          <div className="card" role="status" style={{ padding: 22, color: '#64748b' }}>
            Opening your workspace…
          </div>
        )}
      </main>
      <Dialog.Root open={palette} onOpenChange={setPalette}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content className="dialog">
            <Dialog.Title className="sr-only">Global search</Dialog.Title>
            <div className="palette-search">
              <Command size={18} />
              <input
                ref={input}
                value={q}
                onChange={(e) => void search(e.target.value)}
                aria-label="Search cases and documents"
                placeholder="Search cases and documents…"
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
              <p className="muted" role="status">
                Searching…
              </p>
            ) : hits.length ? (
              <div className="search-hits">
                {hits.map((h, i) => (
                  <Link key={i} href={h.href} onClick={() => setPalette(false)}>
                    <span>{h.title}</span>
                    <small>
                      {h.kind}
                      <ArrowRight size={12} />
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
    </div>
  );
}
