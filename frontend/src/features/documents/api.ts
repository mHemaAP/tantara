import { api, apiBase, authToken } from '@/lib/api/client';

export type DocumentRecord = {
  id: string;
  title: string;
  filename: string;
  document_type?: string;
  status: string;
  jurisdiction?: string;
  case_id?: string;
  pages?: number;
  chars?: number;
  size_bytes?: number;
  content_hash?: string;
  created_at?: string;
  processed_at?: string;
  source?: string;
  is_demo?: boolean;
  page_count?: number;
  case_title?: string;
};

export type IngestionJob = {
  status: string;
  progress: number;
  steps: string[];
  warnings: string[];
  pages?: number;
  chars?: number;
  error?: string;
};
export type ExtractionRecord = Record<
  string,
  { value: unknown; provenance?: string; source?: string; review_required?: boolean }
>;

export const documentsApi = {
  list: (params = '') =>
    api.get<{ items: DocumentRecord[]; total: number; pages: number }>(`/documents${params}`),
  get: (id: string) => api.get<DocumentRecord>(`/documents/${id}`),
  job: (id: string) => api.get<IngestionJob>(`/documents/${id}/job`),
  remove: (id: string) => api.del(`/documents/${id}`),
  patch: (id: string, body: Partial<DocumentRecord>) => api.patch<DocumentRecord>(`/documents/${id}`, body),
  retry: (id: string) => api.post(`/documents/${id}/retry`),
  aiRead: (id: string) => api.post<{ status: string; fields: ExtractionRecord }>(`/documents/${id}/ai-read`),
  aiStatus: () =>
    api.get<{
      base_url?: string;
      model?: string;
      runtime_status?: { model?: string; reachable?: boolean };
    }>('/settings/ai'),
  askForReadiness: (question: string, caseId?: string) =>
    api.post<{ status: string; answer?: string }>('/ai/ask', { question, top_k: 5, case_id: caseId }),
  upload(file: File, onProgress: (value: number) => void): Promise<{ document_id: string; status: string }> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${apiBase}/documents/upload`);
      const token = authToken();
      if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onload = () => {
        const body = (() => {
          try {
            return JSON.parse(request.responseText);
          } catch {
            return {};
          }
        })();
        if (request.status >= 200 && request.status < 300) resolve(body);
        else {
          const detail = body.detail;
          const message = Array.isArray(detail)
            ? detail.map((entry: { msg?: string }) => entry.msg ?? 'Invalid upload').join('; ')
            : typeof detail === 'object'
              ? (detail.message ?? JSON.stringify(detail))
              : (detail ?? 'Upload failed');
          reject(Object.assign(new Error(String(message)), { status: request.status, body }));
        }
      };
      request.onerror = () => reject(new Error('Upload failed. Check your connection and retry.'));
      const data = new FormData();
      data.append('file', file);
      data.append('title', file.name);
      request.send(data);
    });
  },
};
