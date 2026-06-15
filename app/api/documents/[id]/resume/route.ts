import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { generateSlideExplanation, getAiConfigStatus } from "@/lib/ai";
import {
  canAccessStoredDocument,
  documentUrl,
  getStoredDocument,
  updateStoredDocumentStatus,
  updateStoredSlideResult,
  type StoredDocument,
} from "@/lib/documents";
import {
  assertNotAborted,
  checkRateLimit,
  createTimeoutController,
  publicErrorMessage,
  tryAcquireJobSlot,
} from "@/lib/guardrails";
import { getHardeningConfig } from "@/lib/limits";
import { getResolvedUserAiCredential, type ResolvedAiCredential } from "@/lib/user-store";
import type { ProcessEvent, SlideResult, StoredDocumentStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 3600;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function jsonLine(event: ProcessEvent) {
  return `${JSON.stringify(event)}\n`;
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: ProcessEvent) {
  try {
    controller.enqueue(new TextEncoder().encode(jsonLine(event)));
    return true;
  } catch {
    return false;
  }
}

function completedSlideCount(slides: SlideResult[]) {
  return slides.filter((slide) => Boolean(slide.explanation)).length;
}

function statusForSlides(slides: SlideResult[]): StoredDocumentStatus {
  return completedSlideCount(slides) >= slides.length ? "complete" : "partial";
}

function partialCompletionMessage(slides: SlideResult[]) {
  return `已保存 ${completedSlideCount(slides)}/${slides.length} 个讲解单元；可继续生成剩余页面。`;
}

function slideSourceLabel(slide: SlideResult) {
  if (slide.buildFrameRange && slide.buildFrameRange.frameCount > 1) {
    return `${slide.buildFrameRange.startPage}-${slide.buildFrameRange.endPage}`;
  }

  return String(slide.pageNumber);
}

async function generateMissingExplanations({
  controller,
  document,
  signal,
  hardening,
  aiCredential,
}: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  document: StoredDocument;
  signal: AbortSignal;
  hardening: ReturnType<typeof getHardeningConfig>;
  aiCredential: ResolvedAiCredential;
}) {
  const nextSlides = document.slides.map((slide) => ({ ...slide }));
  const pageCount = nextSlides.length;
  let consecutiveFailures = 0;

  for (const [index, slide] of nextSlides.entries()) {
    if (slide.explanation) continue;

    assertNotAborted(signal);

    const percent = Math.min(98, Math.round((completedSlideCount(nextSlides) / Math.max(pageCount, 1)) * 100));
    const sourceLabel = slideSourceLabel(slide);

    send(controller, {
      type: "progress",
      phase: "ai",
      percent,
      message: `正在继续生成源页 ${sourceLabel} 的中文详解。`,
    });

    const result: SlideResult = { ...slide, error: undefined };

    try {
      result.explanation = await generateSlideExplanation({
        documentTitle: document.title,
        documentKind: document.documentKind,
        pageNumber: slide.pageNumber,
        pageText: slide.text,
        buildContext: slide.buildContext,
        imageDataUrl: slide.imageDataUrl,
        aiCredential,
        signal,
        timeoutMs: hardening.aiRequestTimeoutMs,
        textCharLimit: hardening.slideTextCharLimit,
      });
      consecutiveFailures = 0;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }

      result.error = publicErrorMessage(error);
      consecutiveFailures += 1;
    }

    nextSlides[index] = result;
    await updateStoredSlideResult({
      documentId: document.id,
      slide: result,
      status: "processing",
    });
    send(controller, {
      type: "page",
      slide: result,
    });

    if (!result.explanation && consecutiveFailures >= 3) {
      throw new Error(
        `连续 ${consecutiveFailures} 个讲解单元模型调用失败，已停止以避免继续消耗 API 额度。已生成内容已保存，最近错误：${result.error}`,
      );
    }
  }

  return nextSlides;
}

