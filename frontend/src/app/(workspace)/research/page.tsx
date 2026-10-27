'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileText,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  researchApi,
  type ResearchAnswer,
  type ResearchSession,
  type ResearchSource,
} from '@/features/research/api';
import { documentPageUrl } from '@/features/research/document-url';
import './research.css';

type Choice = { id?: string; name?: string } | string;
const list = <T,>(v: { items?: T[] } | T[] | undefined): T[] => (Array.isArray(v) ? v : (v?.items ?? []));
const scoreOf = (s: ResearchSource) => s.retrieval_score ?? s.retreival_score;
const formatHistoryDate = (value?: string) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Date unavailable';
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

function AnswerText({ text, citations }: { text: string; citations: ResearchSource[] }) {
  return (
    <div className="answer-text">
      {text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((sentence, index) => (
        <p className="answer-sentence" key={`${index}-${sentence}`}>
          {sentence}
          {citations.map((source) =>
            source.citation_ref ? (
              <a
                className="answer-citation"
                key={`${source.chunk_id}-${source.citation_ref}`}
                href={documentPageUrl(source.document_id, source.page_number, source.chunk_id)}
                aria-label={`Citation ${source.citation_ref}: ${source.document_title}, page ${source.page_number}`}
              >
                {source.citation_ref}
              </a>
            ) : null,
          )}
        </p>
      ))}
    </div>
  );
}

