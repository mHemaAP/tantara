'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';
import { authToken } from '@/lib/api/client';
import './viewer.css';

type PdfPageEntry = { pageNumber: number; width: number; height: number };
type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

function scrollPageInsideViewer(container: HTMLDivElement, page: HTMLElement) {
  const containerBounds = container.getBoundingClientRect();
  const pageBounds = page.getBoundingClientRect();
  container.scrollTo({
    top: container.scrollTop + pageBounds.top - containerBounds.top,
    behavior: 'smooth',
  });
}

export function PdfDocumentViewer({
  documentId,
  firstPageOnly = false,
}: {
  documentId: string;
  firstPageOnly?: boolean;
}) {
  const searchParams = useSearchParams();
  const requestedPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pages, setPages] = useState<PdfPageEntry[]>([]);
  const [pageNumber, setPageNumber] = useState(requestedPage);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    const loadPdf = async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8010').replace(/\/$/, '');
        loadingTask = pdfjs.getDocument({
          url: `${base}/api/v1/documents/${documentId}/file`,
          httpHeaders: authToken() ? { Authorization: `Bearer ${authToken()}` } : undefined,
          rangeChunkSize: 65536,
          disableAutoFetch: false,
        });
        const loaded = await loadingTask.promise;
        if (!active) return;
        setPdf(loaded);
        const dimensions: PdfPageEntry[] = [];
        for (let page = 1; page <= loaded.numPages; page += 1) {
          const pageProxy = await loaded.getPage(page);
          const viewport = pageProxy.getViewport({ scale: 1 });
          dimensions.push({ pageNumber: page, width: viewport.width, height: viewport.height });
        }
        if (active) {
          setPages(dimensions);
          setLoading(false);
          setPageNumber(Math.min(requestedPage, loaded.numPages));
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'PDF preview is unavailable.');
          setLoading(false);
        }
      }
    };
    void loadPdf();
    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [documentId, requestedPage]);

  const goToPage = useCallback(
    (target: number) => {
      const bounded = Math.min(Math.max(target, 1), pages.length || 1);
      setPageNumber(bounded);
      const page = pageRefs.current.get(bounded);
      const container = containerRef.current;
      if (page && container) scrollPageInsideViewer(container, page);
    },
    [pages.length],
  );

  useEffect(() => {
    if (!pdf || pages.length === 0) return;
    const target = pageRefs.current.get(requestedPage);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (container) scrollPageInsideViewer(container, target);
    });
    return () => cancelAnimationFrame(frame);
  }, [pdf, pages, requestedPage]);

  useEffect(() => {
    if (!pdf || !pages.length) return;
    let cancelled = false;
    const render = async () => {
      const pdfjs = await import('pdfjs-dist');
      await Promise.all(
        pages.map(async ({ pageNumber: currentPage }) => {
          const canvas = containerRef.current?.querySelector<HTMLCanvasElement>(
            `canvas[data-page="${currentPage}"]`,
          );
          const textContainer = containerRef.current?.querySelector<HTMLDivElement>(
            `[data-text-page="${currentPage}"]`,
          );
          if (!canvas || !textContainer) return;
          const pageProxy = await pdf.getPage(currentPage);
          const viewport = pageProxy.getViewport({ scale });
          const pixelRatio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          textContainer.style.width = `${viewport.width}px`;
          textContainer.style.height = `${viewport.height}px`;
          textContainer.replaceChildren();
          const context = canvas.getContext('2d');
          if (!context) return;
          const renderTask = pageProxy.render({
            canvasContext: context,
            viewport,
            transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined,
          });
          await renderTask.promise;
          if (cancelled) return;
          const textContent = await pageProxy.getTextContent();
          const textLayer = new pdfjs.TextLayer({
            textContentSource: textContent,
            container: textContainer,
            viewport,
          });
          await textLayer.render();
        }),
      );
    };
    void render().catch((renderError) => {
      if (!cancelled)
        setError(renderError instanceof Error ? renderError.message : 'Could not render this PDF page.');
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pages, scale]);

  useEffect(() => {
    if (!pages.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const visiblePage = Number(visible?.target.getAttribute('data-page-card'));
        if (visiblePage) setPageNumber(visiblePage);
      },
      { root: containerRef.current, threshold: [0.25, 0.5, 0.75] },
    );
    pageRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pages]);

  if (loading)
    return (
      <div className="pdf-loading" role="status">
        Loading PDF pages…
      </div>
    );
  if (error)
    return (
      <div className="pdf-error" role="status">
        PDF preview unavailable: {error}
      </div>
    );

  const visiblePages = firstPageOnly ? pages.slice(0, 1) : pages;
  return (
    <section
      className={`pdf-viewer ${firstPageOnly ? 'pdf-viewer-preview' : ''}`}
      aria-label={firstPageOnly ? 'First page document preview' : 'PDF document viewer'}
    >
      {!firstPageOnly && (
        <div className="pdf-toolbar">
          <div className="pdf-page-controls">
            <button
              aria-label="Previous page"
              disabled={pageNumber <= 1}
              onClick={() => goToPage(pageNumber - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <label>
              Page{' '}
              <input
                aria-label="Jump to page"
                type="number"
                min="1"
                max={pdf?.numPages || 1}
                value={pageNumber}
                onChange={(event) => goToPage(Number(event.target.value))}
              />{' '}
              of {pdf?.numPages ?? '—'}
            </label>
            <button
              aria-label="Next page"
              disabled={pageNumber >= (pdf?.numPages || 1)}
              onClick={() => goToPage(pageNumber + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="pdf-zoom-controls">
            <button aria-label="Zoom out" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}>
              <Minus size={16} />
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}>
              <Plus size={16} />
            </button>
            <button aria-label="Fit width" onClick={() => setScale(1)}>
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
      )}
      <div className="pdf-pages-scroll" ref={containerRef}>
        {visiblePages.map((page) => (
          <article
            className={`pdf-page-card ${page.pageNumber === requestedPage ? 'pdf-page-deep-link' : ''}`}
            data-page-card={page.pageNumber}
            id={`pdf-page-${page.pageNumber}`}
            key={page.pageNumber}
            ref={(element) => {
              if (element) pageRefs.current.set(page.pageNumber, element);
              else pageRefs.current.delete(page.pageNumber);
            }}
          >
            <div className="pdf-page-label">Page {page.pageNumber}</div>
            <div className="pdf-page-surface">
              <canvas data-page={page.pageNumber} aria-label={`PDF page ${page.pageNumber}`} />
              <div className="pdf-text-layer" data-text-page={page.pageNumber} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