export async function POST(request: Request, { params }: RouteContext) {
  const hardening = getHardeningConfig();
  const user = await getCurrentUser(request);

  if (!user) {
    return new Response(jsonLine({ type: "error", message: "请先登录后再继续生成。" }), {
      status: 401,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const rateLimit = checkRateLimit(
    request,
    "resume",
    hardening.processRateLimit,
    hardening.rateLimitWindowMs,
  );

  if (!rateLimit.allowed) {
    return new Response(jsonLine({ type: "error", message: `请求太频繁了，请 ${rateLimit.retryAfterSeconds} 秒后再试。` }), {
      status: 429,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (isBetaAccessRequired() && !hasBetaAccess(request)) {
    return new Response(jsonLine({ type: "error", message: "测试访问码不正确，请确认后再重试。" }), {
      status: 401,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const aiCredential = await getResolvedUserAiCredential(user.id);
  if (!aiCredential) {
    return new Response(jsonLine({ type: "error", message: "请先在账号设置里配置自己的模型 API。" }), {
      status: 400,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const releaseJobSlot = tryAcquireJobSlot(hardening.maxConcurrentJobs);
  if (!releaseJobSlot) {
    return new Response(jsonLine({ type: "error", message: "当前处理人数较多，请稍后再继续生成。" }), {
      status: 503,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const { id } = await params;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const timeout = createTimeoutController(
        hardening.totalJobTimeoutMs,
        "处理时间过长，任务已停止。已生成内容会保留，可稍后继续。",
      );
      let activeDocumentId = "";

      try {
        const document = await getStoredDocument(id);
        if (!document || !canAccessStoredDocument(document, user.id)) {
          throw new Error("文档不存在或已被清理。");
        }
        activeDocumentId = document.id;

        const aiStatus = getAiConfigStatus(aiCredential);
        if (!aiStatus.configured) {
          throw new Error(`AI 网关未配置完整：缺少 ${aiStatus.missing.join("、")}。`);
        }

        await updateStoredDocumentStatus({
          documentId: document.id,
          status: "processing",
        });

        send(controller, {
          type: "meta",
          title: document.title,
          fileName: document.fileName,
          pageCount: document.pageCount,
          maxPages: document.pageCount,
          sourcePageCount: document.sourcePageCount,
          collapsedPageCount: document.collapsedPageCount,
          completedPageCount: completedSlideCount(document.slides),
          documentId: document.id,
          documentUrl: documentUrl(document.id),
          status: "processing",
          documentKind: document.documentKind,
          sourceType: document.sourceType,
          pageRange: document.pageRange,
        });

        for (const slide of document.slides) {
          send(controller, {
            type: "page",
            slide,
          });
        }

        const slides = await generateMissingExplanations({
          controller,
          document,
          signal: timeout.signal,
          hardening,
          aiCredential,
        });
        const status = statusForSlides(slides);
        const storedDocument = await updateStoredDocumentStatus({
          documentId: document.id,
          status,
          lastError: status === "partial" ? partialCompletionMessage(slides) : undefined,
        });
        const finalSlides = storedDocument?.slides ?? slides;
        const completedPageCount = storedDocument?.completedPageCount ?? completedSlideCount(finalSlides);

        send(controller, {
          type: "progress",
          phase: "done",
          percent: 100,
          message: status === "complete" ? "剩余讲解已全部生成。" : partialCompletionMessage(finalSlides),
        });
        send(controller, {
          type: "done",
          title: document.title,
          slides: finalSlides,
          documentId: document.id,
          documentUrl: documentUrl(document.id),
          sourcePageCount: document.sourcePageCount,
          collapsedPageCount: document.collapsedPageCount,
          completedPageCount,
          status,
          documentKind: document.documentKind,
          sourceType: document.sourceType,
          pageRange: document.pageRange,
        });
      } catch (error) {
        const message = publicErrorMessage(error);
        if (activeDocumentId) {
          await updateStoredDocumentStatus({
            documentId: activeDocumentId,
            status: "partial",
            lastError: message,
          }).catch(() => null);
        }
        send(controller, {
          type: "error",
          message,
        });
      } finally {
        timeout.clear();
        releaseJobSlot();
        try {
          controller.close();
        } catch {
          // The browser may have closed the stream while progress was being saved.
        }
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
