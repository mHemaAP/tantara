import { api } from '@/lib/api/client';

export type StrategyCitation = {
  document_id: string;
  document_title: string;
  chunk_id: string;
  page_number: number;
  snippet?: string;
};
export type StrategyArgument = { statement: string; support: StrategyCitation[] };
export type AssertionCitation = { field: string; index: number; citations: StrategyCitation[] };
export type StrategyData = {
  case_theory: string;
  key_issues: string[];
  legal_arguments: StrategyArgument[];
  counterarguments: string[];
  evidence_gaps: string[];
  strategy_plan: string;
  updated_at: string | null;
  generated_at?: string;
  status: 'template' | 'model_generated' | 'model_unavailable' | 'no_evidence' | string;
  model: { provider: string; model: string } | null;
  citations: StrategyCitation[];
  assertion_citations: AssertionCitation[];
  manually_edited: boolean;
  generation_note: string;
  generation_kind?: 'model_strategy' | 'source_excerpt_review';
};
export type StrategyWrite = Pick<
  StrategyData,
  'case_theory' | 'key_issues' | 'legal_arguments' | 'counterarguments' | 'evidence_gaps' | 'strategy_plan'
>;
export type StrategyCase = { id: string; title: string; forum?: string; seat?: string; claimant?: string; respondent?: string; reference_number?: string };
export const strategyTabs = ['Case Theory', 'Key Issues', 'Legal Arguments', 'Anticipated Counterarguments', 'Evidence Gaps', 'Strategy Plan'] as const;
export type StrategyTab = (typeof strategyTabs)[number];
export const strategyApi = {
  cases: () => api.get<{ items: StrategyCase[] }>('/cases?page_size=100'),
  case: (id: string) => api.get<StrategyCase>(`/cases/${encodeURIComponent(id)}/overview`),
  get: (id: string) => api.get<StrategyData>(`/cases/${encodeURIComponent(id)}/strategy`),
  generate: (id: string) => api.post<StrategyData>(`/cases/${encodeURIComponent(id)}/strategy/generate`),
  save: (id: string, body: StrategyWrite) => api.put<StrategyData>(`/cases/${encodeURIComponent(id)}/strategy`, body),
  aiSettings: () => api.get<{ runtime_status?: { reachable?: boolean; checked_at?: string } }>('/settings/ai'),
  createTask: (body: { title: string; case_id: string; notes: string }) => api.post<unknown>('/tasks', body),
  tasks: (caseId: string) => api.get<{ items: Array<{ id: string; title: string; case_id?: string }> }>(`/tasks?case_id=${encodeURIComponent(caseId)}&page_size=100`),
};
