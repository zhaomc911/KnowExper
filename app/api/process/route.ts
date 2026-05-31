import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { generateSlideExplanation, getAiConfigStatus } from "@/lib/ai";
import { detectDocumentKind, documentKindLabels } from "@/lib/document-kind";
import { createStoredDocument, documentUrl, getStoredDocument, hashPdfBytes } from "@/lib/documents";
import {
  assertNotAborted,
  checkRateLimit,
  createTimeoutController,
  publicErrorMessage,
  tryAcquireJobSlot,
} from "@/lib/guardrails";
import { getHardeningConfig, getProcessingLimits } from "@/lib/limits";
import { renderPdfSlides } from "@/lib/pdf";
import { convertPptxToPdf } from "@/lib/pptx";
import type { ProcessEvent, SlideResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonLine(event: ProcessEvent) {
  return `${JSON.stringify(event)}\n`;
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: ProcessEvent) {
  controller.enqueue(new TextEncoder().encode(jsonLine(event)));
}

function errorStream(message: string, status = 400) {
  return new Response(jsonLine({ type: "error", message }), {
    status,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isPptx(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    file.name.toLowerCase().endsWith(".pptx")
  );
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "KnowExper";
}

function pageNumberFromForm(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;

  const number = Number(text);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("页码范围必须是大于 0 的整数。");
  }

  return number;
}

export async function POST(request: Request) {
  const limits = getProcessingLimits();
  const hardening = getHardeningConfig();
  const rateLimit = checkRateLimit(
    request,
    "process",
    hardening.processRateLimit,
    hardening.rateLimitWindowMs,
  );

  if (!rateLimit.allowed) {
    return errorStream(`请求太频繁了，请 ${rateLimit.retryAfterSeconds} 秒后再试。`, 429);
  }

  if (isBetaAccessRequired() && !hasBetaAccess(request)) {
    return errorStream("测试访问码不正确，请确认后再上传。", 401);
  }

  const releaseJobSlot = tryAcquireJobSlot(hardening.maxConcurrentJobs);
  if (!releaseJobSlot) {
    return errorStream("当前处理人数较多，请稍后再上传。", 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > limits.maxUploadBytes + 1024 * 1024) {
    releaseJobSlot();
    return errorStream(`请求体超过限制：当前文件上限为 ${limits.maxUploadMb} MB。`, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    releaseJobSlot();
    return errorStream("无法读取上传文件，请重新上传。", 400);
  }

  const file = formData.get("file");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const jobTimeout = createTimeoutController(
        hardening.totalJobTimeoutMs,
        "处理时间过长，任务已停止。请减少页数或稍后重试。",
      );

      try {
        if (!(file instanceof File)) {
          throw new Error("请上传一个 PDF 或 PPTX 文件。");
        }

        const sourceType = isPptx(file) ? "pptx" : "pdf";
        if (!isPdf(file) && !isPptx(file)) {
          throw new Error("当前支持 PDF 和 PPTX 文件。");
        }

        if (file.size > limits.maxUploadBytes) {
          throw new Error(`文件大小超过限制：当前上限为 ${limits.maxUploadMb} MB。`);
        }

        const aiStatus = getAiConfigStatus();
        if (!aiStatus.configured) {
          throw new Error(`AI 网关未配置完整：缺少 ${aiStatus.missing.join("、")}。`);
        }

        const title = String(formData.get("title") || titleFromFileName(file.name)).trim();
        const requestedStartPage = pageNumberFromForm(formData.get("startPage"));
        const requestedEndPage = pageNumberFromForm(formData.get("endPage"));

        if (requestedStartPage && requestedEndPage && requestedStartPage > requestedEndPage) {
          throw new Error("页码范围无效：起始页不能大于结束页。");
        }

        if (requestedStartPage && requestedEndPage && requestedEndPage - requestedStartPage + 1 > limits.maxPages) {
          throw new Error(`本次选择 ${requestedEndPage - requestedStartPage + 1} 页，超过当前限制 ${limits.maxPages} 页。`);
        }

        send(controller, {
          type: "progress",
          phase: "validate",
          percent: 6,
          message: "文件已接收，正在校验格式和页码范围。",
        });

        const originalBuffer = await file.arrayBuffer();
        const rangeSalt =
          requestedStartPage || requestedEndPage
            ? `range:${requestedStartPage || ""}-${requestedEndPage || ""}`
            : "";
        const fileHash = hashPdfBytes(originalBuffer, [sourceType === "pptx" ? "source:pptx" : "", rangeSalt].filter(Boolean).join("|"));
        const cachedDocument = await getStoredDocument(fileHash);

        if (cachedDocument) {
          send(controller, {
            type: "meta",
            title: cachedDocument.title,
            fileName: cachedDocument.fileName,
            pageCount: cachedDocument.pageCount,
            maxPages: limits.maxPages,
            documentKind: cachedDocument.documentKind,
          });
          send(controller, {
            type: "progress",
            phase: "done",
            percent: 100,
            message: "已找到同一份文档的历史详解，直接打开保存结果。",
          });
          send(controller, {
            type: "done",
            title: cachedDocument.title,
            slides: cachedDocument.slides,
            documentId: cachedDocument.id,
            documentUrl: documentUrl(cachedDocument.id),
            cached: true,
            documentKind: cachedDocument.documentKind,
          });
          return;
        }

        let buffer = originalBuffer;
        if (sourceType === "pptx") {
          send(controller, {
            type: "progress",
            phase: "validate",
            percent: 8,
            message: "正在把 PPTX 转换为 PDF。",
          });
          buffer = await convertPptxToPdf(originalBuffer, file.name);
        }

        let knownPageCount = 0;
        let selectedPageCount = 0;
        let effectiveStartPage = requestedStartPage || 1;
        let effectiveEndPage = requestedEndPage || 1;
        const rendered = await renderPdfSlides(buffer, {
          maxPages: limits.maxPages,
          scale: limits.renderScale,
          startPage: requestedStartPage,
          endPage: requestedEndPage,
          signal: jobTimeout.signal,
          onPageCount: ({ totalPageCount, selectedPageCount: selectedCount, startPage, endPage }) => {
            knownPageCount = totalPageCount;
            selectedPageCount = selectedCount;
            effectiveStartPage = startPage;
            effectiveEndPage = endPage;
            send(controller, {
              type: "meta",
              title,
              fileName: file.name,
              pageCount: selectedCount,
              maxPages: limits.maxPages,
            });
          },
          onProgress: ({ pageNumber, pageIndex, selectedPageCount }) => {
            const percent = 10 + Math.round((pageIndex / selectedPageCount) * 32);
            send(controller, {
              type: "progress",
              phase: "render",
              percent,
              message: `正在渲染第 ${pageNumber} 页（${pageIndex}/${selectedPageCount}）。`,
            });
          },
        });

        const slides: SlideResult[] = [];
        const pageCount = selectedPageCount || rendered.length;
        const documentKind = detectDocumentKind({
          fileName: file.name,
          title,
          pages: rendered,
        });

        send(controller, {
          type: "meta",
          title,
          fileName: file.name,
          pageCount,
          maxPages: limits.maxPages,
          documentKind,
        });
        send(controller, {
          type: "progress",
          phase: "ai",
          percent: 43,
          message: `已识别为${documentKindLabels[documentKind]}，正在选择详解框架。`,
        });

        for (const [index, slide] of rendered.entries()) {
          assertNotAborted(jobTimeout.signal);

          const pageNumber = slide.pageNumber;
          const percent = 44 + Math.round((index / Math.max(pageCount, 1)) * 50);

          send(controller, {
            type: "progress",
            phase: "ai",
            percent,
            message: `正在生成第 ${pageNumber} 页中文详解。`,
          });

          const result: SlideResult = { ...slide };

          try {
            result.explanation = await generateSlideExplanation({
              documentTitle: title,
              documentKind,
              pageNumber,
              pageText: slide.text,
              imageDataUrl: slide.imageDataUrl,
              signal: jobTimeout.signal,
              timeoutMs: hardening.aiRequestTimeoutMs,
              textCharLimit: hardening.slideTextCharLimit,
            });
          } catch (error) {
            if (jobTimeout.signal.aborted) {
              throw error;
            }

            result.error = publicErrorMessage(error);
          }

          slides.push(result);
          send(controller, {
            type: "page",
            slide: result,
          });
        }

        const storedDocument = await createStoredDocument({
          fileHash,
          fileName: file.name,
          title,
          documentKind,
          sourceType,
          pageRange: {
            startPage: effectiveStartPage,
            endPage: effectiveEndPage,
            totalPageCount: knownPageCount || effectiveEndPage,
          },
          slides,
        });

        send(controller, {
          type: "progress",
          phase: "done",
          percent: 100,
          message: "全部页面处理完成。",
        });
        send(controller, {
          type: "done",
          title,
          slides,
          documentId: storedDocument.id,
          documentUrl: documentUrl(storedDocument.id),
          documentKind,
        });
      } catch (error) {
        send(controller, {
          type: "error",
          message: publicErrorMessage(error),
        });
      } finally {
        jobTimeout.clear();
        releaseJobSlot();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
