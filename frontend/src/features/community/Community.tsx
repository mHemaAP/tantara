'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { CaseItem, CommunityPost, CommunityReply, communityApi, errorMessage, Identity } from './api';

function errorText(error: unknown) {
  if (error instanceof ApiError) return `${error.status}: ${error.message}`;
  return errorMessage(error);
}
function authorName(value: { author?: { name?: string }; author_name?: string }) {
  return value.author?.name || value.author_name || '—';
}
function Composer({ onCreated }: { onCreated: (post: CommunityPost) => void }) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [caseId, setCaseId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    communityApi
      .cases()
      .then((page) => setCases(page.items || []))
      .catch(() => setCases([]));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const post = await communityApi.create({
        title,
        body,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        ...(caseId ? { case_id: caseId } : {}),
      });
      setTitle('');
      setBody('');
      setTags('');
      setCaseId('');
      onCreated(post);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card" onSubmit={submit} style={{ padding: 20, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Start a discussion</h2>
      <label>
        Title
        <input required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Details
        <textarea required rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <label>
        Tags, separated by commas
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>
      <label>
        Related case (optional)
        <select value={caseId} onChange={(event) => setCaseId(event.target.value)}>
          <option value="">No case link</option>
          {cases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" style={{ color: '#b42318', margin: 0 }}>
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'Posting…' : 'Post discussion'}
      </button>
    </form>
  );
}

export function CommunityFeed() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (nextPage: number, q: string, selectedTag: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await communityApi.list(nextPage, q, selectedTag);
      setPosts(result.items || []);
      setPages(result.pages || 1);
      setPage(result.page || nextPage);
      setTags(result.tags || Array.from(new Set((result.items || []).flatMap((post) => post.tags || []))));
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(1, '', '');
  }, [load]);
  const createPost = (post: CommunityPost) => {
    setPosts((current) => [post, ...current]);
  };
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '28px 20px', display: 'grid', gap: 20 }}>
      <header>
        <p className="muted" style={{ marginBottom: 4 }}>
          PEER DISCUSSION
        </p>
        <h1 className="title">Community</h1>
        <p className="subheading">Discuss practical questions with your legal community.</p>
      </header>
      <Composer
        onCreated={(post) => {
          createPost(post);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <section aria-label="Community discussions" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            aria-label="Search discussions"
            placeholder="Search discussions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(1, query, tag);
            }}
          />
          <button className="secondary-button" onClick={() => void load(1, query, tag)}>
            Search
          </button>
          {tags.map((item) => (
            <button
              key={item}
              className={tag === item ? 'primary' : 'secondary-button'}
              onClick={() => {
                const next = tag === item ? '' : item;
                setTag(next);
                void load(1, query, next);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="offline">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="muted">
            Loading discussions…
          </p>
        ) : posts.length === 0 ? (
          <div className="card" style={{ padding: 24 }}>
            <h2>No discussions yet</h2>
            <p className="muted">Start with a question or practical insight using the composer above.</p>
          </div>
        ) : (
          posts.map((post) => (
            <article className="card" key={post.id} style={{ padding: 20 }}>
              <p className="muted" style={{ marginTop: 0 }}>
                {authorName(post)} · {post.created_at ? new Date(post.created_at).toLocaleString() : '—'}
              </p>
              <h2 style={{ margin: '4px 0' }}>
                <Link href={`/community/${post.id}`}>{post.title}</Link>
              </h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{post.body}</p>
              {post.tags?.length ? <p className="muted">{post.tags.join(' · ')}</p> : null}
              {post.case_id && post.case_title ? <p>Case: {post.case_title}</p> : null}
            </article>
          ))
        )}
        {!loading && pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => void load(page - 1, query, tag)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              className="secondary-button"
              disabled={page >= pages}
              onClick={() => void load(page + 1, query, tag)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export function CommunityThread({ id }: { id: string }) {
  const router = useRouter();
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [replies, setReplies] = useState<CommunityReply[]>([]);
  const [me, setMe] = useState<Identity | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([communityApi.post(id), communityApi.replies(id), communityApi.me()])
      .then(([p, r, identity]) => {
        setPost(p);
        setReplies(Array.isArray(r) ? r : r.items || []);
        setMe(identity);
      })
      .catch((issue) => setError(errorText(issue)));
  }, [id]);
  const own = useMemo(
    () =>
      !!post &&
      !!me &&
      ((post.author?.id && me.id === post.author.id) || (post.author_id && me.id === post.author_id)),
    [post, me],
  );
  async function sendReply(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await communityApi.reply(id, reply);
      setReplies((current) => [...current, created]);
      setReply('');
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await communityApi.save(id);
      const fresh = await communityApi.post(id);
      setPost(fresh);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm('Delete this discussion? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    try {
      await communityApi.remove(id);
      router.push('/community');
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }
  if (!post && !error)
    return (
      <main style={{ padding: 28 }}>
        <p role="status">Loading discussion…</p>
      </main>
    );
  return (
    <main style={{ maxWidth: 850, margin: '0 auto', padding: '28px 20px', display: 'grid', gap: 18 }}>
      <Link href="/community">← Community</Link>
      {error && (
        <p role="alert" className="offline">
          {error}
        </p>
      )}
      {post && (
        <article className="card" style={{ padding: 24 }}>
          <p className="muted">
            Posted by {authorName(post)}
            {own ? ' · posted by you' : ''} ·{' '}
            {post.created_at ? new Date(post.created_at).toLocaleString() : '—'}
          </p>
          <h1>{post.title}</h1>
          <p style={{ whiteSpace: 'pre-wrap' }}>{post.body}</p>
          {post.tags?.length ? <p className="muted">{post.tags.join(' · ')}</p> : null}
          {post.case_id && post.case_title ? <p>Case: {post.case_title}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary-button" disabled={busy} onClick={() => void save()}>
                {post.saved || post.is_saved ? 'Unsave discussion' : 'Save discussion'}
            </button>
            {own && (
              <button className="secondary-button" disabled={busy} onClick={() => void remove()}>
                Delete discussion
              </button>
            )}
          </div>
        </article>
      )}
      <section>
        <h2>Replies ({replies.length || '—'})</h2>
        {[...replies]
          .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
          .map((item) => (
            <article className="card" key={item.id} style={{ padding: 16, marginBottom: 10 }}>
              <p className="muted">
                {authorName(item)} · {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{item.body}</p>
            </article>
          ))}
        {replies.length === 0 && <p className="muted">No replies yet.</p>}
      </section>
      <form className="card" onSubmit={sendReply} style={{ padding: 20 }}>
        <label htmlFor="reply">Add a reply</label>
        <textarea
          id="reply"
          required
          rows={4}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
        <button className="primary" disabled={busy}>
          {busy ? 'Sending…' : 'Reply'}
        </button>
      </form>
    </main>
  );
}
