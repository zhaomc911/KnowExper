import { NextResponse } from "next/server";
import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { generateSlideExplanation } from "@/lib/ai";
import { getStoredDocument, updateStoredSlideExplanation } from "@/lib/documents";
import { checkRateLimit, createTimeoutController, publicErrorMessage } from "@/lib/guardrails";
import { getHardeningConfig } from "@/lib/limits";
import type { DocumentKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type RegenerateRequest = {
  documentId?: string;
  documentTitle?: string;
  pageNumber?: number;
  pageText?: string;
  imageDataUrl?: string;
  documentKind?: DocumentKind;
};

export async function POST(request: Request) {
  const hardening = getHardeningConfig();
  const rateLimit = checkRateLimit(
    request,
    "regenerate",
    hardening.regenerateRateLimit,
    hardening.rateLimitWindowMs,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: `请求太频繁了，请 ${rateLimit.retryAfterSeconds} 秒后再试。` }, { status: 429 });
  }

  if (isBetaAccessRequired() && !hasBetaAccess(request)) {
    return NextResponse.json({ error: "测试访问码不正确，请确认后再重试。" }, { status: 401 });
  }

  const timeout = createTimeoutController(
    hardening.aiRequestTimeoutMs,
    "模型调用超时，请稍后重试。",
  );

  try {
    const body = (await request.json()) as RegenerateRequest;

    if (!body.pageNumber || !body.imageDataUrl?.startsWith("data:image/png;base64,")) {
      return NextResponse.json({ error: "缺少可重新生成的页面图片或页码。" }, { status: 400 });
    }

    if (body.imageDataUrl.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "这页图片过大，无法重新生成。" }, { status: 413 });
    }

    const storedDocument = body.documentId ? await getStoredDocument(body.documentId) : null;
    const explanation = await generateSlideExplanation({
      documentTitle: body.documentTitle || "KnowExper",
      documentKind: body.documentKind || storedDocument?.documentKind,
      pageNumber: body.pageNumber,
      pageText: body.pageText || "",
      imageDataUrl: body.imageDataUrl,
      signal: timeout.signal,
      timeoutMs: hardening.aiRequestTimeoutMs,
      textCharLimit: hardening.slideTextCharLimit,
    });

    if (body.documentId) {
      await updateStoredSlideExplanation({
        documentId: body.documentId,
        pageNumber: body.pageNumber,
        explanation,
      });
    }

    return NextResponse.json({ explanation });
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error) },
      { status: 500 },
    );
  } finally {
    timeout.clear();
  }
}
