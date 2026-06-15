import "server-only";

import { DOMMatrix, ImageData, createCanvas } from "canvas";
import path from "path";
import { assertNotAborted } from "./guardrails";

type PdfProgress = {
  pageNumber: number;
  pageIndex: number;
  selectedPageCount: number;
  totalPageCount: number;
};

type RenderedSlide = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  imageDataUrl: string;
};

export type PdfPageAnalysis = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  frameTitle?: string;
  sectionTitle?: string;
};

type RenderPdfOptions = {
  maxPages: number;
  scale: number;
  startPage?: number;
  endPage?: number;
  signal?: AbortSignal;
  onPageCount?: (info: { totalPageCount: number; selectedPageCount: number; startPage: number; endPage: number }) => void;
  onProgress?: (progress: PdfProgress) => void;
};

type AnalyzePdfOptions = {
  maxSourcePages: number;
  startPage?: number;
  endPage?: number;
  signal?: AbortSignal;
  onPageCount?: (info: { totalPageCount: number; selectedPageCount: number; startPage: number; endPage: number }) => void;
  onProgress?: (progress: PdfProgress) => void;
};

type RenderSelectedPdfOptions = {
  scale: number;
  pageNumbers: number[];
  pageTextByNumber?: Map<number, string>;
  signal?: AbortSignal;
  onProgress?: (progress: PdfProgress) => void;
};

type CanvasAndContext = {
  canvas: any;
  context: any;
};

class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height)) as any;
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number) {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }

  destroy(canvasAndContext: CanvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

function installCanvasPolyfills() {
  const target = globalThis as any;

  target.DOMMatrix ??= DOMMatrix;
  target.ImageData ??= ImageData;
}

function textFromItems(items: unknown[]) {
  return items
    .map((item) => {
      if (typeof item === "object" && item && "str" in item) {
        return String((item as { str?: unknown }).str ?? "");
      }

      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemText(item: unknown) {
  if (typeof item === "object" && item && "str" in item) {
    return String((item as { str?: unknown }).str ?? "").trim();
  }

  return "";
}

function itemMetric(item: unknown, index: 4 | 5) {
  if (typeof item !== "object" || !item || !("transform" in item)) return 0;
  const transform = (item as { transform?: unknown }).transform;
  if (!Array.isArray(transform)) return 0;
  const value = Number(transform[index]);
  return Number.isFinite(value) ? value : 0;
}

function itemHeight(item: unknown) {
  if (typeof item !== "object" || !item || !("height" in item)) return 0;
  const value = Number((item as { height?: unknown }).height);
  return Number.isFinite(value) ? value : 0;
}

function collectTextLine(items: unknown[], predicate: (item: unknown) => boolean) {
  return items
    .filter((item) => itemText(item) && predicate(item))
    .sort((a, b) => {
      const yDelta = itemMetric(b, 5) - itemMetric(a, 5);
      return Math.abs(yDelta) > 1 ? yDelta : itemMetric(a, 4) - itemMetric(b, 4);
    })
    .map(itemText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPageLayoutText(items: unknown[], width: number, height: number) {
  const frameTitle = collectTextLine(items, (item) => {
    const x = itemMetric(item, 4);
    const y = itemMetric(item, 5);
    const h = itemHeight(item);

    return y > height * 0.82 && y < height * 0.96 && h >= 8 && x < width * 0.95;
  });

  const sectionTitle = collectTextLine(items, (item) => {
    const x = itemMetric(item, 4);
    const y = itemMetric(item, 5);
    const h = itemHeight(item);

    return y >= height * 0.955 && y <= height * 0.995 && h <= 8 && x > width * 0.35 && x < width * 0.95;
  });

  return { frameTitle, sectionTitle };
}

export async function renderPdfSlides(buffer: ArrayBuffer, options: RenderPdfOptions): Promise<RenderedSlide[]> {
  installCanvasPolyfills();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.js",
  );
  const bytes = new Uint8Array(buffer);
  if (options.signal) {
    assertNotAborted(options.signal);
  }

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  } as any);

  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const startPage = Math.max(1, Math.floor(options.startPage || 1));
  const endPage = Math.min(pageCount, Math.floor(options.endPage || pageCount));
  const selectedPageCount = Math.max(0, endPage - startPage + 1);

  if (startPage > pageCount) {
    await document.destroy();
    throw new Error(`这个 PDF 只有 ${pageCount} 页，不能从第 ${startPage} 页开始精讲。`);
  }

  if (endPage < startPage || selectedPageCount < 1) {
    await document.destroy();
    throw new Error("页码范围无效，请确认起始页不大于结束页。");
  }

  options.onPageCount?.({ totalPageCount: pageCount, selectedPageCount, startPage, endPage });

  if (selectedPageCount > options.maxPages) {
    await document.destroy();
    throw new Error(`本次选择 ${selectedPageCount} 页，超过当前限制 ${options.maxPages} 页。请缩小精讲范围。`);
  }

  const canvasFactory = new NodeCanvasFactory();
  const slides: RenderedSlide[] = [];

  try {
    let pageIndex = 0;

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      if (options.signal) {
        assertNotAborted(options.signal);
      }

      pageIndex += 1;
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textFromItems(textContent.items as unknown[]);
      const viewport = page.getViewport({ scale: options.scale });
      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

      await page.render({
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory: canvasFactory as any,
        background: "white",
      } as any).promise;

      if (options.signal) {
        assertNotAborted(options.signal);
      }

      const png = canvasAndContext.canvas.toBuffer("image/png") as Buffer;
      slides.push({
        pageNumber,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        text,
        imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      });

      canvasFactory.destroy(canvasAndContext);
      page.cleanup();
      options.onProgress?.({ pageNumber, pageIndex, selectedPageCount, totalPageCount: pageCount });
    }
  } finally {
    await document.destroy();
  }

  return slides;
}

export async function analyzePdfPages(buffer: ArrayBuffer, options: AnalyzePdfOptions): Promise<PdfPageAnalysis[]> {
  installCanvasPolyfills();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.js",
  );
  const bytes = new Uint8Array(buffer);
  if (options.signal) {
    assertNotAborted(options.signal);
  }

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  } as any);

  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const startPage = Math.max(1, Math.floor(options.startPage || 1));
  const endPage = Math.min(pageCount, Math.floor(options.endPage || pageCount));
  const selectedPageCount = Math.max(0, endPage - startPage + 1);

  if (startPage > pageCount) {
    await document.destroy();
    throw new Error(`这个 PDF 只有 ${pageCount} 页，不能从第 ${startPage} 页开始精讲。`);
  }

  if (endPage < startPage || selectedPageCount < 1) {
    await document.destroy();
    throw new Error("页码范围无效，请确认起始页不大于结束页。");
  }

  options.onPageCount?.({ totalPageCount: pageCount, selectedPageCount, startPage, endPage });

  if (selectedPageCount > options.maxSourcePages) {
    await document.destroy();
    throw new Error(
      `本次选择 ${selectedPageCount} 个原始页面，超过当前源文件扫描限制 ${options.maxSourcePages} 页。请先缩小精讲范围。`,
    );
  }

  const pages: PdfPageAnalysis[] = [];

  try {
    let pageIndex = 0;

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      if (options.signal) {
        assertNotAborted(options.signal);
      }

      pageIndex += 1;
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textFromItems(textContent.items as unknown[]);
      const viewport = page.getViewport({ scale: 1 });
      const layout = extractPageLayoutText(textContent.items as unknown[], viewport.width, viewport.height);

      pages.push({
        pageNumber,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        text,
        frameTitle: layout.frameTitle || undefined,
        sectionTitle: layout.sectionTitle || undefined,
      });

      page.cleanup();
      options.onProgress?.({ pageNumber, pageIndex, selectedPageCount, totalPageCount: pageCount });
    }
  } finally {
    await document.destroy();
  }

  return pages;
}

