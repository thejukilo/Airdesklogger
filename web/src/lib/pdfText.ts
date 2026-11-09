import type { CapzlogTextItem } from "../api";

/**
 * Extract positioned text items from a PDF file in the browser with pdf.js
 * (lazy-loaded so it never weighs down the main bundle). x/y are PDF points;
 * y is offset per page so that rows on different pages can never collide when
 * the server groups words into table rows.
 */
export async function extractPdfTextItems(file: File): Promise<CapzlogTextItem[]> {
  const pdfjs = await import("pdfjs-dist");
  // Vite rewrites this to a hashed worker URL at build time.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const items: CapzlogTextItem[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const yOffset = p * 100000; // separate pages so their rows never merge
      for (const it of content.items) {
        if (!("str" in it)) continue; // skip marked-content items
        const str = it.str;
        if (!str || !str.trim()) continue;
        items.push({ str, x: it.transform[4], y: it.transform[5] + yOffset, w: it.width });
      }
    }
  } finally {
    await pdf.destroy();
  }
  return items;
}
