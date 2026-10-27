'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, authToken } from '@/lib/api/client';
import { RefreshCw, FileText, Download, Sparkles, Pencil, Check } from 'lucide-react';
import { documentsApi } from '@/features/documents/api';
import { DocumentStatus } from '@/features/documents/DocumentStatus';
import { PdfDocumentViewer } from '@/features/viewer/PdfDocumentViewer';
import { toast } from 'sonner';
import '@/features/documents/documents.css';
import './document-detail.css';
type Doc = {
  id: string;
  title: string;
  document_type?: string;
  status?: string;
  jurisdiction?: string;
  case_id?: string;
  created_at?: string;
  pages?: number;
  page_count?: number;
  filename?: string;
  content_hash?: string;
  size_bytes?: number;
  is_demo?: boolean;
  source_label?: string;
  processed_at?: string;
};
type Page = { page_number: number; text?: string; ocr_confidence?: number; warnings?: string[] };
type Extraction = {
  fields?: Record<
    string,
    { value: unknown; provenance?: string; source?: string; review_required?: boolean }
  >;
};
type ChunkHit = {
  document_id: string;
  page_number: number;
  snippet?: string;
  retrieval_score?: number;
  retreival_score?: number;
  score?: number;
};
export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useQuery({ queryKey: ['documents', id], queryFn: () => api.get<Doc>(`/documents/${id}`) });
  const text = useQuery({
    queryKey: ['documents', id, 'text'],
    queryFn: () => api.get<{ text?: string; pages?: Page[] }>(`/documents/${id}/text`),
  });
  const pages = useQuery({
    queryKey: ['documents', id, 'pages'],
    queryFn: () => api.get<{ pages?: Page[] }>(`/documents/${id}/pages`),
  });
  const extraction = useQuery({
    queryKey: ['documents', id, 'ai-read'],
    queryFn: () => api.get<Extraction>(`/documents/${id}/ai-read`),
  });
  const [reading, setReading] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [aiOutcome, setAiOutcome] = useState<
    'idle' | 'ready' | 'model_unavailable' | 'no_evidence' | 'failed'
  >('idle');
  const [aiError, setAiError] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [copiedHash, setCopiedHash] = useState(false);
  const [chunkSearch, setChunkSearch] = useState('');
  const [submittedChunkSearch, setSubmittedChunkSearch] = useState('');
  const chunkHits = useQuery({
    queryKey: ['document-chunks', id, submittedChunkSearch],
    enabled: submittedChunkSearch.trim().length > 1,
    queryFn: () =>
      api.get<{ items: ChunkHit[] }>(
        `/search/documents?query=${encodeURIComponent(submittedChunkSearch)}&page_size=100`,
      ),
  });
  const download = async () => {
    try {
      const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8010').replace(/\/$/, '');
      const r = await fetch(`${base}/api/v1/documents/${id}/file`, {
        headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
      });
      if (!r.ok) throw new Error('Document download unavailable');
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = `${doc.data?.title || 'document'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to download document');
    }
  };
  if (doc.isLoading)
    return (
      <div className="card surface" role="status">
        Loading document…
      </div>
    );
  if (doc.isError)
    return (
      <div className="offline">
        <strong>Document not available</strong>
        <p>Confirm this document is in your workspace and the API is running.</p>
        <button className="primary" onClick={() => void doc.refetch()}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  if (!doc.data) return <div className="offline">Document details were not returned.</div>;
  const pageItems = pages.data?.pages;
  const extractedCharacters = pageItems?.reduce((total, item) => total + (item.text?.length ?? 0), 0);
  const runAiRead = async () => {
    setReading(true);
    try {
      const settings = await documentsApi.aiStatus();
      setAiBaseUrl(settings.base_url);
      const readiness = await documentsApi.askForReadiness(
        `Summarize the source document ${doc.data?.title ?? ''} and identify its arbitration terms.`,
        doc.data?.case_id,
      );
      if (readiness.status === 'model_unavailable') {
        setAiOutcome('model_unavailable');
        return;
      }
      if (readiness.status === 'no_evidence') {
        setAiOutcome('no_evidence');
        return;
      }
      await documentsApi.aiRead(id);
      await extraction.refetch();
      setAiOutcome('ready');
    } catch (error) {
      setAiOutcome('failed');
      setAiError(error instanceof Error ? error.message : 'AI Read failed');
    } finally {
      setReading(false);
    }
  };
  const saveExtraction = async (key: string) => {
    try {
      await api.patch(`/documents/${id}/extraction`, { fields: { [key]: editValue } });
      setEditingField(null);
      await extraction.refetch();
      toast.success('Reviewed extraction saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save review');
    }
  };
  const showExtractionFields =
    aiOutcome === 'ready' || (aiOutcome === 'idle' && Boolean(extraction.data?.fields));
  return (
    <div className="document-detail-page">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <small className="muted">Documents / Preview</small>
          <h1 className="title" style={{ marginTop: 8 }}>
            {doc.data.title}
          </h1>
          <p className="subheading">
            {doc.data.document_type || 'Document'} · <DocumentStatus status={doc.data.status} />
            {doc.data.jurisdiction ? ` · ${doc.data.jurisdiction}` : ''}
          </p>
        </div>
        <button className="primary" onClick={() => void download()}>
          <Download size={15} /> Download PDF
        </button>
      </div>
      <div className="document-detail-columns">
        <div className="document-detail-primary">
          {doc.data.filename?.toLowerCase().endsWith('.pdf') && <PdfDocumentViewer documentId={id} />}
          <section className="document-metadata card" aria-label="Document metadata">
            <dl>
              <div className="metadata-hash-row">
                <div
                  className="metadata-definition-row"
                  role="group"
                  aria-label={`SHA-256 ${doc.data.content_hash ? `${doc.data.content_hash.slice(0, 16)}…` : '—'}`}
                >
                  <dt>SHA-256</dt>{' '}
                  <dd>{doc.data.content_hash ? `${doc.data.content_hash.slice(0, 16)}…` : '—'}</dd>
                </div>
                {doc.data.content_hash && (
                  <button
                    aria-label="Copy SHA-256"
                    onClick={async () => {
                      await navigator.clipboard.writeText(doc.data!.content_hash!);
                      setCopiedHash(true);
                      window.setTimeout(() => setCopiedHash(false), 2200);
                    }}
                  >
                    {copiedHash ? 'Copied' : 'Copy'}
                  </button>
                )}
                {copiedHash && <span role="status">SHA-256 copied</span>}
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Filename ${doc.data.filename || doc.data.title}`}
              >
                <dt>Filename</dt> <dd>{doc.data.filename || doc.data.title}</dd>
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Pages ${doc.data.page_count ?? pageItems?.length ?? '—'}`}
              >
                <dt>Pages</dt> <dd>{doc.data.page_count ?? pageItems?.length ?? '—'}</dd>
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Characters ${extractedCharacters == null ? '—' : extractedCharacters.toLocaleString()}`}
              >
                <dt>Characters</dt>{' '}
                <dd>{extractedCharacters == null ? '—' : extractedCharacters.toLocaleString()}</dd>
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Created ${doc.data.created_at ? new Date(doc.data.created_at).toLocaleString() : '—'}`}
              >
                <dt>Created</dt>{' '}
                <dd>{doc.data.created_at ? new Date(doc.data.created_at).toLocaleString() : '—'}</dd>
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Processed ${doc.data.processed_at ? new Date(doc.data.processed_at).toLocaleString() : '—'}`}
              >
                <dt>Processed</dt>{' '}
                <dd>{doc.data.processed_at ? new Date(doc.data.processed_at).toLocaleString() : '—'}</dd>
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Jurisdiction ${doc.data.jurisdiction || '—'}`}
              >
                <dt>Jurisdiction</dt> <dd>{doc.data.jurisdiction || '—'}</dd>
              </div>
              <div
                className="metadata-definition-row"
                role="group"
                aria-label={`Source ${doc.data.source_label || '—'}`}
              >
                <dt>Source</dt> <dd>{doc.data.source_label || '—'}</dd>
              </div>
            </dl>
            {doc.data.is_demo && <span className="badge-demo">Demo document</span>}
          </section>
        </div>
        <aside className="document-detail-aside">
          <section className="card ai-read-panel" aria-label="AI Read">
            <div className="ai-read-heading">
              <div>
                <h2>
                  <Sparkles size={17} /> AI Read
                </h2>
                <p>AI-generated — review before relying on it.</p>
              </div>
              <button className="primary" disabled={reading} onClick={() => void runAiRead()}>
                {reading ? 'Reading…' : aiOutcome === 'ready' ? 'Run again' : 'Run AI Read'}
              </button>
            </div>
            {aiOutcome === 'model_unavailable' && (
              <div className="ai-read-degradation" role="status">
                <strong>AI model unavailable</strong>
                <p>The configured model endpoint did not respond. No extraction fields are being shown.</p>
                <code>{aiBaseUrl || 'Configured endpoint could not be loaded'}</code>
                <button className="primary" onClick={() => void runAiRead()}>
                  Retry AI Read
                </button>
              </div>
            )}
            {aiOutcome === 'no_evidence' && (
              <div className="ai-read-degradation" role="status">
                <strong>No evidence found</strong>
                <p>
                  The document search returned no source passages for this document, so there are no candidate
                  fields to review.
                </p>
              </div>
            )}
            {aiOutcome === 'failed' && (
              <p role="status" className="ai-read-error">
                AI Read failed: {aiError || 'The response could not be processed.'}
              </p>
            )}
            {extraction.isError && aiOutcome === 'ready' && (
              <p role="status" className="ai-read-error">
                AI Read could not load. Retry the request when the service is available.
              </p>
            )}
            {extraction.data?.fields && showExtractionFields && (
              <div className="ai-read-fields">
                {Object.entries(extraction.data.fields).map(([key, field]) => {
                  const value = field.value;
                  const sourcePage =
                    value && typeof value === 'object' && 'page' in value ? Number(value.page) : undefined;
                  return (
                    <div className="ai-read-field" data-field-key={key} key={key}>
                      <strong>{key.replaceAll('_', ' ')}</strong>
                      {editingField === key ? (
                        <textarea
                          aria-label={`Edit ${key}`}
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                        />
                      ) : (
                        <div className="ai-read-value">
                          {typeof value === 'string' ? value || '—' : JSON.stringify(value) || '—'}
                          <small>
                            {field.provenance || 'ai_suggested'} · {field.source || 'Source unavailable'}
                            {field.review_required ? ' · Review required' : ''}
                          </small>
                          {sourcePage ? (
                            <a className="ai-source-page" href={`?page=${sourcePage}`}>
                              Page {sourcePage}
                            </a>
                          ) : (
                            <span className="ai-source-page">Page —</span>
                          )}
                        </div>
                      )}
                      {editingField === key ? (
                        <button aria-label={`Save ${key}`} onClick={() => void saveExtraction(key)}>
                          <Check size={15} />
                        </button>
                      ) : (
                        <button
                          aria-label={`Edit ${key}`}
                          onClick={() => {
                            setEditingField(key);
                            setEditValue(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
      {text.isLoading ? (
        <div className="card surface" style={{ marginTop: 18 }}>
          <span role="status">Loading extracted text…</span>
        </div>
      ) : text.isError ? (
        <div className="offline" style={{ marginTop: 18 }}>
          Text extraction is unavailable for this document.{' '}
          <button className="primary" onClick={() => void text.refetch()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : pageItems?.length ? (
        <section className="document-chunk-panel card" aria-label="Document page chunks">
          <form
            className="document-chunk-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedChunkSearch(chunkSearch.trim());
            }}
          >
            <label htmlFor="document-chunk-query">Search this document</label>
            <input
              id="document-chunk-query"
              value={chunkSearch}
              onChange={(event) => setChunkSearch(event.target.value)}
              placeholder="Search text, for example SIAC Rules"
            />
            <button className="primary" type="submit">
              Find chunks
            </button>
          </form>
          {chunkHits.isLoading && <p role="status">Searching document text…</p>}
          {chunkHits.data?.items
            .filter((hit) => hit.document_id === id)
            .map((hit, index) => {
              const relevance = hit.retrieval_score ?? hit.retreival_score ?? hit.score;
              return (
                <article className="citation-chunk" key={`${hit.page_number}-${index}`}>
                  <p>{hit.snippet || 'Matching document passage'}</p>
                  <div>
                    <span>Page {hit.page_number}</span>
                    <span>Relevance {typeof relevance === 'number' ? relevance.toFixed(3) : '—'}</span>
                    <a
                      href={`?page=${hit.page_number}&highlight=${encodeURIComponent(submittedChunkSearch)}`}
                    >
                      Open page {hit.page_number}
                    </a>
                  </div>
                </article>
              );
            })}
          {submittedChunkSearch &&
            chunkHits.data &&
            !chunkHits.data.items.some((hit) => hit.document_id === id) && (
              <p className="muted">No matching chunks in this document.</p>
            )}
          <details className="document-page-text-list">
            <summary>Extracted text by page</summary>
            <div className="document-pages">
              {pageItems.map((p) => (
                <article className="card document-page" id={`page-${p.page_number}`} key={p.page_number}>
                  <div className="page-heading">
                    <span>
                      <FileText size={15} /> Page {p.page_number}
                    </span>
                    {p.ocr_confidence != null && (
                      <small className="muted">OCR confidence {Math.round(p.ocr_confidence * 100)}%</small>
                    )}
                  </div>
                  <p>
                    {p.text ||
                      text.data?.pages?.find((x) => x.page_number === p.page_number)?.text ||
                      'No extracted text on this page.'}
                  </p>
                </article>
              ))}
            </div>
          </details>
        </section>
      ) : (
        <article className="card document-page" style={{ marginTop: 18 }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.7 }}>
            {text.data?.text || 'No extracted text is available for this document.'}
          </pre>
        </article>
      )}
      {pageItems?.some((page) => page.warnings?.length) && (
        <div className="extraction-warnings" role="note">
          <strong>Extraction warnings</strong>
          {pageItems
            .flatMap((page) => page.warnings || [])
            .map((warning, index) => (
              <p key={`${warning}-${index}`}>{warning}</p>
            ))}
        </div>
      )}
    </div>
  );
}
