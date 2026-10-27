'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

type Manifest = Record<string, unknown>;
function entries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((item, index) => [String(index + 1), item]);
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>);
  return [];
}
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function CorpusImportPanel() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const result = await api.get<Manifest>('/settings/data/import');
      setManifest(result);
      setError('');
      const text = JSON.stringify(result).toLowerCase();
      setPending(/"status"\s*:\s*"(running|pending|started|importing)/.test(text));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Manifest unavailable');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [pending]);
  async function start() {
    if (
      !window.confirm(
        'This downloads public legal corpus sources from the internet and indexes them in this workspace. It requires an internet connection. Continue?',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api.post('/settings/data/import');
      setPending(true);
      await refresh();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Import could not be started');
    } finally {
      setBusy(false);
    }
  }
  const records = manifest ? entries(manifest.sources ?? manifest.items ?? manifest.manifest) : [];
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="muted">
        Review the last recorded corpus manifest, or start a public source import. Importing needs internet
        access.
      </p>
      {error && (
        <p role="alert" className="offline">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy} onClick={() => void start()}>
        {busy ? 'Starting import…' : 'Import public legal corpus'}
      </button>
      {pending && <p role="status">Import is in progress. Status refreshes automatically.</p>}
      <section>
        <h3>Corpus manifest</h3>
        {manifest ? (
          records.length ? (
            records.map(([key, item]) => (
              <article className="card" key={key} style={{ padding: 14, marginBottom: 10 }}>
                <strong>
                  {typeof item === 'object' && item
                    ? show((item as Manifest).source_name ?? (item as Manifest).name ?? key)
                    : key}
                </strong>
                <dl className="data-list">
                  {entries(item).map(([field, value]) => (
                    <div key={field}>
                      <dt>{field.replaceAll('_', ' ')}</dt>
                      <dd>{show(value)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))
          ) : (
            <dl className="data-list">
              {entries(manifest).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll('_', ' ')}</dt>
                  <dd>{show(value)}</dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          <p role="status">Loading manifest…</p>
        )}
      </section>
      <section>
        <h3>Storage and index</h3>
        <p>
          Data directory: <code>{show(manifest?.data_dir ?? manifest?.tantara_data_dir)}</code>
        </p>
        <p>Index size: {show(manifest?.index_size ?? manifest?.index_size_bytes)}</p>
        <p className="muted">
          To rebuild the search index, run <code>python scripts/rebuild_index.py</code> from the repository
          root.
        </p>
      </section>
    </div>
  );
}
