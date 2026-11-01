"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

const failureMessage = "Không thể tải tài liệu. Vui lòng mở file hoặc tải xuống.";

export default function PdfViewer({ url, title }: { url: string; title: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [retry, setRetry] = useState(0);
  const [pageText, setPageText] = useState("");
  const [rendered, setRendered] = useState<{ page: number; zoom: number; width: number } | null>(null);
  const ready = Boolean(pdf && rendered?.page === pageNumber && rendered.zoom === zoom && rendered.width === width);
  const renderedPage = ready ? pageNumber : 0;
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        // Safari and older WebViews need the translated/polyfilled build.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (cancelled) return;
        setPdf(null); setError(""); setProgress(0); setPageNumber(1); setRendered(null);
        const assets = `/pdfjs/${pdfjs.version}/`;
        pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.legacy.min.mjs`;
        const source = new URL(url, window.location.href);
        if (source.origin === window.location.origin && source.pathname.startsWith("/uploads/")) source.searchParams.set("inline", "1");
        loading = pdfjs.getDocument({ url: source.href, cMapUrl: `${assets}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
          rangeChunkSize: 256 * 1024, disableAutoFetch: true, disableStream: true });
        loading.onProgress = ({ loaded, total }: { loaded: number; total: number }) => { if (!cancelled && total > 0) setProgress(Math.min(100, Math.round(loaded / total * 100))); };
        const document = await loading.promise;
        if (!cancelled) setPdf(document);
      } catch (cause) {
        if (!cancelled) { console.error("PDF_LOAD_FAILED", { name: cause instanceof Error ? cause.name : "Unknown" }); setError(failureMessage); }
      }
    })();
    return () => { cancelled = true; void loading?.destroy().catch(() => undefined); };
  }, [url, retry]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !width || !stage.current) return;
    let cancelled = false;
    let rendering: RenderTask | undefined;
    const container = stage.current;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        setPageText(""); setError("");
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(width, 1100) / base.width * zoom });
        // Bound backing-store memory, including high-DPR mobile devices at zoom.
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6_000_000 / (viewport.width * viewport.height)));
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${title} — trang ${pageNumber}`);
        rendering = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await rendering.promise;
        if (cancelled) return;
        // Separate canvas per render prevents cancelled tasks sharing a canvas.
        for (const previous of container.querySelectorAll("canvas")) { previous.width = 0; previous.height = 0; }
        container.replaceChildren(canvas);
        setRendered({ page: pageNumber, zoom, width });
        try {
          const text = await page.getTextContent();
          if (!cancelled) setPageText(text.items.map(item => "str" in item ? item.str : "").join(" "));
        } catch { /* Text extraction must not hide an already painted page. */ }
        page.cleanup();
      } catch (cause) {
        if (!cancelled) { console.error("PDF_RENDER_FAILED", { name: cause instanceof Error ? cause.name : "Unknown" }); setError(failureMessage); }
      }
    })();
    return () => { cancelled = true; rendering?.cancel(); };
  }, [pdf, pageNumber, width, zoom, title]);

  const withoutFragment = url.split("#")[0];
  const download = `${withoutFragment}${withoutFragment.includes("?") ? "&" : "?"}download=1`;
  return <div className="pdf-viewer">
    <div className="pdf-toolbar" aria-label="Điều khiển PDF">
      <button disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber(page => page - 1)}>Trang trước</button>
      <span role="status">{pdf ? `Trang ${pageNumber}/${pdf.numPages}` : `Đang tải PDF${progress ? ` ${progress}%` : "..."}`}</span>
      <button disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => setPageNumber(page => page + 1)}>Trang tiếp</button>
      <button aria-label="Thu nhỏ PDF" disabled={!pdf || zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</button>
      <output aria-label="Mức thu phóng">{Math.round(zoom * 100)}%</output>
      <button aria-label="Phóng to PDF" disabled={!pdf || zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}>+</button>
      <button disabled={!pdf} onClick={() => setZoom(1)}>Vừa chiều rộng</button>
    </div>
    {error && <div className="pdf-error" role="alert"><p>{error}</p><button onClick={() => { setError(""); setPdf(null); setRendered(null); setRetry(value => value + 1); }}>Thử lại PDF</button></div>}
    <div className="pdf-canvas-host" ref={host} aria-busy={!error && (!pdf || renderedPage !== pageNumber)} data-rendered-page={renderedPage}>
      {!error && pdf && renderedPage !== pageNumber && <p className="pdf-render-status" role="status">Đang hiển thị trang {pageNumber}...</p>}
      <div className="pdf-page-stage" ref={stage} />
      <p className="pdf-page-text">{pageText}</p>
    </div>
    <div className="pdf-file-actions">
      <a className="media-download" href={url} target="_blank" rel="noopener noreferrer">Mở file trong tab mới</a>
      <a className="media-download" href={download} download>Tải xuống</a>
    </div>
  </div>;
}
