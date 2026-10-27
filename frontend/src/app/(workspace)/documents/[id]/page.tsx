'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, authToken } from '@/lib/api/client';
import { RefreshCw, FileText, Download, Sparkles, Pencil, Check } from 'lucide-react';
import { documentsApi } from '@/features/documents/api';
import { DocumentStatus } from '@/features/documents/DocumentStatus';
import { PdfDocumentViewer } from '@/features/viewer/PdfDocumentViewer';
import { toast } from 'sonner';
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
  const [aiOutcome, setAiOutcome] = useState<'idle' | 'ready' | 'model_unavailable' | 'no_evidence'>('idle');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  useEffect(() => {
    const n = new URLSearchParams(location.search).get('page');
    if (n) document.getElementById(`page-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pages.data]);
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
      setAiOutcome('model_unavailable');
      toast.error(error instanceof Error ? error.message : 'AI Read is unavailable');
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
  return (
    <div>
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
      {doc.data.filename?.toLowerCase().endsWith('.pdf') && <PdfDocumentViewer documentId={id} />}
      <section className="document-metadata card" aria-label="Document metadata">
        <div>
          <span>Filename</span>
          <strong>{doc.data.filename || doc.data.title}</strong>
        </div>
        <div>
          <span>SHA-256</span>
          <strong>{doc.data.content_hash ? `${doc.data.content_hash.slice(0, 16)}…` : '—'}</strong>
          {doc.data.content_hash && (
            <button
              aria-label="Copy SHA-256"
              onClick={() => void navigator.clipboard.writeText(doc.data!.content_hash!)}
            >
              Copy
            </button>
          )}
        </div>
        <div>
          <span>Pages</span>
          <strong>{doc.data.page_count ?? pageItems?.length ?? '—'}</strong>
        </div>
        <div>
          <span>Characters</span>
          <strong>{extractedCharacters ?? '—'}</strong>
        </div>
        <div>
          <span>Created</span>
          <strong>{doc.data.created_at ? new Date(doc.data.created_at).toLocaleString() : '—'}</strong>
        </div>
        <div>
          <span>Processed</span>
          <strong>{doc.data.processed_at ? new Date(doc.data.processed_at).toLocaleString() : '—'}</strong>
        </div>
        <div>
          <span>Jurisdiction</span>
          <strong>{doc.data.jurisdiction || '—'}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{doc.data.source_label || '—'}</strong>
        </div>
        {doc.data.is_demo && <span className="badge-demo">Demo document</span>}
      </section>
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
      ) : (
        <article className="card document-page" style={{ marginTop: 18 }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.7 }}>
            {text.data?.text || 'No extracted text is available for this document.'}
          </pre>
        </article>
      )}
      <section className="card" style={{ marginTop: 18, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, color: '#102553', fontSize: 18 }}>
              <Sparkles size={17} /> AI Read
            </h2>
            <p className="muted" style={{ margin: '5px 0 0' }}>
              AI-generated — review before relying on it.
            </p>
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
        {extraction.isError && aiOutcome === 'ready' && (
          <p role="status" style={{ color: '#9f2431' }}>
            AI Read could not load. Retry the request when the service is available.
          </p>
        )}
        {extraction.data?.fields && aiOutcome === 'ready' && (
          <div style={{ display: 'grid', gap: 9, marginTop: 16 }}>
            {Object.entries(extraction.data.fields).map(([key, field]) =>
              (() => {
                const value = field.value;
                const sourcePage =
                  value && typeof value === 'object' && 'page' in value ? Number(value.page) : undefined;
                return (
                  <div
                    className="ai-read-field"
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(120px, 190px) 1fr auto',
                      gap: 10,
                      alignItems: 'start',
                      padding: '10px 0',
                      borderTop: '1px solid #edf0f5',
                    }}
                  >
                    <strong style={{ color: '#31436a', textTransform: 'capitalize' }}>
                      {key.replaceAll('_', ' ')}
                    </strong>
                    {editingField === key ? (
                      <textarea
                        aria-label={`Edit ${key}`}
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                      />
                    ) : (
                      <div style={{ color: '#53627d', whiteSpace: 'pre-wrap' }}>
                        {typeof field.value === 'string'
                          ? field.value || '—'
                          : JSON.stringify(field.value) || '—'}
                        <small style={{ display: 'block', marginTop: 5, color: '#8a93a4' }}>
                          {field.provenance || 'ai_suggested'} · {field.source || 'Source unavailable'}
                          {field.review_required ? ' · Review required' : ''}
                          {sourcePage ? (
                            <a className="ai-source-page" href={`?page=${sourcePage}`}>
                              Page {sourcePage}
                            </a>
                          ) : (
                            <span className="ai-source-page">Page —</span>
                          )}
                        </small>
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
                          setEditValue(
                            typeof field.value === 'string'
                              ? field.value
                              : JSON.stringify(field.value, null, 2),
                          );
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                );
              })(),
            )}
          </div>
        )}
        {pageItems?.some((page) => page.warnings?.length) && (
          <div
            role="note"
            style={{ marginTop: 14, padding: 12, color: '#72591b', background: '#fff8e7', borderRadius: 8 }}
          >
            <strong>Extraction warnings</strong>
            {pageItems
              .flatMap((page) => page.warnings || [])
              .map((warning, index) => (
                <p key={`${warning}-${index}`} style={{ margin: '5px 0' }}>
                  {warning}
                </p>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
