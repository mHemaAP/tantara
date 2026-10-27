'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { RefreshCw, Users, FileText, CalendarDays, CheckCircle2 } from 'lucide-react';
type Overview = {
  id: string;
  title: string;
  reference_number?: string;
  status?: string;
  forum?: string;
  seat?: string;
  governing_law?: string;
  claimant?: string;
  respondent?: string;
  participants?: Array<{ id: string; name: string; role: string }>;
  documents_count?: number;
  drafts_count?: number;
  tasks?: Array<{ id: string; title: string; status: string; due_at?: string }>;
  hearings?: Array<{ id: string; title: string; at: string }>;
  description?: string;
};
export default function CaseOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['cases', 'overview', id],
    queryFn: () => api.get<Overview>(`/cases/${id}/overview`),
  });
  if (q.isLoading)
    return (
      <div className="card surface" role="status">
        Loading case overview…
      </div>
    );
  if (q.isError)
    return (
      <div className="offline">
        <strong>Case overview unavailable</strong>
        <p>Confirm the API is running at 127.0.0.1:8010.</p>
        <button className="primary" onClick={() => void q.refetch()}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  const c = q.data;
  if (!c) return <div className="offline">Case details were not returned.</div>;
  return (
    <div>
      <div style={{ marginBottom: 17 }}>
        <small className="muted">My Cases / Overview</small>
        <h1 className="title" style={{ marginTop: 8 }}>
          {c.title}
        </h1>
        <p className="subheading">
          {c.reference_number || 'Case reference not set'} ·{' '}
          <span className="pill">{c.status || 'Status unavailable'}</span>
        </p>
      </div>
      <div className="grid metric-grid" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <div className="card metric">
          <div className="metric-icon">
            <FileText size={17} />
          </div>
          <strong>{c.documents_count ?? 0}</strong>
          <span>Documents</span>
        </div>
        <div className="card metric">
          <div className="metric-icon">
            <FileText size={17} />
          </div>
          <strong>{c.drafts_count ?? 0}</strong>
          <span>Drafts</span>
        </div>
        <div className="card metric">
          <div className="metric-icon">
            <CheckCircle2 size={17} />
          </div>
          <strong>{c.tasks?.length ?? 0}</strong>
          <span>Tasks</span>
        </div>
      </div>
      <div className="grid dashboard-columns" style={{ marginTop: 16 }}>
        <section className="card surface">
          <h2 className="section-title">
            <Users size={16} /> Case details
          </h2>
          <dl className="data-list">
            {[
              ['Claimant', c.claimant],
              ['Respondent', c.respondent],
              ['Institution', c.forum],
              ['Seat', c.seat],
              ['Governing law', c.governing_law],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {c.description && <p>{c.description}</p>}
        </section>
        <section className="card surface">
          <h2 className="section-title">
            <Users size={16} /> Participants
          </h2>
          {c.participants?.length ? (
            c.participants.map((p) => (
              <div className="activity-row" key={p.id}>
                <span>
                  {p.name}
                  <small style={{ display: 'block' }} className="muted">
                    {p.role}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <div className="empty">No case participants recorded.</div>
          )}
        </section>
        <section className="card surface">
          <h2 className="section-title">
            <CalendarDays size={16} /> Hearings
          </h2>
          {c.hearings?.length ? (
            c.hearings.map((h) => (
              <div className="activity-row" key={h.id}>
                {h.title}
                <small className="muted">{new Date(h.at).toLocaleString('en-IN')}</small>
              </div>
            ))
          ) : (
            <div className="empty">No hearings scheduled.</div>
          )}
        </section>
        <section className="card surface">
          <h2 className="section-title">
            <CheckCircle2 size={16} /> Tasks
          </h2>
          {c.tasks?.length ? (
            c.tasks.map((t) => (
              <div className="activity-row" key={t.id}>
                {t.title}
                <span className="pill">{t.status}</span>
              </div>
            ))
          ) : (
            <div className="empty">No tasks recorded.</div>
          )}
        </section>
      </div>
    </div>
  );
}