export default function ResearchPage() {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [saved, setSaved] = useState<Array<{ id: string; item_id: string; item_type: string }>>([]);
  const [cases, setCases] = useState<Array<{ id: string; title: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [collectionsUnavailable, setCollectionsUnavailable] = useState(false);
  const [jurisdictions, setJurisdictions] = useState<Choice[]>([]);
  const [selected, setSelected] = useState<ResearchSession | null>(null);
  const [caseFilter, setCaseFilter] = useState('');
  const [collection, setCollection] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState<ResearchAnswer | null>(null);
  const [lexical, setLexical] = useState<ResearchSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const refreshHistory = useCallback(async () => {
    const [history, library, caseData, collData, jurisdictionData] = await Promise.allSettled([
      researchApi.sessions(),
      researchApi.saved(),
      researchApi.cases(),
      researchApi.collections(),
      researchApi.jurisdictions(),
    ]);
    if (history.status === 'fulfilled') setSessions(history.value.items ?? []);
    if (library.status === 'fulfilled') {
      setSaved(library.value.items ?? []);
      setSavedIds(new Set(library.value.items?.map((x) => x.item_id) ?? []));
    }
    if (caseData.status === 'fulfilled') setCases(caseData.value.items ?? []);
    if (collData.status === 'fulfilled') {
      const v = collData.value;
      setCollections(
        list(v as { items?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>),
      );
      setCollectionsUnavailable(
        list(v as { items?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>)
          .length === 0,
      );
    } else setCollectionsUnavailable(true);
    if (jurisdictionData.status === 'fulfilled') setJurisdictions(list(jurisdictionData.value));
    if (history.status === 'rejected')
      setError('Research history is unavailable. Check your connection and retry.');
  }, []);

  useEffect(() => {
    void refreshHistory();
    return () => abortRef.current?.abort();
  }, [refreshHistory]);

  const loadSession = async (session: ResearchSession) => {
    setSelected(session);
    setAnswer(null);
    setLexical([]);
    setError('');
    try {
      setSelected(await researchApi.session(session.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this research session.');
    }
  };

  const sources = useMemo(() => answer?.sources ?? answer?.citations ?? [], [answer]);
  const ask = async (question = draft) => {
    if (!question.trim() || busy) return;
    setDraft(question);
    setError('');
    setAnswer(null);
    setLexical([]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const result = await researchApi.ask(
        {
          question: question.trim(),
          session_id: selected?.id,
          case_id: caseFilter || undefined,
          collection_id: collection || undefined,
          jurisdiction: jurisdiction || undefined,
        },
        controller.signal,
      );
      setAnswer(result);
      if (result.research_session_id) {
        try {
          setSelected(await researchApi.session(result.research_session_id));
        } catch {
          /* answer remains visible */
        }
      }
      if (result.status === 'model_unavailable') {
        try {
          const hits = await researchApi.lexical(question.trim(), controller.signal);
          setLexical(
            (hits.items ?? []).map((hit) => ({
              document_id: hit.document_id,
              document_title: hit.document_title,
              chunk_id: hit.chunk_id,
              page_number: hit.page_number,
              excerpt: hit.snippet,
              retrieval_score: hit.score,
            })),
          );
        } catch {
          setLexical([]);
        }
      }
      void refreshHistory();
    } catch (e) {
      if (controller.signal.aborted) setError('Research was cancelled or timed out. Retry when ready.');
      else setError('Research could not complete. Check your connection and retry.');
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
      abortRef.current = null;
    }
  };

  const startNew = async () => {
    abortRef.current?.abort();
    setAnswer(null);
    setLexical([]);
    setDraft('');
    setError('');
    try {
      const session = await researchApi.createSession('New research session');
      setSelected(session);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    } catch {
      setSelected(null);
      setError('A new research session could not be created. Check your connection and retry.');
    }
    textarea.current?.focus();
  };
  const save = async (id?: string) => {
    if (!id) {
      setError('The API did not return a message id to save.');
      return;
    }
    try {
      await researchApi.save(id);
      setSavedIds((old) => new Set(old).add(id));
      void refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this answer.');
    }
  };

  const selectedSources = answer?.status === 'model_unavailable' ? lexical : sources;
  const distinctSourceCount = new Set(selectedSources.map((source) => source.document_id)).size;
  const corpusCount = answer ? String(distinctSourceCount) : '—';
  const answerIsInsufficient =
    (answer?.status === 'ok' || answer?.status === 'answered') &&
    /evidence is insufficient/i.test(answer.answer ?? '');
  const activeMessages = selected?.messages ?? [];
  const answerAlreadyInHistory =
    !!answer?.message_id && activeMessages.some((message) => message.id === answer.message_id);
  const filteredSessions = sessions.filter(
    (s) =>
      (!caseFilter || s.case_id === caseFilter) &&
      (!collection || s.collection_id === collection) &&
      (!jurisdiction || s.jurisdiction === jurisdiction),
  );
  const openSaved = async (item: { item_id: string; item_type: string }) => {
    if (item.item_type === 'research_item') {
      const session = sessions.find((candidate) => candidate.id === item.item_id);
      if (session) await loadSession(session);
      return;
    }
    for (const session of sessions) {
      try {
        const full = await researchApi.session(session.id);
        if (full.messages?.some((message) => message.id === item.item_id)) {
          setSelected(full);
          setAnswer(null);
          setLexical([]);
          return;
        }
      } catch {
        // Keep checking the remaining sessions; the saved item stays in the library.
      }
    }
    setError('The saved answer could not be matched to an available research session.');
  };

  return (
    <main className="research-page">
      <div className="research-heading">
        <div>
          <div className="research-eyebrow">
            <Scale size={15} /> TANTARA / RESEARCH DESK
          </div>
          <h1>Research Desk</h1>
          <p>Grounded legal research across your workspace library.</p>
        </div>
        <button className="research-new" onClick={startNew}>
          <Plus size={17} /> New research
        </button>
      </div>
      <div className="research-filters">
        <label>
          <span>Case</span>
          <select value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}>
            <option value="">All cases</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <label
          className="collection-filter"
          title={collectionsUnavailable ? 'Collection metadata is unavailable from this backend.' : ''}
        >
          <span>Collection</span>
          <select value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">{collectionsUnavailable ? 'Collections unavailable' : 'All collections'}</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <label>
          <span>Jurisdiction</span>
          <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            <option value="">All jurisdictions</option>
            {jurisdictions.map((j) => {
              const name = typeof j === 'string' ? j : (j.name ?? j.id ?? '');
              return (
                <option key={name} value={typeof j === 'string' ? j : (j.id ?? name)}>
                  {name}
                </option>
              );
            })}
          </select>
          <ChevronDown size={14} />
        </label>
        <div className="scope-note">
          <Search size={14} /> Scope applies to new questions
        </div>
      </div>
      <div className="research-grid">
        <aside className="research-left">
          <section className="research-card history-card">
            <header>
              <h2>
                <BookOpen size={16} /> Research history
              </h2>
              <button aria-label="Refresh history" onClick={() => void refreshHistory()}>
                <RefreshCw size={14} />
              </button>
            </header>
            {filteredSessions.length ? (
              <div className="history-list">
                {filteredSessions.map((s) => (
                  <button
                    className={`history-item ${selected?.id === s.id ? 'selected' : ''}`}
                    key={s.id}
                    onClick={() => void loadSession(s)}
                  >
                    <span>{s.title}</span>
                    <small>{formatHistoryDate(s.updated_at ?? s.created_at)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="research-empty">
                <FolderOpen size={21} />
                <strong>{sessions.length ? 'No sessions match this scope' : 'No research history'}</strong>
                <span>
                  {sessions.length
                    ? 'Clear or change a filter to see more sessions.'
                    : 'Your saved sessions will appear here.'}
                </span>
                <button onClick={startNew}>
                  Start a research question <ArrowRight size={13} />
                </button>
              </div>
            )}
          </section>
          <section className="research-card saved-card">
            <header>
              <h2>
                <Bookmark size={16} /> Saved searches
              </h2>
              <span>{saved.length}</span>
            </header>
            {saved.length ? (
              saved.slice(0, 5).map((item) => (
                <button className="saved-item" key={item.id} onClick={() => void openSaved(item)}>
                  {item.item_type === 'message' ? 'Saved answer' : 'Saved research'}
                </button>
              ))
            ) : (
              <div className="saved-empty">Save an answer to keep it in your research library.</div>
            )}
            <Link href="/research/documents">
              Browse library <ArrowRight size={13} />
            </Link>
          </section>
        </aside>
        <section className="research-center">
          <div className="research-card conversation-card">
            <header className="conversation-head">
              <div className="ai-mark">
                <Sparkles size={16} />
              </div>
              <div>
                <h2>
                  Ask TANTARA <span>Legal research assistant</span>
                </h2>
                <p>Answers are grounded in retrieved workspace documents.</p>
              </div>
              <span className="secure-tag">
                <Check size={12} /> Source aware
              </span>
            </header>
            <div className="conversation-body" aria-live="polite">
              {activeMessages.length
                ? activeMessages.map((m, messageIndex) => (
                    <article className={`turn ${m.role}`} key={m.id}>
                      <div className="turn-label">
                        {m.role === 'user' ? 'You' : 'TANTARA'}
                        {m.role === 'assistant' && m.status && (
                          <span className={`status-chip ${m.status}`}>{m.status.replaceAll('_', ' ')}</span>
                        )}
                      </div>
                      {m.role === 'assistant' && m.status === 'model_unavailable' ? (
                        <div className="state-callout unavailable">
                          <strong>Model unavailable</strong>
                          <p>
                            The model is unreachable. Retry, or use evidence-only mode with the documents
                            shown.
                          </p>
                          <button
                            onClick={() =>
                              void ask(
                                activeMessages
                                  .slice(0, messageIndex)
                                  .reverse()
                                  .find((message) => message.role === 'user')?.content ?? draft,
                              )
                            }
                          >
                            <RefreshCw size={14} /> Retry
                          </button>
                        </div>
                      ) : m.role === 'assistant' && m.status === 'no_evidence' ? (
                        <div className="state-callout no-evidence">
                          <strong>Insufficient evidence in your library</strong>
                          <p>
                            No supporting documents were found. Upload a document, widen the research scope,
                            or rephrase your question.
                          </p>
                          <Link href="/documents">Upload a document</Link>
                        </div>
                      ) : m.role === 'assistant' && m.status === 'embedding_unavailable' ? (
                        <div className="state-callout lexical-state">
                          <strong>Embeddings unavailable</strong>
                          <p>Only lexical results were available; no grounded answer is shown.</p>
                        </div>
                      ) : m.role === 'assistant' && /evidence is insufficient/i.test(m.content) ? (
                        <div className="state-callout no-evidence model-insufficient">
                          <strong>Evidence is insufficient</strong>
                          <AnswerText text={m.content} citations={m.citations ?? []} />
                          <p>
                            Review the retrieved excerpts below; no conclusion was generated from this
                            evidence.
                          </p>
                        </div>
                      ) : m.role === 'assistant' ? (
                        <AnswerText
                          text={m.content}
                          citations={answer?.message_id === m.id ? sources : (m.citations ?? [])}
                        />
                      ) : (
                        <p>{m.content}</p>
                      )}
                      {m.role === 'assistant' &&
                        !['model_unavailable', 'no_evidence', 'embedding_unavailable', 'error'].includes(
                          m.status ?? '',
                        ) && (
                          <div className="turn-actions">
                            <button onClick={() => void navigator.clipboard.writeText(m.content)}>
                              <Copy size={13} /> Copy
                            </button>
                            <button onClick={() => void save(m.id)}>
                              <Bookmark size={13} /> Save
                            </button>
                          </div>
                        )}
                    </article>
                  ))
                : !answer && (
                    <div className="welcome-state">
                      <div className="welcome-spark">
                        <Sparkles size={22} />
                      </div>
                      <h3>What are you researching?</h3>
                      <p>Ask about a legal principle, a clause, or an issue in your documents.</p>
                      <div className="suggestion-row">
                        {[
                          'What does my library say about arbitral tribunal appointment?',
                          'Find documents about seat of arbitration',
                        ].map((q) => (
                          <button key={q} onClick={() => void ask(q)}>
                            {q}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
              {answer && !answerAlreadyInHistory && (
                <article className="turn assistant">
                  <div className="turn-label">
                    TANTARA{' '}
                    <span className={`status-chip ${answer.status}`}>
                      {answer.status === 'ok' ? 'answered' : answer.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  {answer.status === 'model_unavailable' ? (
                    <div className="state-callout unavailable">
                      <strong>Model unavailable</strong>
                      <p>
                        The model is unreachable. Retry, or use evidence-only mode with the documents shown.
                      </p>
                      <button onClick={() => void ask(draft)}>
                        <RefreshCw size={14} /> Retry
                      </button>
                    </div>
                  ) : answerIsInsufficient ? (
                    <div className="state-callout no-evidence model-insufficient">
                      <strong>Evidence is insufficient</strong>
                      <AnswerText text={answer.answer || ''} citations={sources} />
                      <p>
                        Review the retrieved excerpts below; no conclusion was generated from this evidence.
                      </p>
                    </div>
                  ) : answer.status === 'no_evidence' ? (
                    <div className="state-callout no-evidence">
                      <strong>Insufficient evidence in your library</strong>
                      <p>
                        No supporting documents were found for this question. Upload a document, widen the
                        research scope, or rephrase your question.
                      </p>
                      <Link href="/documents">
                        Upload a document <ArrowRight size={13} />
                      </Link>
                    </div>
                  ) : answer.status === 'embedding_unavailable' ? (
                    <div className="state-callout lexical-state">
                      <strong>Embeddings unavailable</strong>
                      <p>
                        Only lexical results were available. Review the retrieved documents below; no grounded
                        answer is available.
                      </p>
                    </div>
                  ) : answer.status === 'error' ? (
                    <div className="state-callout unavailable">
                      <strong>Research request failed</strong>
                      <button onClick={() => void ask(draft)}>
                        <RefreshCw size={14} /> Retry
                      </button>
                    </div>
                  ) : sources.length === 0 || !answer.answer?.trim() ? (
                    <div className="state-callout lexical-state">
                      <strong>No grounded answer text returned</strong>
                      <p>
                        The response had no answer text. Review the retrieved documents below or broaden your
                        search.
                      </p>
                    </div>
                  ) : (
                    <>
                      <AnswerText text={answer.answer || ''} citations={sources} />
                      {answer.disclaimer && (
                        <small className="disclaimer">AI-generated — review before relying on it.</small>
                      )}
                      <div className="turn-actions">
                        <button
                          onClick={() =>
                            answer.message_id
                              ? void navigator.clipboard.writeText(answer.answer ?? '')
                              : undefined
                          }
                        >
                          <Copy size={13} /> Copy
                        </button>
                        <button onClick={() => void save(answer.message_id)}>
                          <Bookmark size={13} />
                          {answer.message_id && savedIds.has(answer.message_id)
                            ? ' Saved'
                            : ' Save to library'}
                        </button>
                        <button onClick={() => void ask(draft)}>
                          <RefreshCw size={13} /> Regenerate
                        </button>
                      </div>
                      {answer.follow_ups?.length ? (
                        <div className="followups">
                          <span>Explore next</span>
                          {answer.follow_ups.map((q) => (
                            <button key={q} onClick={() => void ask(q)}>
                              {q}
                              <ArrowRight size={13} />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
              )}
              {busy && (
                <div className="thinking" role="status">
                  <LoaderCircle size={17} className="spin" />
                  <span>Searching your library and preparing a grounded response…</span>
                  <button onClick={() => abortRef.current?.abort()}>
                    <X size={14} /> Cancel
                  </button>
                </div>
              )}
              {error && (
                <div className="research-error" role="alert">
                  <span>{error}</span>
                  <button onClick={() => void ask(draft)}>
                    <RefreshCw size={13} /> Retry
                  </button>
                </div>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <textarea
                ref={textarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                placeholder="Ask a legal research question…"
                aria-label="Research question"
                rows={2}
              />
              <div className="composer-bottom">
                <span>Enter to send · Shift + Enter for a new line</span>
                <button type="submit" disabled={busy || draft.trim().length < 3}>
                  <ArrowRight size={17} />
                  <span>Ask</span>
                </button>
              </div>
            </form>
          </div>
        </section>
        <aside className="research-right">
          <section className="research-card sources-card">
            <header>
              <div>
                <h2>
                  <FileText size={16} /> Retrieved sources
                </h2>
                <p>
                  {corpusCount} {distinctSourceCount === 1 ? 'document' : 'documents'} ·{' '}
                  {answer && ['ok', 'answered'].includes(answer.status)
                    ? answerIsInsufficient
                      ? 'Retrieved evidence · no conclusion generated'
                      : 'Sources used in this answer'
                    : answer?.status === 'model_unavailable'
                      ? 'Lexical results · documents only'
                      : 'Available evidence'}
                </p>
              </div>
              <span className="source-count">{corpusCount}</span>
            </header>
            {answer?.status === 'no_evidence' && (
              <div className="source-note">No supporting documents found in this workspace.</div>
            )}
            {selectedSources.length ? (
              <div className="source-list">
                {selectedSources.map((source, i) => (
                  <article className="source-item" key={`${source.chunk_id}-${i}`}>
                    <div className="source-top">
                      <span className="source-index">{i + 1}</span>
                      <div>
                        <strong>{source.document_title}</strong>
                        <small>
                          Page {source.page_number} · {source.chunk_id}
                        </small>
                      </div>
                    </div>
                    <p>“{source.excerpt}”</p>
                    <div className="source-bottom">
                      <span>
                        Relevance{' '}
                        <b>
                          {scoreOf(source) == null || !Number.isFinite(scoreOf(source))
                            ? '—'
                            : scoreOf(source)?.toFixed(2)}
                        </b>
                      </span>
                      <a
                        href={documentPageUrl(source.document_id, source.page_number, source.chunk_id)}
                        aria-label={`Open ${source.document_title} at page ${source.page_number}`}
                      >
                        Open excerpt <ArrowDown size={13} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              answer?.status !== 'no_evidence' && (
                <div className="sources-empty">
                  <Search size={21} />
                  <strong>Sources appear here</strong>
                  <span>Ask a question to retrieve relevant documents and excerpts.</span>
                </div>
              )
            )}
            <div className="source-footnote">Citations link to the original document page.</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
