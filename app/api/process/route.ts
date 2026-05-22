import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { generateSlideExplanation, getAiConfigStatus } from "@/lib/ai";
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
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Slides Explainer";
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
    return errorStream("无法读取上传文件，请重新上传 PDF。", 400);
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
          throw new Error("请上传一个 PDF 文件。");
        }

        if (isPptx(file)) {
          throw new Error("MVP 目前优先支持 PDF。PPTX 可先导出为 PDF 后上传，后续可接入 PPTX 转 PDF 服务。");
        }

        if (!isPdf(file)) {
          throw new Error("当前仅支持 PDF 文件。");
        }

        if (file.size > limits.maxUploadBytes) {
          throw new Error(`文件大小超过限制：当前上限为 ${limits.maxUploadMb} MB。`);
        }

        const aiStatus = getAiConfigStatus();
        if (!aiStatus.configured) {
          throw new Error(`AI 网关未配置完整：缺少 ${aiStatus.missing.join("、")}。`);
        }

        const title = String(formData.get("title") || titleFromFileName(file.name)).trim();
        send(controller, {
          type: "progress",
          phase: "validate",
          percent: 6,
          message: "文件已接收，正在校验 PDF。",
        });

        const buffer = await file.arrayBuffer();
        const fileHash = hashPdfBytes(buffer);
        const cachedDocument = await getStoredDocument(fileHash);

        if (cachedDocument) {
          send(controller, {
            type: "meta",
            title: cachedDocument.title,
            fileName: cachedDocument.fileName,
            pageCount: cachedDocument.pageCount,
            maxPages: limits.maxPages,
          });
          send(controller, {
            type: "progress",
            phase: "done",
            percent: 100,
            message: "已找到同一份 PDF 的历史讲解，直接打开保存结果。",
          });
          send(controller, {
            type: "done",
            title: cachedDocument.title,
            slides: cachedDocument.slides,
            documentId: cachedDocument.id,
            documentUrl: documentUrl(cachedDocument.id),
            cached: true,
          });
          return;
        }

        let knownPageCount = 0;
        const rendered = await renderPdfSlides(buffer, {
          maxPages: limits.maxPages,
          scale: limits.renderScale,
          signal: jobTimeout.signal,
          onPageCount: (pageCount) => {
            knownPageCount = pageCount;
            send(controller, {
              type: "meta",
              title,
              fileName: file.name,
              pageCount,
              maxPages: limits.maxPages,
            });
          },
          onProgress: ({ pageNumber, pageCount }) => {
            const percent = 8 + Math.round((pageNumber / pageCount) * 34);
            send(controller, {
              type: "progress",
              phase: "render",
              percent,
              message: `正在渲染 slide ${pageNumber}/${pageCount}。`,
            });
          },
        });

        const slides: SlideResult[] = [];
        const pageCount = knownPageCount || rendered.length;

        for (const [index, slide] of rendered.entries()) {
          assertNotAborted(jobTimeout.signal);

          const pageNumber = slide.pageNumber;
          const percent = 44 + Math.round((index / Math.max(pageCount, 1)) * 50);

          send(controller, {
            type: "progress",
            phase: "ai",
            percent,
            message: `正在生成第 ${pageNumber} 页中文讲解。`,
          });

          const result: SlideResult = { ...slide };

          try {
            result.explanation = await generateSlideExplanation({
              documentTitle: title,
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
