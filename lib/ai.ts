import "server-only";

import OpenAI from "openai";
import type { SlideExplanation } from "./types";

type GenerateSlideExplanationInput = {
  documentTitle: string;
  pageNumber: number;
  pageText: string;
  imageDataUrl: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  textCharLimit?: number;
};

type GenerateSelectionAnswerInput = {
  documentTitle: string;
  selectedText: string;
  question: string;
  pageNumber?: number;
  sourceLabel?: string;
  pageContext?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  textCharLimit?: number;
};

export function getAiConfigStatus() {
  const highlandKey = Boolean(process.env.HIGHLAND_API_KEY);
  const openAiKey = Boolean(process.env.OPENAI_API_KEY);
  const apiKeyConfigured = highlandKey || openAiKey;
  const baseURL = process.env.HIGHLAND_BASE_URL || process.env.OPENAI_BASE_URL || "";
  const model = process.env.HIGHLAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  return {
    configured: apiKeyConfigured && (highlandKey ? Boolean(process.env.HIGHLAND_BASE_URL) : true),
    provider: highlandKey ? "Highland" : "OpenAI-compatible",
    model,
    hasBaseURL: Boolean(baseURL),
    missing: [
      !apiKeyConfigured ? "HIGHLAND_API_KEY" : "",
      highlandKey && !process.env.HIGHLAND_BASE_URL ? "HIGHLAND_BASE_URL" : "",
    ].filter(Boolean),
  };
}

function createClient() {
  const apiKey = process.env.HIGHLAND_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.HIGHLAND_BASE_URL || process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("缺少 HIGHLAND_API_KEY。请在 .env.local 或部署平台环境变量中配置网关密钥。");
  }

  if (process.env.HIGHLAND_API_KEY && !process.env.HIGHLAND_BASE_URL) {
    throw new Error("缺少 HIGHLAND_BASE_URL。Highland 网关调用需要配置 Base URL。");
  }

  return new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
  });
}

function toStringList(value: unknown, fallback: string): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\n+/)
      .map((item) => item.replace(/^[-*\d.、\s]+/, "").trim())
      .filter(Boolean);
  }

  return [fallback];
}

function parseExplanation(raw: string): SlideExplanation {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  return {
    title: String(parsed.title || "这一页讲什么").trim(),
    topic: String(parsed.topic || "Slide").trim(),
    keyPoints: toStringList(parsed.keyPoints, "概括本页原始要点。"),
    detailedExplanation: toStringList(parsed.detailedExplanation, "详细解释本页概念、图示和上下文。"),
    confusionPoints: toStringList(parsed.confusionPoints, "指出本页容易混淆的地方。"),
    remember: String(parsed.remember || "记住本页最核心的概念。").trim(),
  };
}

function truncateText(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[文字抽取内容较长，后续部分已截断。请主要结合 slide 图片继续讲解。]`;
}

function truncateSelectionContext(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[上下文较长，后续部分已截断。请优先围绕用户选中的内容回答。]`;
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number | undefined) {
  const controller = new AbortController();
  const timeout = timeoutMs
    ? setTimeout(() => controller.abort(new Error("AI_REQUEST_TIMEOUT")), timeoutMs)
    : null;

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason || new Error("JOB_ABORTED"));
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => {
      if (timeout) clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function generateSlideExplanation(input: GenerateSlideExplanationInput): Promise<SlideExplanation> {
  const client = createClient();
  const model = process.env.HIGHLAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const requestSignal = createRequestSignal(input.signal, input.timeoutMs);
  const pageText = truncateText(input.pageText, input.textCharLimit);

  const prompt = `
你正在为中文学习者讲解一页课件。请结合 slide 图片和已抽取文字，输出严格 JSON。

文档标题：${input.documentTitle}
页码：${input.pageNumber}
本页抽取文字：
${pageText || "(这一页没有抽取到可读文字，请主要依据图片内容。)"}

JSON 字段：
- title: 中文标题，概括这一页。
- topic: 1 到 5 个词的页内主题，可保留英文术语。
- keyPoints: 字符串数组，说明原页要点。
- detailedExplanation: 字符串数组，用中文详细解释本页概念、图示、公式、术语和上下文。
- confusionPoints: 字符串数组，指出容易混淆点或常见误解。
- remember: 一个中文字符串，总结“这一页要记住什么”。

要求：
- 只输出 JSON，不要 Markdown。
- 不要编造课件外的具体事实；可以做必要背景解释，但要和本页内容紧密相关。
- 如果页面包含英文术语，请保留关键英文并解释中文含义。
- 讲解要面向正在复习课件的本科生，细致、自然、可读。
`;

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是耐心、严谨的中文课程讲解助手，擅长把英文课件逐页讲清楚。",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: input.imageDataUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
      },
      { signal: requestSignal.signal },
    );

    const content = completion.choices[0]?.message?.content;
    if (!content || Array.isArray(content)) {
      throw new Error("模型没有返回可解析的讲解内容。");
    }

    return parseExplanation(content);
  } catch (error) {
    if (requestSignal.signal.aborted) {
      if (input.signal?.aborted) {
        throw new Error("处理时间过长，任务已停止。请减少页数或稍后重试。");
      }

      throw new Error(`第 ${input.pageNumber} 页模型调用超时，请稍后重新生成这一页。`);
    }

    throw error;
  } finally {
    requestSignal.clear();
  }
}

export async function generateSelectionAnswer(input: GenerateSelectionAnswerInput): Promise<string> {
  const client = createClient();
  const model = process.env.HIGHLAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const requestSignal = createRequestSignal(input.signal, input.timeoutMs);
  const selectedText = truncateSelectionContext(input.selectedText.trim(), 4000);
  const pageContext = truncateSelectionContext(input.pageContext?.trim() || "", input.textCharLimit);

  const prompt = `
你正在帮助用户精读一份 slides / PDF 讲解页面。用户会先选中一段“原文”或“AI 生成讲解”，然后提出追问。

文档标题：${input.documentTitle}
页码：${input.pageNumber ? `第 ${input.pageNumber} 页` : "未指定"}
选区来源：${input.sourceLabel || "页面选中文字"}

用户选中的内容：
${selectedText || "(空)"}

本页可参考上下文：
${pageContext || "(没有额外上下文。)"}

用户问题：
${input.question.trim()}

回答要求：
- 用中文回答，直接回应用户问题。
- 重点解释选中的内容，不要泛泛重写整页讲解。
- 如果选区中有英文术语、缩写、公式或论文/课件表达，请保留关键英文并解释中文含义。
- 如果问题超出选区和上下文能支持的范围，请明确说“根据当前选区无法确定”，再给出合理的学习建议或需要补充的信息。
- 回答要细致但克制，适合贴在页面旁边作为学习批注。
`;

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content: "你是耐心、严谨的中文学习答疑助手，擅长围绕用户选中的原文或讲解做局部解释。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      { signal: requestSignal.signal },
    );

    const content = completion.choices[0]?.message?.content;
    if (!content || Array.isArray(content)) {
      throw new Error("模型没有返回可用回答。");
    }

    return content.trim();
  } catch (error) {
    if (requestSignal.signal.aborted) {
      if (input.signal?.aborted) {
        throw new Error("答疑请求已停止，请稍后重试。");
      }

      throw new Error("答疑调用超时，请缩短选中文字或稍后重试。");
    }

    throw error;
  } finally {
    requestSignal.clear();
  }
}
