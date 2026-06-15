import "server-only";

import OpenAI from "openai";
import type { DocumentKind, SlideExplanation } from "./types";
import type { ResolvedAiCredential } from "./user-store";

type GenerateSlideExplanationInput = {
  documentTitle: string;
  documentKind?: DocumentKind;
  pageNumber: number;
  buildContext?: string;
  pageText: string;
  imageDataUrl: string;
  aiCredential?: ResolvedAiCredential;
  signal?: AbortSignal;
  timeoutMs?: number;
  textCharLimit?: number;
};

type GenerateSelectionAnswerInput = {
  documentTitle: string;
  documentKind?: DocumentKind;
  selectedText: string;
  question: string;
  pageNumber?: number;
  sourceLabel?: string;
  pageContext?: string;
  aiCredential?: ResolvedAiCredential;
  signal?: AbortSignal;
  timeoutMs?: number;
  textCharLimit?: number;
};

function serverEnvAiCredential(): ResolvedAiCredential | null {
  const apiKey = process.env.HIGHLAND_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.HIGHLAND_BASE_URL || process.env.OPENAI_BASE_URL;
  const model = process.env.HIGHLAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiKey) return null;

  return {
    provider: process.env.HIGHLAND_API_KEY ? "highland" : "openai-compatible",
    providerLabel: process.env.HIGHLAND_API_KEY ? "Highland" : "OpenAI-compatible",
    apiKey,
    apiKeyLast4: apiKey.slice(-4),
    baseURL: baseURL || undefined,
    model,
    supportsVision: true,
    createdAt: "",
    updatedAt: "",
  };
}

export function getAiConfigStatus(aiCredential?: ResolvedAiCredential | null) {
  if (aiCredential) {
    return {
      configured: true,
      provider: aiCredential.providerLabel,
      model: aiCredential.model,
      hasBaseURL: Boolean(aiCredential.baseURL),
      supportsVision: aiCredential.supportsVision,
      missing: [],
    };
  }

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
    supportsVision: true,
    missing: [
      !apiKeyConfigured ? "HIGHLAND_API_KEY" : "",
      highlandKey && !process.env.HIGHLAND_BASE_URL ? "HIGHLAND_BASE_URL" : "",
    ].filter(Boolean),
  };
}

