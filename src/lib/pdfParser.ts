import * as pdfjsLib from 'pdfjs-dist';
import type { RawPageText } from '../model/vectorMath';

// Configure PDF.js worker using Vite ESM asset resolution
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function extractPagesFromFile(file: File): Promise<RawPageText[]> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdfPages(file);
  }

  const rawText = await file.text();
  return paginatePlainText(rawText);
}

async function extractPdfPages(file: File): Promise<RawPageText[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
  });
  const pdf = await loadingTask.promise;
  const pages: RawPageText[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    let pageLines = '';
    let lastY: number | null = null;

    for (const item of textContent.items) {
      if ('str' in item && typeof item.str === 'string') {
        const currentY = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
        if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 6) {
          pageLines += '\n';
        } else if (pageLines.length > 0 && !pageLines.endsWith(' ') && !pageLines.endsWith('\n')) {
          pageLines += ' ';
        }
        pageLines += item.str;
        if (currentY !== null) lastY = currentY;
      }
    }

    const cleaned = pageLines.replace(/[ \t]+/g, ' ').trim();
    if (cleaned.length > 0) {
      pages.push({ pageNumber: pageNum, text: cleaned });
    }
  }

  if (pages.length === 0) {
    throw new Error(
      'No selectable text could be extracted from this PDF. Please upload a text-based PDF or paste lecture notes directly.'
    );
  }

  return pages;
}

export function paginatePlainText(rawText: string, charsPerPage = 1900): RawPageText[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new Error('The uploaded note contains no readable text.');
  }

  const paragraphs = normalized.split(/\n{2,}/);
  const pages: RawPageText[] = [];
  let buffer = '';
  let pageNum = 1;

  for (const para of paragraphs) {
    if ((buffer + '\n\n' + para).trim().length <= charsPerPage || buffer.length === 0) {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    } else {
      pages.push({ pageNumber: pageNum++, text: buffer.trim() });
      buffer = para;
    }
  }

  if (buffer.trim()) {
    pages.push({ pageNumber: pageNum, text: buffer.trim() });
  }

  return pages;
}
