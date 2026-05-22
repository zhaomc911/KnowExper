import { NextResponse } from "next/server";
import { hasBetaAccess, isBetaAccessRequired } from "@/lib/access";
import { generateSelectionAnswer } from "@/lib/ai";
import { checkRateLimit, createTimeoutController, publicErrorMessage } from "@/lib/guardrails";
import { getHardeningConfig } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 120;

type AskSelectionRequest = {
  documentTitle?: string;
  pageNumber?: number;
  sourceLabel?: string;
  selectedText?: string;
  question?: string;
  pageContext?: string;
};

const MAX_SELECTED_TEXT_CHARS = 4000;
const MAX_QUESTION_CHARS = 800;
const MAX_CONTEXT_CHARS = 8000;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const hardening = getHardeningConfig();
  const rateLimit = checkRateLimit(
    request,
    "ask-selection",
    hardening.askRateLimit,
    hardening.rateLimitWindowMs,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: `提问太频繁了，请 ${rateLimit.retryAfterSeconds} 秒后再试。` }, { status: 429 });
  }

  if (isBetaAccessRequired() && !hasBetaAccess(request)) {
    return NextResponse.json({ error: "测试访问码不正确，请确认后再重试。" }, { status: 401 });
  }

  const timeout = createTimeoutController(
    hardening.aiRequestTimeoutMs,
    "答疑调用超时，请稍后重试。",
  );

  try {
    const body = (await request.json()) as AskSelectionRequest;
    const selectedText = cleanText(body.selectedText);
    const question = cleanText(body.question);
    const pageContext = cleanText(body.pageContext);

    if (!selectedText) {
      return NextResponse.json({ error: "请先选中一段需要提问的文字。" }, { status: 400 });
    }

    if (!question) {
      return NextResponse.json({ error: "请输入你的问题。" }, { status: 400 });
    }

    if (selectedText.length > MAX_SELECTED_TEXT_CHARS) {
      return NextResponse.json({ error: `选中文字太长，请控制在 ${MAX_SELECTED_TEXT_CHARS} 字以内。` }, { status: 413 });
    }

    if (question.length > MAX_QUESTION_CHARS) {
      return NextResponse.json({ error: `问题太长，请控制在 ${MAX_QUESTION_CHARS} 字以内。` }, { status: 413 });
    }

    const answer = await generateSelectionAnswer({
      documentTitle: cleanText(body.documentTitle) || "Slides Explainer",
      pageNumber: Number.isFinite(body.pageNumber) ? body.pageNumber : undefined,
      sourceLabel: cleanText(body.sourceLabel) || "页面选中文字",
      selectedText,
      question,
      pageContext: pageContext.slice(0, MAX_CONTEXT_CHARS),
      signal: timeout.signal,
      timeoutMs: hardening.aiRequestTimeoutMs,
      textCharLimit: hardening.slideTextCharLimit,
    });

    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error) },
      { status: 500 },
    );
  } finally {
    timeout.clear();
  }
}
