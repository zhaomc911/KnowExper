import { NextResponse } from "next/server";
import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { generateSlideExplanation } from "@/lib/ai";
import { canAccessStoredDocument, getStoredDocument, updateStoredSlideExplanation } from "@/lib/documents";
import { checkRateLimit, createTimeoutController, publicErrorMessage } from "@/lib/guardrails";
import { getHardeningConfig } from "@/lib/limits";
import { getResolvedUserAiCredential } from "@/lib/user-store";
import type { DocumentKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type RegenerateRequest = {
  documentId?: string;
  documentTitle?: string;
  pageNumber?: number;
  buildContext?: string;
  pageText?: string;
  imageDataUrl?: string;
  documentKind?: DocumentKind;
};

export async function POST(request: Request) {
  const hardening = getHardeningConfig();
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录后再重新生成。" }, { status: 401 });
  }

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

  const aiCredential = await getResolvedUserAiCredential(user.id);
  if (!aiCredential) {
    return NextResponse.json({ error: "请先在账号设置里配置自己的模型 API。" }, { status: 400 });
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
    if (storedDocument && !canAccessStoredDocument(storedDocument, user.id)) {
      return NextResponse.json({ error: "文档不存在或无权访问。" }, { status: 404 });
    }

    const explanation = await generateSlideExplanation({
      documentTitle: body.documentTitle || "KnowExper",
      documentKind: body.documentKind || storedDocument?.documentKind,
      pageNumber: body.pageNumber,
      buildContext: body.buildContext,
      pageText: body.pageText || "",
      imageDataUrl: body.imageDataUrl,
      aiCredential,
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
