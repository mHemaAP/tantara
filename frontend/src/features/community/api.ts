import { api } from '@/lib/api/client';

export type CommunityPost = {
  id: string;
  title: string;
  body: string;
  tags?: string[];
  author?: { id?: string; name?: string; email?: string };
  author_id?: string;
  author_name?: string;
  case_id?: string | null;
  case_title?: string | null;
  created_at?: string;
  saved?: boolean;
  is_saved?: boolean;
};
export type CommunityReply = {
  id: string;
  body: string;
  author?: { id?: string; name?: string };
  author_id?: string;
  author_name?: string;
  created_at?: string;
};
export type Page<T> = { items: T[]; total: number; page: number; page_size: number; pages: number };
export type CaseItem = { id: string; title: string };
export type Identity = { id?: string; name?: string; email?: string };

export const communityApi = {
  list: (page: number, q: string, tag: string) => {
    const params = new URLSearchParams({ page: String(page), page_size: '10', sort: 'newest' });
    if (q.trim()) params.set('q', q.trim());
    if (tag) params.set('tag', tag);
    return api.get<Page<CommunityPost> & { tags?: string[] }>(`/community/posts?${params}`);
  },
  post: (id: string) => api.get<CommunityPost>(`/community/posts/${id}`),
  replies: (id: string) =>
    api.get<CommunityReply[] | { items: CommunityReply[] }>(`/community/posts/${id}/replies`),
  create: (input: { title: string; body: string; tags: string[]; case_id?: string }) =>
    api.post<CommunityPost>('/community/posts', input),
  reply: (id: string, body: string) => api.post<CommunityReply>(`/community/posts/${id}/replies`, { body }),
  save: (id: string) => api.post(`/community/posts/${id}/save`),
  remove: (id: string) => api.del(`/community/posts/${id}`),
  cases: () => api.get<Page<CaseItem>>('/cases?page_size=100'),
  me: () => api.get<Identity>('/auth/me'),
};

export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The request could not be completed.';
}
