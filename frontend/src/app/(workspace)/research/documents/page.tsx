'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { api } from '@/lib/api/client';
import { documentPageUrl } from '@/features/research/document-url';
import '../research.css';

type Doc = { id: string; title?: string; filename?: string; status?: string; page_count?: number };
export default function ResearchDocuments() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    api
      .get<{ items: Doc[] }>('/documents?page_size=100')
      .then((x) => setDocuments(x.items ?? []))
      .catch(() => setUnavailable(true));
  }, []);
  return (
    <main className="research-docs">
      <Link href="/research" className="research-back">
        <ArrowLeft size={15} /> Back to Research Desk
      </Link>
      <h1>Research library</h1>
      <p>Documents available for grounded research.</p>
      <section className="research-docs-card">
        <h2>
          <FileText size={17} /> Workspace documents
        </h2>
        {unavailable ? (
          <p role="status">The document library is currently unavailable.</p>
        ) : documents.length ? (
          <div className="research-docs-list">
            {documents.map((doc) => (
              <Link key={doc.id} href={documentPageUrl(doc.id, 1)}>
                <strong>{doc.title ?? doc.filename ?? 'Untitled document'}</strong>
                <span>
                  {' '}
                  · {doc.status ?? '—'} · {doc.page_count ?? '—'} pages
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p>
            No documents are available yet. Add a document from the Documents workspace to use it as research
            evidence.
          </p>
        )}
      </section>
    </main>
  );
}