function createClient(aiCredential?: ResolvedAiCredential | null) {
  const credential = aiCredential ?? serverEnvAiCredential();
  const apiKey = credential?.apiKey;
  const baseURL = credential?.baseURL;

  if (!apiKey) {
    throw new Error("请先在账号设置里配置自己的模型 API Key。");
  }

  if ((credential?.provider === "highland" || credential?.provider === "openai-compatible") && !baseURL) {
    throw new Error("当前模型服务需要配置 Base URL。");
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
    topic: String(parsed.topic || "知识页").trim(),
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

  return `${text.slice(0, maxChars)}\n\n[文字抽取内容较长，后续部分已截断。请主要结合页面图片继续讲解。]`;
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

function kindInstruction(documentKind: DocumentKind | undefined) {
  if (documentKind === "academic_paper") {
    return {
      system: "你是耐心、严谨的中文学术论文精读助手，擅长把英文论文的研究问题、方法、图表、结果和论证链条讲清楚。",
      prompt: `
你正在为中文学习者精读一篇学术论文的某个讲解单元。这个单元可能是一页，也可能是由多个连续源页组成的论文板块。请结合页面图片和已抽取文字，输出严格 JSON。

讲解目标：
- 判断这一页在论文中的角色，例如题目/摘要/引言/方法/结果图/讨论/参考文献/补充材料。
- 把原文或图表真正讲透：研究问题是什么，实验或分析怎么做，变量/坐标/指标是什么意思，结果支持了什么结论。
- 如果页面包含图、表、公式、统计量、缩写或专业术语，要逐一拆解。
- 对论文中容易误读的地方要明确提醒，例如相关不等于因果、解码不等于机制证明、统计显著不等于效应很大。
- 讲解应细粒度、具体、面向正在读顶刊论文的中文学习者。
- 如果讲解单元来源包含多个源页或显示为论文板块，请先说明这个板块在全文论证链条中的作用，再按问题、方法、证据、结论综合解释，不要机械逐页罗列。
`,
    };
  }

  if (documentKind === "knowledge_document") {
    return {
      system: "你是耐心、严谨的中文知识详解助手，擅长把 PDF 文档逐页拆解成可学习、可复习的解释。",
      prompt: `
你正在为中文学习者讲解一页 PDF 知识文档。请结合页面图片和已抽取文字，输出严格 JSON。

讲解目标：
- 先判断这一页的功能，例如封面、目录、概念说明、图表、例题、实验结果或总结。
- 把页面里的关键概念、术语、图示、公式和上下文讲清楚。
- 如果文档像论文，就按论文逻辑解释；如果文档像课件，就按课程学习逻辑解释。
- 讲解应细致、自然、可读，帮助用户继续探索知识点。
`,
    };
  }

  return {
    system: "你是耐心、严谨的中文课程讲解助手，擅长把英文课件逐页讲清楚。",
    prompt: `
你正在为中文学习者讲解一页课程课件。请结合课件页面图片和已抽取文字，输出严格 JSON。

讲解目标：
- 把本页作为课堂学习材料来解释，说明它在课程知识链条中的位置。
- 解释页面里的关键概念、图示、公式、术语和例子。
- 对容易混淆的概念、常见误解和考试/复习时应注意的点做提醒。
- 讲解要面向正在复习课件的本科生，细致、自然、可读。
`,
  };
}

export async function generateSlideExplanation(input: GenerateSlideExplanationInput): Promise<SlideExplanation> {
  if (input.aiCredential && !input.aiCredential.supportsVision) {
    throw new Error("当前模型配置未标记为支持图像输入，无法生成页面详解。请在 API 设置里选择视觉模型。");
  }

  const client = createClient(input.aiCredential);
  const model = input.aiCredential?.model || process.env.HIGHLAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const requestSignal = createRequestSignal(input.signal, input.timeoutMs);
  const pageText = truncateText(input.pageText, input.textCharLimit);
  const instruction = kindInstruction(input.documentKind);

  const prompt = `
${instruction.prompt}

文档标题：${input.documentTitle}
代表页码：${input.pageNumber}
讲解单元来源：${input.buildContext || `原 PDF 第 ${input.pageNumber} 页。`}
讲解单元抽取文字：
${pageText || "(这一页没有抽取到可读文字，请主要依据图片内容。)"}

JSON 字段：
- title: 中文标题，概括这一页或这个讲解单元。
- topic: 1 到 5 个词的页内主题，可保留英文术语。
- keyPoints: 字符串数组，说明原页要点。
- detailedExplanation: 字符串数组，用中文详细解释本页概念、图示、公式、术语和上下文。
- confusionPoints: 字符串数组，指出容易混淆点或常见误解。
- remember: 一个中文字符串，总结“这一页要记住什么”。

要求：
- 只输出 JSON，不要 Markdown。
- 不要编造页面和文档外无法支持的具体事实；可以做必要背景解释，但要和本页内容紧密相关。
- 如果页面包含英文术语，请保留关键英文并解释中文含义。
- 如果页面包含数学、信号、概率、矩阵、递推、下标/上标或希腊字母，请在 JSON 字符串中用 LaTeX 表达公式：行内公式写成 $a_t$, $x^{(i)}$, $\\alpha$, $P(y\\mid x)$；较长公式写成 $$...$$。不要把公式写成 a_t、x^i 这种纯文本。
- 解释公式时先给出原公式，再逐项说明变量含义；如果原页有公式，尽量保留其数学形式而不是只用中文改写。
- 如果讲解单元来源显示多个构建帧、逐步展开页或相关页面组，请把它们作为一个连续知识单元讲解：以最后一帧图片为主，同时覆盖抽取文字里列出的所有源页，不要机械重复每一帧。
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
            content: instruction.system,
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
  const client = createClient(input.aiCredential);
  const model = input.aiCredential?.model || process.env.HIGHLAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const requestSignal = createRequestSignal(input.signal, input.timeoutMs);
  const selectedText = truncateSelectionContext(input.selectedText.trim(), 4000);
  const pageContext = truncateSelectionContext(input.pageContext?.trim() || "", input.textCharLimit);
  const documentKindLabel =
    input.documentKind === "academic_paper"
      ? "学术论文"
      : input.documentKind === "course_slides"
        ? "课程课件"
        : "知识文档";

  const prompt = `
你正在帮助用户精读一份${documentKindLabel}的讲解页面。用户会先选中一段“原文”或“AI 生成讲解”，然后提出追问。

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
- 如果回答里需要写公式，请使用 LaTeX：行内公式写成 $a_t$，长公式写成 $$...$$，不要用 a_t 这种纯文本替代。
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
