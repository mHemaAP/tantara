'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, FileText, GripVertical, MoveDown, MoveUp, RefreshCw, Sparkles } from 'lucide-react';
import { bundleApi, type Bundle, type BundleItem, type BundlePreview, type DocumentOption } from '@/features/bundles/api';
import '@/features/bundles/bundles.css';

const contentSections = ['Pleadings', 'Main Petition / Statement of Claim', 'Written Statement (if any)', 'Annexures', 'Exhibits', 'Orders', 'Arbitral Tribunal Orders', 'Authorities', 'Authorities / Judgments'];
const frontMatter = [
  ['cover_page', 'Cover Page'],
  ['index', 'Index'],
  ['synopsis', 'Synopsis'],
  ['list_of_dates', 'List of Dates'],
] as const;
type EditableItem = BundleItem & { start_page?: number; end_page?: number };

export default function BundleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bundle, setBundle] = useState<Bundle>();
  const [preview, setPreview] = useState<BundlePreview>();
  const [items, setItems] = useState<EditableItem[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [caseTitle, setCaseTitle] = useState('');
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [newDocument, setNewDocument] = useState('');
  const [newSection, setNewSection] = useState(contentSections[0]);
  const [newStart, setNewStart] = useState(1);
  const [newEnd, setNewEnd] = useState(1);
  const [pdf, setPdf] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const record = await bundleApi.get(id);
      setBundle(record);
      const [mapping, docs, cases] = await Promise.all([
        bundleApi.preview(id),
        record.case_id ? bundleApi.documents(record.case_id) : Promise.resolve({ items: [] }),
        bundleApi.cases(),
      ]);
      setPreview(mapping);
      const flattened: EditableItem[] = mapping.sections.flatMap((section) =>
        section.items.map((item, order) => ({
          document_id: item.document_id,
          title: item.title,
          section: section.title,
          order,
          pages: item.pages,
          page_start: item.page_start,
          page_end: item.page_end,
          start_page: item.start_page,
          end_page: item.end_page,
        })),
      );
      setItems(flattened);
      setDocuments(docs.items);
      setSectionOrder(mapping.sections.map((section) => section.title));
      setCaseTitle(cases.items.find((item) => item.id === record.case_id)?.title ?? '');
      setNewDocument((current) => current || docs.items.find((document) => !flattened.some((item) => item.document_id === document.id))?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This bundle could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => void reload(), [reload]);

  const selectedDocument = useMemo(() => documents.find((doc) => doc.id === newDocument), [documents, newDocument]);
  useEffect(() => {
    if (!selectedDocument) return;
    setNewStart(1);
    setNewEnd(selectedDocument.page_count || 1);
  }, [selectedDocument]);

  const saveItems = async (next: EditableItem[]) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const nextSections = [...new Set([...sectionOrder, ...next.map((item) => item.section)])];
      if (nextSections.length !== sectionOrder.length) {
        await bundleApi.updateSections(id, nextSections.map((title, order) => ({ title, order })));
        setSectionOrder(nextSections);
      }
      await bundleApi.updateItems(id, next.map((item, order) => ({
        document_id: item.document_id,
        section: item.section,
        order,
        page_start: item.page_start,
        page_end: item.page_end,
      })));
      await reload();
      setSuccess('Bundle contents saved. Page mapping refreshed.');
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      const message = status === 400 ? (cause as Error).message : status === 409 ? 'A document can appear only once in a bundle. Remove the existing row before assigning a different section.' : cause instanceof Error ? cause.message : 'Bundle contents could not be saved.';
      // Restore the persisted form values after a rejected edit while keeping
      // the backend's validation message visible to the user.
      await reload();
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const addDocument = () => {
    if (!selectedDocument) return;
    if (items.some((item) => item.document_id === selectedDocument.id)) {
      setError('A document can appear only once in a bundle. Change its section on its existing row.');
      return;
    }
    if (newStart < 1 || newEnd < newStart || newEnd > selectedDocument.page_count) {
      setError(`Choose a source page range between 1 and ${selectedDocument.page_count}.`);
      return;
    }
    const next = [...items, {
      document_id: selectedDocument.id,
      title: selectedDocument.title,
      section: newSection,
      order: items.length,
      pages: newEnd - newStart + 1,
      page_start: newStart,
      page_end: newEnd,
    }];
    void saveItems(next);
  };

  const saveSections = async (next: string[]) => {
    setSectionOrder(next);
    setBusy(true);
    setError('');
    try {
      await bundleApi.updateSections(id, next.map((title, order) => ({ title, order })));
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Section order could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const updateSettings = async (key: string, checked: boolean) => {
    if (!bundle) return;
    const settings = { ...(bundle.settings ?? {}), [key]: checked };
    setBundle({ ...bundle, settings });
    try {
      setBundle(await bundleApi.updateSettings(id, settings));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bundle settings could not be saved.');
      await reload();
    }
  };

  const generate = async () => {
    if (!items.length) return;
    setBusy(true);
    setError('');
    setSuccess('Generating merged PDF…');
    try {
      const result = await bundleApi.generate(id);
      const latest = await bundleApi.get(id);
      setBundle(latest);
      const mapping = await bundleApi.preview(id);
      setPreview(mapping);
      setSuccess(`Bundle ready · ${result.pages} pages. Download is available.`);
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setError(status === 400 ? (cause as Error).message : status === 409 ? 'The bundle changed while it was being generated. Review its contents and retry.' : cause instanceof Error ? cause.message : 'Bundle generation failed.');
      setSuccess('');
    } finally {
      setBusy(false);
    }
  };

  const fetchPdf = async () => {
    const response = await fetch(bundleApi.downloadUrl(id), {
      headers: (await import('@/lib/api/client')).authToken()
        ? { Authorization: `Bearer ${(await import('@/lib/api/client')).authToken()}` }
        : {},
    });
    if (!response.ok) throw new Error('The generated PDF is not available.');
    const blob = await response.blob();
    if ((await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('The download did not contain a PDF file.');
    return blob;
  };

  const showPdf = async () => {
    try {
      setPdf(URL.createObjectURL(await fetchPdf()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'PDF preview unavailable.');
    }
  };

  const download = async () => {
    try {
      const url = URL.createObjectURL(await fetchPdf());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${bundle?.name ?? 'filing-bundle'}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'PDF download unavailable.');
    }
  };

  if (loading) return <main className="bundle-page"><div className="bundle-load-state" role="status">Opening bundle…</div></main>;
  if (!bundle) return <main className="bundle-page"><div className="bundle-notice" role="alert">{error || 'Bundle not found.'}</div><Link href="/bundles">Back to bundles</Link></main>;

  const downloadable = bundle.status === 'ready' && bundle.downloadable;
  return (
    <main className="bundle-page bundle-detail-page">
      <Link className="bundle-back-link" href="/bundles"><ArrowLeft size={15} /> All bundles</Link>
      <header className="bundle-head">
        <div>
          <div className="bundle-eyebrow">FILING BUNDLE · {caseTitle || 'CASE'}</div>
          <h1>{bundle.name}</h1>
          <p>{caseTitle} · <span className={`bundle-status-pill status-${bundle.status}`}>{bundle.status}</span></p>
        </div>
        <div className="bundle-detail-actions">
          {downloadable ? <>
            <button className="bundle-secondary" onClick={() => void showPdf()}><FileText size={15} /> Preview PDF</button>
            <button className="bundle-primary" onClick={() => void download()}><Download size={15} /> Download PDF</button>
          </> : <span className="bundle-action-reason">Generate a bundle with saved documents to enable preview and download.</span>}
          <button className="bundle-primary" disabled={busy || items.length === 0} title={!items.length ? 'Add at least one document before generating.' : undefined} onClick={() => void generate()}><Sparkles size={15} />{busy ? 'Generating…' : 'Generate Bundle'}</button>
        </div>
      </header>

      {error && <div className="bundle-notice" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
      {success && <div className="bundle-success" role="status">{success}</div>}

      <div className="bundle-detail-grid">
        <section className="bundle-card bundle-contents-card">
          <div className="bundle-card-title"><div><span className="bundle-step">01</span><h2>Bundle Contents</h2></div><span className="bundle-count">{items.length} documents</span></div>
          <label className="bundle-label" htmlFor="bundle-add-document">Add a case document</label>
          <div className="bundle-add-controls">
            <select id="bundle-add-document" value={newDocument} onChange={(event) => setNewDocument(event.target.value)}>
              {documents.filter((doc) => !items.some((item) => item.document_id === doc.id)).map((doc) => <option key={doc.id} value={doc.id}>{doc.title} · {doc.page_count} pages</option>)}
            </select>
            <select aria-label="New document section" value={newSection} onChange={(event) => setNewSection(event.target.value)}>{contentSections.map((section) => <option key={section}>{section}</option>)}</select>
          </div>
          {selectedDocument && <div className="bundle-range-form">
            <label>Source page from<input type="number" min={1} max={selectedDocument.page_count} value={newStart} onChange={(event) => setNewStart(Number(event.target.value))} /></label>
            <label>Through page<input type="number" min={newStart} max={selectedDocument.page_count} value={newEnd} onChange={(event) => setNewEnd(Number(event.target.value))} /></label>
            <button className="bundle-secondary" disabled={busy} onClick={addDocument}>Add document</button>
          </div>}
          <p className="bundle-constraint">A source document can appear once per bundle. Change its section on its existing row instead of adding it again.</p>
          {items.length ? <ol className="bundle-items" aria-label="Bundle document order">{items.map((item, index) => <li key={item.document_id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) { const next = [...items]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); void saveItems(next); } }}>
            <GripVertical size={16} className="bundle-grip" />
            <div className="bundle-doc-info"><strong>{item.title}</strong><span>Source pages {item.page_start}–{item.page_end} · {item.pages} pages</span>
              <div className="bundle-item-edit"><label>Section<select aria-label={`Section for ${item.title}`} value={item.section} onChange={(event) => void saveItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, section: event.target.value } : row))}>{[...new Set([...contentSections, ...items.map((row) => row.section)])].map((section) => <option key={section}>{section}</option>)}</select></label><label>From<input aria-label={`Source page start for ${item.title}`} type="number" min={1} max={documents.find((doc) => doc.id === item.document_id)?.page_count ?? item.page_end} value={item.page_start} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, page_start: Number(event.target.value) } : row))} onBlur={() => void saveItems(items)} /></label><label>To<input aria-label={`Source page end for ${item.title}`} type="number" min={item.page_start} max={documents.find((doc) => doc.id === item.document_id)?.page_count ?? item.page_end} value={item.page_end} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, page_end: Number(event.target.value) } : row))} onBlur={() => void saveItems(items)} /></label></div>
            </div>
            <div className="bundle-moves"><button aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveItems(next); }}><MoveUp size={14} /></button><button aria-label={`Move ${item.title} down`} disabled={index === items.length - 1} onClick={() => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; void saveItems(next); }}><MoveDown size={14} /></button><button aria-label={`Remove ${item.title}`} onClick={() => void saveItems(items.filter((row) => row.document_id !== item.document_id))}>×</button></div>
          </li>)}</ol> : <div className="bundle-empty"><FileText size={25} /><strong>No documents added</strong><span>Select a case document above to start this paperbook.</span></div>}
          <button className="bundle-secondary bundle-save-contents" disabled={busy || !items.length} onClick={() => void saveItems(items)}>Save contents and refresh page ranges</button>
        </section>

        <section className="bundle-card bundle-paper">
          <div className="bundle-card-title"><div><span className="bundle-step">02</span><h2>Index & Page Mapping</h2></div><button className="bundle-text-button" onClick={() => void reload()}><RefreshCw size={14} /> Refresh</button></div>
          {pdf ? <iframe className="bundle-pdf" src={pdf} title="Generated merged filing PDF" /> : <>
            <div className="bundle-preview-meta"><strong>{preview?.total_pages ?? '—'}</strong><span>bundle pages</span>{preview?.warnings.map((warning) => <p className="bundle-review" key={warning}>{warning}</p>)}</div>
            <div className="bundle-mapping-table"><div className="bundle-mapping-head"><span>Section / document</span><span>Source pages</span><span>Bundle pages</span></div>
              {preview?.sections.length ? preview.sections.map((section, sectionIndex) => <div className="bundle-mapping-section" key={section.title}><div className="bundle-mapping-section-title"><span>{String(sectionIndex + 1).padStart(2, '0')}</span><strong>{section.title}</strong></div>{section.items.map((item) => <div className="bundle-mapping-row" key={item.document_id}><span>{item.title}</span><span>{item.page_start}–{item.page_end}</span><span>{item.start_page}–{item.end_page}</span></div>)}</div>) : <p className="paper-placeholder">Add source documents to calculate their bundle page mapping.</p>}
            </div>
            <p className="bundle-searchability-note">Scanned source pages may be included as page images and may not have searchable text.</p>
          </>}
          {downloadable && <div className="bundle-paper-actions"><button onClick={() => void showPdf()}><FileText size={15} /> Preview generated PDF</button><button onClick={() => void download()}><Download size={15} /> Download PDF</button></div>}
        </section>

        <aside className="bundle-card bundle-controls">
          <div className="bundle-card-title"><div><span className="bundle-step">03</span><h2>Bundle Setup</h2></div></div>
          <label className="bundle-label">Section order</label>
          <ol className="bundle-section-order">{sectionOrder.map((section, index) => <li key={section}><span>{String(index + 1).padStart(2, '0')}</span>{section}<div className="section-moves"><button aria-label={`Move section ${section} up`} disabled={index === 0 || busy} onClick={() => { const next = [...sectionOrder]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveSections(next); }}>↑</button><button aria-label={`Move section ${section} down`} disabled={index === sectionOrder.length - 1 || busy} onClick={() => { const next = [...sectionOrder]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; void saveSections(next); }}>↓</button></div></li>)}</ol>
          <div className="bundle-switches"><strong className="bundle-section-label">Front matter</strong>{frontMatter.map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={bundle.settings?.[key] ?? true} onChange={(event) => void updateSettings(key, event.target.checked)} /></label>)}</div>
          <div className="bundle-status"><span className={`bundle-status-dot ${downloadable ? 'ready' : ''}`} /><span>{bundle.status}</span></div>
          <button className="bundle-primary bundle-full" disabled={busy || !items.length} title={!items.length ? 'Add at least one document before generating.' : undefined} onClick={() => void generate()}><Sparkles size={15} />{busy ? 'Generating…' : 'Generate Bundle'}</button>
          {!items.length && <p className="bundle-help">Add at least one document to enable generation.</p>}
          <p className="bundle-help">Review the generated index and verify every source page range before filing.</p>
        </aside>
      </div>
    </main>
  );
}
