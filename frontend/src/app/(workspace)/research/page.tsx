'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, BookOpen } from 'lucide-react';
import { api } from '@/lib/api/client';

type Answer = { status: string; answer: string; citations?: Array<{ document_id: string; document_title: string; page_number: number; chunk_id: string; excerpt?: string }> };
function ResearchDesk() {
  const params = useSearchParams();
  const caseId = params.get('case_id') ?? '';
  const [question, setQuestion] = useState(params.get('question') ?? '');
  const [answer, setAnswer] = useState<Answer>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError('');
    try {
      setAnswer(await api.post<Answer>('/ai/ask', { question: question.trim(), ...(caseId ? { case_id: caseId } : {}) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Research request failed.');
    } finally {
      setBusy(false);
    }
  };
  return <main style={{ maxWidth: 900, margin: '0 auto' }}>
    <small className="muted">RESEARCH DESK</small><h1 className="title" style={{ marginTop: 8 }}>Ask about your case</h1>
    <p className="subheading">Questions are scoped to the selected case and grounded in retrieved documents.</p>
    <form className="card surface" onSubmit={(event) => void ask(event)} style={{ padding: 18, marginTop: 16 }}>
      <label htmlFor="research-question" className="section-title"><BookOpen size={16} /> Follow-up question</label>
      <textarea id="research-question" value={question} onChange={(event) => setQuestion(event.target.value)} required rows={5} style={{ width: '100%', padding: 12, border: '1px solid var(--line)', borderRadius: 8, resize: 'vertical' }} />
      <button className="primary" disabled={busy || !question.trim()}><ArrowRight size={15} />{busy ? 'Searching…' : 'Search case evidence'}</button>
    </form>
    {error && <div className="offline" role="alert">{error}</div>}
    {answer && <section className="card surface" style={{ padding: 18, marginTop: 16 }}><span className="pill">{answer.status}</span><p>{answer.answer}</p>{answer.citations?.map((citation) => <a className="strategy-citation" key={citation.chunk_id} href={`/documents/${citation.document_id}?page=${citation.page_number}`}>{citation.document_title} · p. {citation.page_number}</a>)}</section>}
  </main>;
}
export default function ResearchPage() { return <Suspense fallback={<main role="status">Opening Research Desk…</main>}><ResearchDesk /></Suspense>; }
