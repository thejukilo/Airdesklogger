import type { CapzlogTextItem } from "../api";

/**
 * Extract positioned text items from a PDF file in the browser with pdf.js
 * (lazy-loaded so it never weighs down the main bundle). x/y are PDF points
 * (y increases upward), with an explicit 1-based page so the server can tell
 * which report section each page belongs to in a combined export.
 */
export async function extractPdfTextItems(
  file: File,
  onProgress?: (page: number, totalPages: number) => void,
): Promise<CapzlogTextItem[]> {
  const pdfjs = await import("pdfjs-dist");
  // Vite rewrites this to a hashed worker URL at build time.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const items: CapzlogTextItem[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!("str" in it)) continue; // skip marked-content items
        const str = it.str;
        if (!str || !str.trim()) continue;
        items.push({ str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
      }
    }
  } finally {
    await pdf.destroy();
  }
  return items;
}
