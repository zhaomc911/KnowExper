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

type RenderPdfOptions = {
  maxPages: number;
  scale: number;
  startPage?: number;
  endPage?: number;
  signal?: AbortSignal;
  onPageCount?: (info: { totalPageCount: number; selectedPageCount: number; startPage: number; endPage: number }) => void;
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