export async function renderSelectedPdfSlides(
  buffer: ArrayBuffer,
  options: RenderSelectedPdfOptions,
): Promise<RenderedSlide[]> {
  installCanvasPolyfills();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.js",
  );
  const bytes = new Uint8Array(buffer);
  if (options.signal) {
    assertNotAborted(options.signal);
  }

  const pageNumbers = Array.from(new Set(options.pageNumbers)).sort((a, b) => a - b);
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  } as any);

  const document = await loadingTask.promise;
  const selectedPageCount = pageNumbers.length;
  const canvasFactory = new NodeCanvasFactory();
  const slides: RenderedSlide[] = [];

  try {
    let pageIndex = 0;

    for (const pageNumber of pageNumbers) {
      if (options.signal) {
        assertNotAborted(options.signal);
      }

      if (pageNumber < 1 || pageNumber > document.numPages) {
        throw new Error(`第 ${pageNumber} 页不存在，无法渲染。`);
      }

      pageIndex += 1;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: options.scale });
      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

      await page.render({
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory: canvasFactory as any,
        background: "white",
      } as any).promise;

      if (options.signal) {
        assertNotAborted(options.signal);
      }

      const png = canvasAndContext.canvas.toBuffer("image/png") as Buffer;
      slides.push({
        pageNumber,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        text: options.pageTextByNumber?.get(pageNumber) || "",
        imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      });

      canvasFactory.destroy(canvasAndContext);
      page.cleanup();
      options.onProgress?.({ pageNumber, pageIndex, selectedPageCount, totalPageCount: document.numPages });
    }
  } finally {
    await document.destroy();
  }

  return slides;
}
