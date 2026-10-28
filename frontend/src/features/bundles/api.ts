import { api, apiBase, authToken } from '@/lib/api/client';

export type BundleItem = { id?: string; document_id: string; title?: string; document_title?: string; section?: string; page_start?: number; page_end?: number; start_page?: number; end_page?: number; needs_review?: boolean; review_reason?: string };
export type Bundle = { id: string; title?: string; status?: string; job_status?: string; progress?: number; page_count?: number; byte_size?: number; items?: BundleItem[]; error?: string };
export const bundleApi = {
  cases: () => api.get<{ items: Array<{ id: string; title: string; reference_number?: string }> }>('/cases?page_size=100'),
  documents: (caseId: string) => api.get<{ items: Array<{ id: string; title: string; pages?: number; page_count?: number; status?: string }> }>(`/documents?case_id=${encodeURIComponent(caseId)}&page_size=100`),
  list: () => api.get<{ items: Bundle[] }>('/bundles?page_size=100'),
  get: (id: string) => api.get<Bundle>(`/bundles/${id}`),
  items: (id: string) => api.get<{ items: BundleItem[] } | BundleItem[]>(`/bundles/${id}/items`),
  create: (body: unknown) => api.post<Bundle>('/bundles', body),
  updateItems: (id: string, body: unknown) => api.put<unknown>(`/bundles/${id}/items`, body),
  updateSections: (id: string, body: unknown) => api.put<unknown>(`/bundles/${id}/sections`, body),
  generate: (id: string) => api.post<unknown>(`/bundles/${id}/generate`),
  fileUrl: (id: string, preview = false) => `${apiBase}/bundles/${id}/${preview ? 'preview' : 'download'}`,
  headers: (): HeadersInit => authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
};
