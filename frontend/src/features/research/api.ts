import { api } from '@/lib/api/client';

export type ResearchSource = {
  citation_ref?: string;
  document_id: string;
  document_title: string;
  chunk_id: string;
  page_number: number;
  excerpt: string;
  retrieval_score?: number;
  retreival_score?: number;
};

export type ResearchAnswer = {
  status: 'ok' | 'answered' | 'no_evidence' | 'model_unavailable' | 'embedding_unavailable' | 'error';
  answer?: string;
  citations?: ResearchSource[];
  sources?: ResearchSource[];
  follow_ups?: string[];
  disclaimer?: string;
  research_session_id?: string;
  message_id?: string;
  meta?: Record<string, unknown>;
};

export type ResearchSession = {
  id: string;
  title: string;
  case_id?: string;
  collection_id?: string;
  jurisdiction?: string;
  updated_at?: string;
  created_at?: string;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: string;
    citations?: ResearchSource[];
  }>;
};

export const researchApi = {
  sessions: () => api.get<{ items: ResearchSession[] }>('/ai/sessions?page_size=100'),
  session: (id: string) => api.get<ResearchSession>(`/ai/sessions/${encodeURIComponent(id)}`),
  createSession: (title: string) => api.post<ResearchSession>('/ai/sessions', { title }),
  saved: () =>
    api.get<{ items: Array<{ id: string; item_id: string; item_type: string }> }>('/ai/saved?page_size=100'),
  cases: () => api.get<{ items: Array<{ id: string; title: string }> }>('/cases?page_size=100'),
  collections: () =>
    api.get<{ items?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(
      '/meta/collections',
    ),
  jurisdictions: () =>
    api.get<
      | { items?: Array<{ id?: string; name?: string } | string> }
      | Array<{ id?: string; name?: string } | string>
    >('/meta/jurisdictions'),
  ask: (
    body: {
      question: string;
      session_id?: string;
      case_id?: string;
      collection_id?: string;
      jurisdiction?: string;
    },
    signal: AbortSignal,
  ) => api.post<ResearchAnswer>('/ai/ask', body, signal),
  aiStatus: () => api.get<Record<string, unknown>>('/ai/status'),
  lexical: (question: string, signal: AbortSignal) =>
    api.get<{
      items?: Array<{
        document_id: string;
        document_title: string;
        chunk_id: string;
        page_number: number;
        snippet: string;
        score: number;
      }>;
    }>(`/search/documents?query=${encodeURIComponent(question)}&page_size=8`, signal),
  save: (id: string) => api.post('/ai/saved', { item_type: 'message', item_id: id }),
};
