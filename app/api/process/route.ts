import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { generateSlideExplanation, getAiConfigStatus } from "@/lib/ai";
import { collapseAcademicPaperSections, collapseBuildFrames } from "@/lib/build-collapse";
import { detectDocumentKind, documentKindLabels } from "@/lib/document-kind";
import {
  createStoredDocument,
  documentUrl,
  getStoredDocument,
  hashPdfBytes,
  saveStoredDocument,
  updateStoredDocumentStatus,
  updateStoredSlideResult,
} from "@/lib/documents";
import {
  assertNotAborted,
  checkRateLimit,
  createTimeoutController,
  publicErrorMessage,
  tryAcquireJobSlot,
} from "@/lib/guardrails";
import { getHardeningConfig, getProcessingLimits } from "@/lib/limits";
import { analyzePdfPages, renderSelectedPdfSlides } from "@/lib/pdf";
import { convertPptxToPdf } from "@/lib/pptx";
import { getResolvedUserAiCredential, type ResolvedAiCredential } from "@/lib/user-store";
import type { DocumentKind, ProcessEvent, SlideResult, StoredDocumentStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 3600;

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

function documentKindFromForm(value: FormDataEntryValue | null): DocumentKind | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "course_slides" || text === "academic_paper") return text;
  return undefined;
}

function slideSourceLabel(slide: SlideResult) {
  if (slide.buildFrameRange && slide.buildFrameRange.frameCount > 1) {
    return `${slide.buildFrameRange.startPage}-${slide.buildFrameRange.endPage}`;
  }

  return String(slide.pageNumber);
}

function collapsedStats(slides: SlideResult[]) {
  const sourcePageCount = slides.reduce((total, slide) => total + (slide.sourcePageNumbers?.length || 1), 0);

  return {
    sourcePageCount,
    collapsedPageCount: Math.max(0, sourcePageCount - slides.length),
  };
}

function completedSlideCount(slides: SlideResult[]) {
  return slides.filter((slide) => Boolean(slide.explanation)).length;
}

function statusForSlides(slides: SlideResult[]): StoredDocumentStatus {
  return completedSlideCount(slides) >= slides.length ? "complete" : "partial";
}

function partialCompletionMessage(slides: SlideResult[]) {
  return `已保存 ${completedSlideCount(slides)}/${slides.length} 个讲解单元；失败或未完成页面不会自动重试，请打开文档后单页重新生成。`;
}

function needsSourcePagePreviews(slides: SlideResult[]) {
  return slides.some((slide) => {
    const sourcePageCount = slide.sourcePageNumbers?.length || 0;
    return sourcePageCount > 1 && (slide.sourcePages?.length || 0) < sourcePageCount;
  });
}

function fallbackUnitTitle(slide: SlideResult) {
  const paperMatch = slide.buildContext?.match(/论文板块「([^」]+)」/);

  return (
    slide.unitTitle ||
    slide.explanation?.topic ||
    slide.explanation?.title ||
    paperMatch?.[1] ||
    `源页 ${slideSourceLabel(slide)}`
  );
}

async function enrichSourcePagePreviews({
  buffer,
  slides,
  renderScale,
  signal,
  onProgress,
}: {
  buffer: ArrayBuffer;
  slides: SlideResult[];
  renderScale: number;
  signal: AbortSignal;
  onProgress: (progress: { pageNumber: number; pageIndex: number; selectedPageCount: number }) => void;
}) {
  const pageNumbers = Array.from(
    new Set(slides.flatMap((slide) => slide.sourcePageNumbers || [slide.pageNumber])),
  ).sort((a, b) => a - b);
  const renderedPages = await renderSelectedPdfSlides(buffer, {
    pageNumbers,
    scale: renderScale,
    signal,
    onProgress,
  });
  const renderedPageByNumber = new Map(renderedPages.map((slide) => [slide.pageNumber, slide]));

  return slides.map((slide): SlideResult => {
    const sourcePageNumbers = slide.sourcePageNumbers || [slide.pageNumber];
    if (sourcePageNumbers.length <= 1 || (slide.sourcePages?.length || 0) >= sourcePageNumbers.length) {
      return slide;
    }

    const unitTitle = fallbackUnitTitle(slide);
    const sourcePages = sourcePageNumbers
      .map((pageNumber) => {
        const renderedPage = renderedPageByNumber.get(pageNumber);
        if (!renderedPage) return null;

        return {
          pageNumber,
          width: renderedPage.width,
          height: renderedPage.height,
          imageDataUrl: renderedPage.imageDataUrl,
          title: unitTitle,
        };
      })
      .filter((page): page is NonNullable<typeof page> => Boolean(page));

    return {
      ...slide,
      unitTitle,
      sourcePages: sourcePages.length > 1 ? sourcePages : slide.sourcePages,
    };
  });
}

async function generateMissingExplanations({
  controller,
  documentId,
  title,
  documentKind,
  slides,
  signal,
  hardening,
  aiCredential,
}: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  documentId: string;
  title: string;
  documentKind?: DocumentKind;
  slides: SlideResult[];
  signal: AbortSignal;
  hardening: ReturnType<typeof getHardeningConfig>;
  aiCredential: ResolvedAiCredential;
}) {
  const nextSlides = slides.map((slide) => ({ ...slide }));
  const pageCount = nextSlides.length;
  let consecutiveFailures = 0;

  for (const [index, slide] of nextSlides.entries()) {
    if (slide.explanation || slide.error) continue;

    assertNotAborted(signal);

    const pageNumber = slide.pageNumber;
    const percent = 44 + Math.round((index / Math.max(pageCount, 1)) * 50);
    const sourceLabel = slideSourceLabel(slide);

    send(controller, {
      type: "progress",
      phase: "ai",
      percent,
      message: `正在生成源页 ${sourceLabel} 的中文详解。`,
    });

    const result: SlideResult = { ...slide, error: undefined };

    try {
      result.explanation = await generateSlideExplanation({
        documentTitle: title,
        documentKind,
        pageNumber,
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
      documentId,
      slide: result,
      status: "processing",
    });
    send(controller, {
      type: "page",
      slide: result,
    });

    if (!result.explanation && consecutiveFailures >= 3) {
      throw new Error(
        `连续 ${consecutiveFailures} 个讲解单元模型调用失败，已停止以避免继续消耗 API 额度。请检查 Highland 模型和网关配置；已生成内容已保存，失败页可稍后单页重新生成。最近错误：${result.error}`,
      );
    }
  }

  return nextSlides;
}

export async function POST(request: Request) {
  const limits = getProcessingLimits();
  const hardening = getHardeningConfig();
  const user = await getCurrentUser(request);

  if (!user) {
    return errorStream("请先登录后再上传。", 401);
  }

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

  const aiCredential = await getResolvedUserAiCredential(user.id);
  if (!aiCredential) {
    return errorStream("请先在账号设置里配置自己的模型 API。", 400);
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
      let activeDocumentId = "";

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

        const aiStatus = getAiConfigStatus(aiCredential);
        if (!aiStatus.configured) {
          throw new Error(`AI 网关未配置完整：缺少 ${aiStatus.missing.join("、")}。`);
        }

        const title = String(formData.get("title") || titleFromFileName(file.name)).trim();
        const requestedDocumentKind = documentKindFromForm(formData.get("documentKind")) ?? "course_slides";
        const maxExplainUnits =
          requestedDocumentKind === "academic_paper" ? limits.maxPaperPages : limits.maxPages;
        const requestedStartPage =
          requestedDocumentKind === "course_slides" ? pageNumberFromForm(formData.get("startPage")) : undefined;
        const requestedEndPage =
          requestedDocumentKind === "course_slides" ? pageNumberFromForm(formData.get("endPage")) : undefined;

        if (requestedStartPage && requestedEndPage && requestedStartPage > requestedEndPage) {
          throw new Error("页码范围无效：起始页不能大于结束页。");
        }

        if (requestedStartPage && requestedEndPage && requestedEndPage - requestedStartPage + 1 > limits.maxSourcePages) {
          throw new Error(
            `本次选择 ${requestedEndPage - requestedStartPage + 1} 个原始页面，超过当前源文件扫描限制 ${limits.maxSourcePages} 页。`,
          );
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
        const collapseSalt = `collapse:v2:kind:${requestedDocumentKind}:maxSource:${limits.maxSourcePages}:maxUnits:${maxExplainUnits}`;
        const fileHash = hashPdfBytes(
          originalBuffer,
          [`owner:${user.id}`, sourceType === "pptx" ? "source:pptx" : "", rangeSalt, collapseSalt]
            .filter(Boolean)
            .join("|"),
        );
        let cachedDocument = await getStoredDocument(fileHash);

        if (cachedDocument) {
          if (sourceType === "pdf" && needsSourcePagePreviews(cachedDocument.slides)) {
            send(controller, {
              type: "progress",
              phase: "render",
              percent: 24,
              message: "已找到历史详解，正在补齐合并单元的源页预览图片。",
            });
            const enrichedSlides = await enrichSourcePagePreviews({
              buffer: originalBuffer,
              slides: cachedDocument.slides,
              renderScale: limits.renderScale,
              signal: jobTimeout.signal,
              onProgress: ({ pageNumber, pageIndex, selectedPageCount }) => {
                const percent = 24 + Math.round((pageIndex / selectedPageCount) * 18);
                send(controller, {
                  type: "progress",
                  phase: "render",
                  percent,
                  message: `正在补渲染源页 ${pageNumber} 的预览图片（${pageIndex}/${selectedPageCount}）。`,
                });
              },
            });
            cachedDocument = {
              ...cachedDocument,
              slides: enrichedSlides,
              updatedAt: new Date().toISOString(),
            };
            await saveStoredDocument(cachedDocument);
          }

          const stats = collapsedStats(cachedDocument.slides);
          const status = cachedDocument.status ?? "complete";
          const completedPageCount = cachedDocument.completedPageCount ?? completedSlideCount(cachedDocument.slides);
          send(controller, {
            type: "meta",
            title: cachedDocument.title,
            fileName: cachedDocument.fileName,
            pageCount: cachedDocument.pageCount,
            maxPages: maxExplainUnits,
            sourcePageCount: stats.sourcePageCount,
            collapsedPageCount: stats.collapsedPageCount,
            completedPageCount,
            documentId: cachedDocument.id,
            documentUrl: documentUrl(cachedDocument.id),
            status,
            documentKind: cachedDocument.documentKind,
            sourceType: cachedDocument.sourceType,
            pageRange: cachedDocument.pageRange,
          });

          if (status !== "complete") {
            activeDocumentId = cachedDocument.id;
            send(controller, {
              type: "progress",
              phase: "ai",
              percent: 43,
              message: `已找到未完成详解，正在从 ${completedPageCount}/${cachedDocument.pageCount} 个讲解单元后继续。`,
            });
            for (const slide of cachedDocument.slides) {
              send(controller, {
                type: "page",
                slide,
              });
            }

            const resumedSlides = await generateMissingExplanations({
              controller,
              documentId: cachedDocument.id,
              title: cachedDocument.title,
              documentKind: cachedDocument.documentKind,
              slides: cachedDocument.slides,
              signal: jobTimeout.signal,
              hardening,
              aiCredential,
            });
            const resumedStatus = statusForSlides(resumedSlides);
            const storedDocument = await updateStoredDocumentStatus({
              documentId: cachedDocument.id,
              status: resumedStatus,
              lastError: resumedStatus === "partial" ? partialCompletionMessage(resumedSlides) : undefined,
            });
            activeDocumentId = "";
            const finalSlides = storedDocument?.slides ?? resumedSlides;
            const finalCompletedPageCount = storedDocument?.completedPageCount ?? completedSlideCount(finalSlides);
            const finalStatus = storedDocument?.status ?? statusForSlides(finalSlides);

            send(controller, {
              type: "progress",
              phase: "done",
              percent: 100,
              message: finalStatus === "complete" ? "已补齐未完成讲解。" : partialCompletionMessage(finalSlides),
            });
            send(controller, {
              type: "done",
              title: cachedDocument.title,
              slides: finalSlides,
              documentId: cachedDocument.id,
              documentUrl: documentUrl(cachedDocument.id),
              cached: true,
              sourcePageCount: stats.sourcePageCount,
              collapsedPageCount: stats.collapsedPageCount,
              completedPageCount: finalCompletedPageCount,
              status: finalStatus,
              documentKind: cachedDocument.documentKind,
              sourceType: cachedDocument.sourceType,
              pageRange: cachedDocument.pageRange,
            });
            return;
          }

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
            sourcePageCount: stats.sourcePageCount,
            collapsedPageCount: stats.collapsedPageCount,
            completedPageCount,
            status,
            documentKind: cachedDocument.documentKind,
            sourceType: cachedDocument.sourceType,
            pageRange: cachedDocument.pageRange,
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
        let selectedSourcePageCount = 0;
        let effectiveStartPage = requestedStartPage || 1;
        let effectiveEndPage = requestedEndPage || 1;
        const analyzedPages = await analyzePdfPages(buffer, {
          maxSourcePages: limits.maxSourcePages,
          startPage: requestedStartPage,
          endPage: requestedEndPage,
          signal: jobTimeout.signal,
          onPageCount: ({ totalPageCount, selectedPageCount: selectedCount, startPage, endPage }) => {
            knownPageCount = totalPageCount;
            selectedSourcePageCount = selectedCount;
            effectiveStartPage = startPage;
            effectiveEndPage = endPage;
            send(controller, {
              type: "meta",
              title,
              fileName: file.name,
              pageCount: Math.min(selectedCount, maxExplainUnits),
              maxPages: maxExplainUnits,
              sourcePageCount: selectedCount,
              sourceType,
              pageRange: {
                startPage,
                endPage,
                totalPageCount,
              },
            });
          },
          onProgress: ({ pageNumber, pageIndex, selectedPageCount }) => {
            const percent = 10 + Math.round((pageIndex / selectedPageCount) * 14);
            send(controller, {
              type: "progress",
              phase: "validate",
              percent,
              message: `正在分析第 ${pageNumber} 页文本结构（${pageIndex}/${selectedPageCount}）。`,
            });
          },
        });

        const collapse =
          requestedDocumentKind === "academic_paper"
            ? collapseAcademicPaperSections(analyzedPages, {
                targetGroupCount: maxExplainUnits,
              })
            : collapseBuildFrames(analyzedPages, {
                targetGroupCount: maxExplainUnits,
              });

        if (collapse.groups.length > maxExplainUnits) {
          throw new Error(
            `智能合并后仍有 ${collapse.groups.length} 个讲解单元，超过当前限制 ${maxExplainUnits} 个。请缩小精讲范围。`,
          );
        }

        send(controller, {
          type: "progress",
          phase: "render",
          percent: 25,
          message:
            requestedDocumentKind === "academic_paper"
              ? `已将 ${collapse.sourcePageCount} 个原始页面划分为 ${collapse.groups.length} 个论文精读板块。`
              : collapse.collapsedPageCount > 0
              ? `已将 ${collapse.sourcePageCount} 个原始页面智能合并为 ${collapse.groups.length} 个讲解单元。`
              : `已确认 ${collapse.groups.length} 个讲解单元，正在渲染页面图片。`,
        });

        const analysisByPageNumber = new Map(analyzedPages.map((page) => [page.pageNumber, page]));
        const sourcePageNumbers = Array.from(
          new Set(collapse.groups.flatMap((group) => group.pageNumbers)),
        ).sort((a, b) => a - b);
        const groupByRepresentativePage = new Map(
          collapse.groups.map((group) => [group.representativePageNumber, group]),
        );
        const renderedPages = await renderSelectedPdfSlides(buffer, {
          pageNumbers: sourcePageNumbers,
          scale: limits.renderScale,
          signal: jobTimeout.signal,
          onProgress: ({ pageNumber, pageIndex, selectedPageCount }) => {
            const percent = 26 + Math.round((pageIndex / selectedPageCount) * 16);
            const group = groupByRepresentativePage.get(pageNumber);
            const label =
              group && group.pageNumbers.length > 1
                ? `${group.pageNumbers[0]}-${group.pageNumbers[group.pageNumbers.length - 1]}`
                : String(pageNumber);

            send(controller, {
              type: "progress",
              phase: "render",
              percent,
              message: `正在渲染源页 ${label} 的页面图片（${pageIndex}/${selectedPageCount}）。`,
            });
          },
        });
        const renderedPageByNumber = new Map(renderedPages.map((slide) => [slide.pageNumber, slide]));
        const rendered: SlideResult[] = collapse.groups.map((group): SlideResult => {
          const representative = renderedPageByNumber.get(group.representativePageNumber);
          if (!representative) {
            throw new Error(`源页 ${group.representativePageNumber} 渲染失败，请重新上传。`);
          }

          const startPage = group.pageNumbers[0];
          const endPage = group.pageNumbers[group.pageNumbers.length - 1];
          const sourcePages = group.pageNumbers
            .map((pageNumber) => {
              const renderedPage = renderedPageByNumber.get(pageNumber);
              if (!renderedPage) return null;
              const analysis = analysisByPageNumber.get(pageNumber);

              return {
                pageNumber,
                width: renderedPage.width,
                height: renderedPage.height,
                imageDataUrl: renderedPage.imageDataUrl,
                title: analysis?.frameTitle || analysis?.sectionTitle || group.unitTitle,
              };
            })
            .filter((page): page is NonNullable<typeof page> => Boolean(page));

          return {
            ...representative,
            unitTitle: group.unitTitle,
            text: group.text,
            sourcePageNumbers: group.pageNumbers,
            sourcePages: sourcePages.length > 1 ? sourcePages : undefined,
            buildFrameRange:
              group.pageNumbers.length > 1
                ? {
                    startPage,
                    endPage,
                    frameCount: group.pageNumbers.length,
                    kind: group.kind,
                  }
                : undefined,
            buildContext: group.buildContext,
          };
        });

        const pageCount = rendered.length;
        const documentKind =
          requestedDocumentKind ||
          detectDocumentKind({
            fileName: file.name,
            title,
            pages: rendered,
          });
        const sourcePageCount = selectedSourcePageCount || collapse.sourcePageCount;
        const collapsedPageCount = collapse.collapsedPageCount;
        const pageRange = {
          startPage: effectiveStartPage,
          endPage: effectiveEndPage,
          totalPageCount: knownPageCount || effectiveEndPage,
        };
        const storedDocument = await createStoredDocument({
          fileHash,
          ownerId: user.id,
          fileName: file.name,
          title,
          documentKind,
          sourceType,
          pageRange,
          status: "processing",
          sourcePageCount,
          collapsedPageCount,
          slides: rendered,
        });
        activeDocumentId = storedDocument.id;

        send(controller, {
          type: "meta",
          title,
          fileName: file.name,
          pageCount,
          maxPages: maxExplainUnits,
          sourcePageCount,
          collapsedPageCount,
          completedPageCount: 0,
          documentId: storedDocument.id,
          documentUrl: documentUrl(storedDocument.id),
          status: "processing",
          documentKind,
          sourceType,
          pageRange,
        });
        send(controller, {
          type: "progress",
          phase: "ai",
          percent: 43,
          message: `已识别为${documentKindLabels[documentKind]}，正在选择详解框架。`,
        });

        const slides = await generateMissingExplanations({
          controller,
          documentId: storedDocument.id,
          title,
          documentKind,
          slides: storedDocument.slides,
          signal: jobTimeout.signal,
          hardening,
          aiCredential,
        });
        const generatedStatus = statusForSlides(slides);
        const finalDocument = await updateStoredDocumentStatus({
          documentId: storedDocument.id,
          status: generatedStatus,
          lastError: generatedStatus === "partial" ? partialCompletionMessage(slides) : undefined,
        });
        activeDocumentId = "";
        const finalSlides = finalDocument?.slides ?? slides;
        const completedPageCount = finalDocument?.completedPageCount ?? completedSlideCount(finalSlides);
        const finalStatus = finalDocument?.status ?? statusForSlides(finalSlides);

        send(controller, {
          type: "progress",
          phase: "done",
          percent: 100,
          message: finalStatus === "complete" ? "全部页面处理完成。" : partialCompletionMessage(finalSlides),
        });
        send(controller, {
          type: "done",
          title,
          slides: finalSlides,
          documentId: storedDocument.id,
          documentUrl: documentUrl(storedDocument.id),
          sourcePageCount,
          collapsedPageCount,
          completedPageCount,
          status: finalStatus,
          documentKind,
          sourceType,
          pageRange: finalDocument?.pageRange ?? storedDocument.pageRange,
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
        jobTimeout.clear();
        releaseJobSlot();
        try {
          controller.close();
        } catch {
          // The browser may have closed the stream while the local job kept saving progress.
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
