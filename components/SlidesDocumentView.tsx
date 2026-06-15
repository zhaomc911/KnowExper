"use client";

import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  UploadCloud,
  X,
} from "lucide-react";
import katex from "katex";
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { documentKindLabels } from "@/lib/document-kind";
import {
  fallbackExplanation,
  type DocumentKind,
  type ProcessEvent,
  type SlideExplanation,
  type SlideResult,
  type SlideSourcePage,
  type StoredDocumentStatus,
} from "@/lib/types";

const BETA_ACCESS_HEADER = "x-beta-access-code";
const ACCESS_STORAGE_KEY = "knowexper-beta-access-code";
const MAX_SELECTED_TEXT_CHARS = 4000;
const MAX_QUESTION_CHARS = 800;

type SelectionState = {
  text: string;
  pageNumber?: number;
  sourceLabel: string;
  pageContext: string;
  x: number;
  y: number;
};

type QaMessage = {
  id: string;
  selectedText: string;
  question: string;
  sourceLabel: string;
  pageNumber?: number;
  answer?: string;
  error?: string;
  loading: boolean;
};

type QaPanelState = {
  open: boolean;
  x: number;
  y: number;
  selectedText: string;
  sourceLabel: string;
  pageNumber?: number;
  pageContext: string;
  question: string;
  messages: QaMessage[];
};

const initialQaPanel: QaPanelState = {
  open: false,
  x: 24,
  y: 92,
  selectedText: "",
  sourceLabel: "页面选中文字",
  pageContext: "",
  question: "",
  messages: [],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizedSelectionText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

type MathSegment =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "math";
      value: string;
      displayMode: boolean;
    };

function mathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^\n$]+?\$)/g;
  let lastIndex = 0;

  function pushTextSegments(value: string) {
    const bareMathPattern = /(^|[^A-Za-z0-9_])([A-Za-zα-ωΑ-Ω]{1,3}(?:(?:_\{?[A-Za-z0-9]{1,8}\}?)|(?:\^\{?[A-Za-z0-9]{1,8}\}?))+)/g;
    let textLastIndex = 0;

    for (const match of value.matchAll(bareMathPattern)) {
      const token = match[2];
      const index = (match.index ?? 0) + match[1].length;
      if (index > textLastIndex) {
        segments.push({ type: "text", value: value.slice(textLastIndex, index) });
      }
      segments.push({ type: "math", value: token, displayMode: false });
      textLastIndex = index + token.length;
    }

    if (textLastIndex < value.length) {
      segments.push({ type: "text", value: value.slice(textLastIndex) });
    }
  }

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      pushTextSegments(text.slice(lastIndex, index));
    }

    if (token.startsWith("$$") && token.endsWith("$$")) {
      segments.push({ type: "math", value: token.slice(2, -2).trim(), displayMode: true });
    } else if (token.startsWith("\\[") && token.endsWith("\\]")) {
      segments.push({ type: "math", value: token.slice(2, -2).trim(), displayMode: true });
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      segments.push({ type: "math", value: token.slice(2, -2).trim(), displayMode: false });
    } else {
      segments.push({ type: "math", value: token.slice(1, -1).trim(), displayMode: false });
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    pushTextSegments(text.slice(lastIndex));
  }

  return segments.length ? segments : [{ type: "text", value: text }];
}

function renderLatex(value: string, displayMode: boolean) {
  return katex.renderToString(value, {
    displayMode,
    output: "htmlAndMathml",
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
}

function MathText({ text }: { text: string }) {
  return (
    <>
      {mathSegments(text).map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`${segment.value}-${index}`}>{segment.value}</span>;
        }

        return (
          <span
            key={`${segment.value}-${index}`}
            className={segment.displayMode ? "math-block" : "math-inline"}
            dangerouslySetInnerHTML={{ __html: renderLatex(segment.value, segment.displayMode) }}
          />
        );
      })}
    </>
  );
}

function slidePageLabel(slide: SlideResult) {
  if (slide.buildFrameRange && slide.buildFrameRange.frameCount > 1) {
    return `${slide.buildFrameRange.startPage}-${slide.buildFrameRange.endPage}`;
  }

  return String(slide.pageNumber);
}

function cleanUnitTitle(value: string | undefined) {
  const title = value?.replace(/\s+/g, " ").trim();
  if (!title || title === "知识页" || title === "这一页讲什么") return "";

  return title;
}

function readablePaperSectionTitle(sectionName: string) {
  if (sectionName.includes("题目") || sectionName.includes("摘要")) return "总论点";
  if (sectionName.includes("背景") || sectionName.includes("相关工作")) return "背景争论";
  if (sectionName.includes("引言")) return "引言";
  if (sectionName.includes("方法") || sectionName.includes("模型") || sectionName.includes("算法")) return "方法 / 模型";
  if (sectionName.includes("实验") || sectionName.includes("结果") || sectionName.includes("评估")) return "实验 / 结果";
  if (sectionName.includes("讨论") || sectionName.includes("结论")) return "讨论 / 结论";
  if (sectionName.includes("参考文献")) return "参考文献";
  if (sectionName.includes("附录") || sectionName.includes("补充材料")) return "附录 / 补充材料";

  return sectionName;
}

function unitTitleFromBuildContext(context: string | undefined) {
  if (!context) return "";

  const paperMatch = context.match(/论文板块「([^」]+)」/);
  if (paperMatch?.[1]) return readablePaperSectionTitle(paperMatch[1]);

  if (context.includes("课程小主题")) return "课程小主题";
  if (context.includes("构建帧")) return "构建帧";

  return "";
}

function slideUnitTitle(slide: SlideResult) {
  return (
    cleanUnitTitle(slide.unitTitle) ||
    cleanUnitTitle(slide.explanation?.topic) ||
    cleanUnitTitle(slide.explanation?.title) ||
    cleanUnitTitle(unitTitleFromBuildContext(slide.buildContext)) ||
    slidePageLabel(slide)
  );
}

function slideNavLabel(slide: SlideResult, index: number) {
  const title = slideUnitTitle(slide);
  const pageLabel = slidePageLabel(slide);

  if (!title || title === pageLabel) return pageLabel;

  return `${index + 1}. ${title}`;
}

function slideSourceText(slide: SlideResult) {
  if (slide.buildFrameRange && slide.buildFrameRange.frameCount > 1) {
    const unit = slide.buildFrameRange.kind === "topic" ? "页" : "帧";
    return `源页 ${slide.buildFrameRange.startPage}-${slide.buildFrameRange.endPage} · ${slide.buildFrameRange.frameCount} ${unit}`;
  }

  return `源页 ${slide.pageNumber}`;
}

function buildFrameNote(slide: SlideResult) {
  if (!slide.buildFrameRange || slide.buildFrameRange.frameCount <= 1) return "";

  const hasSourcePageImages = (slide.sourcePages?.length || 0) > 1;
  const imageNote = hasSourcePageImages ? "右侧可上下滚动查看本单元全部源页。" : "当前结果只保存了代表页，右侧显示代表页。";

  if (slide.buildFrameRange.kind === "topic") {
    return `已将原 PDF 第 ${slide.buildFrameRange.startPage}-${slide.buildFrameRange.endPage} 页的连续相关内容合并为一个讲解单元，共 ${slide.buildFrameRange.frameCount} 个源页；${imageNote}`;
  }

  return `已合并原 PDF 第 ${slide.buildFrameRange.startPage}-${slide.buildFrameRange.endPage} 页，共 ${slide.buildFrameRange.frameCount} 个逐步展开/高亮帧；${imageNote}`;
}

function sourcePagesForSlide(slide: SlideResult): SlideSourcePage[] {
  if (slide.sourcePages?.length) return slide.sourcePages;

  return [
    {
      pageNumber: slide.pageNumber,
      width: slide.width,
      height: slide.height,
      imageDataUrl: slide.imageDataUrl,
      title: slideUnitTitle(slide),
    },
  ];
}

function hasCollapsedBuildFrames(slides: SlideResult[]) {
  return slides.some((slide) => Boolean(slide.buildFrameRange && slide.buildFrameRange.frameCount > 1));
}

function pageNumberFromHash(slides: SlideResult[]) {
  if (typeof window === "undefined") return null;

  const pageNumber = Number(window.location.hash.replace(/^#p/, ""));
  if (!Number.isFinite(pageNumber)) return null;

  return slides.some((slide) => slide.pageNumber === pageNumber) ? pageNumber : null;
}

function findSelectableElement(node: Node | null): HTMLElement | null {
  let current: Node | null = node;

  if (current?.nodeType === Node.TEXT_NODE) {
    current = current.parentElement;
  }

  while (current) {
    if (current instanceof HTMLElement && current.dataset.selectableContext === "true") {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function renderList(items: string[]) {
  if (items.length <= 1) {
    return (
      <p>
        <MathText text={items[0]} />
      </p>
    );
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>
          <MathText text={item} />
        </li>
      ))}
    </ul>
  );
}

function renderAnswer(answer: string) {
  return answer
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => (
      <p key={`${paragraph}-${index}`}>
        <MathText text={paragraph} />
      </p>
    ));
}

type DialogState = {
  open: boolean;
  imageDataUrl: string;
  title: string;
  alt: string;
};

const initialDialog: DialogState = {
  open: false,
  imageDataUrl: "",
  title: "原图预览",
  alt: "",
};

function ExplanationArticle({
  slide,
  title,
  documentKind,
  onRegenerate,
  regenerating,
}: {
  slide: SlideResult;
  title: string;
  documentKind?: DocumentKind;
  onRegenerate: (slide: SlideResult) => void;
  regenerating: boolean;
}) {
  const explanation = slide.explanation ?? fallbackExplanation;
  const pageLabel = slidePageLabel(slide);
  const unitTitle = slideUnitTitle(slide);
  const note = buildFrameNote(slide);
  const copy =
    documentKind === "academic_paper"
      ? {
          keyPoints: "原文 / 图表要点",
          detailed: "细读解释",
          confusion: "容易误读点",
          remember: "这一页要记住",
        }
      : documentKind === "knowledge_document"
        ? {
            keyPoints: "页面要点",
            detailed: "详细解释",
            confusion: "容易混淆点",
            remember: "这一页要记住",
          }
        : {
            keyPoints: "原页要点",
            detailed: "详细解释",
            confusion: "容易混淆点",
            remember: "这一页要记住",
          };

  return (
    <article
      className="explain"
      data-page-number={slide.pageNumber}
      data-selectable-context="true"
      data-source-label={`源页 ${pageLabel} ${unitTitle} AI 讲解`}
    >
      <div className="eyeline">
        <span className="page-number">{pageLabel}</span>
        <span>
          <MathText text={unitTitle || explanation.topic} />
        </span>
      </div>

      <div className="explain-heading">
        <h2>
          <MathText text={explanation.title} />
        </h2>
        <button className="icon-text-button secondary" type="button" onClick={() => onRegenerate(slide)} disabled={regenerating}>
          {regenerating ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <span>{regenerating ? "生成中" : "重新生成"}</span>
        </button>
      </div>

      {slide.error ? (
        <div className="inline-error">
          <AlertCircle aria-hidden="true" />
          <span>{slide.error}</span>
        </div>
      ) : null}

      {note ? <p className="build-frame-note">{note}</p> : null}

      <h3>{copy.keyPoints}</h3>
      {renderList(explanation.keyPoints)}

      <h3>{copy.detailed}</h3>
      {explanation.detailedExplanation.map((paragraph, index) => (
        <p key={`${paragraph}-${index}`}>
          <MathText text={paragraph} />
        </p>
      ))}

      <h3>{copy.confusion}</h3>
      {renderList(explanation.confusionPoints)}

      <div className="takeaway">
        <strong>{copy.remember}</strong>
        <MathText text={explanation.remember} />
      </div>

      <p className="sr-only">{title}</p>
    </article>
  );
}

function SourcePagesPanel({
  slide,
  title,
  onOpenImage,
}: {
  slide: SlideResult;
  title: string;
  onOpenImage: (dialog: DialogState) => void;
}) {
  const sourcePages = sourcePagesForSlide(slide);
  const unitTitle = slideUnitTitle(slide);
  const pageLabel = slidePageLabel(slide);
  const sourceText = slideSourceText(slide);

  return (
    <aside className="slide-column">
      <div className={`source-pages ${sourcePages.length > 1 ? "has-multiple" : ""}`}>
        {sourcePages.map((sourcePage, index) => {
          const sourceLabel =
            sourcePages.length > 1
              ? `PDF page ${sourcePage.pageNumber}`
              : sourceText;
          const imageTitle = sourcePage.title || unitTitle;

          return (
            <section className="source-page-card" key={`${slide.pageNumber}-${sourcePage.pageNumber}`}>
              <div className="source-page-head">
                <div className="source-page-title">
                  <strong title={imageTitle}>{imageTitle}</strong>
                  <span>
                    {sourceLabel}
                    {sourcePages.length > 1 ? ` · ${index + 1}/${sourcePages.length}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onOpenImage({
                      open: true,
                      imageDataUrl: sourcePage.imageDataUrl,
                      title: `源页 ${sourcePage.pageNumber} 原图`,
                      alt: `${title} 源页 ${sourcePage.pageNumber}`,
                    })
                  }
                >
                  <ImageIcon aria-hidden="true" />
                  <span>打开原图</span>
                </button>
              </div>
              <figure className="slide-frame source-page-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourcePage.imageDataUrl} alt={`${title} 源页 ${sourcePage.pageNumber || pageLabel}`} />
              </figure>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

export function SlidesDocumentView({
  title,
  slides,
  documentKind = "knowledge_document",
  documentId,
  documentUrl,
  expectedPageCount,
  initialStatus,
  initialLastError = "",
  accessCode = "",
  onReset,
}: {
  title: string;
  slides: SlideResult[];
  documentKind?: DocumentKind;
  documentId?: string;
  documentUrl?: string;
  expectedPageCount?: number;
  initialStatus?: StoredDocumentStatus;
  initialLastError?: string;
  accessCode?: string;
  onReset?: () => void;
}) {
  const [currentSlides, setCurrentSlides] = useState(slides);
  const [dialog, setDialog] = useState<DialogState>(initialDialog);
  const [activePage, setActivePage] = useState<number | null>(slides[0]?.pageNumber ?? null);
  const [error, setError] = useState("");
  const [documentStatus, setDocumentStatus] = useState<StoredDocumentStatus | undefined>(initialStatus);
  const [serverPageCount, setServerPageCount] = useState(expectedPageCount);
  const [lastError, setLastError] = useState(initialLastError);
  const [storedAccessCode, setStoredAccessCode] = useState("");
  const [resumeActive, setResumeActive] = useState(false);
  const [resumeMessage, setResumeMessage] = useState("");
  const [regeneratingPages, setRegeneratingPages] = useState<Set<number>>(new Set());
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [qaPanel, setQaPanel] = useState<QaPanelState>(initialQaPanel);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const activeNavItemRef = useRef<HTMLAnchorElement | null>(null);
  const sortedSlidesRef = useRef<SlideResult[]>(slides);
  const lastHashScrollRef = useRef("");

  const sortedSlides = useMemo(() => [...currentSlides].sort((a, b) => a.pageNumber - b.pageNumber), [currentSlides]);
  const hasBuildFrames = useMemo(() => hasCollapsedBuildFrames(sortedSlides), [sortedSlides]);
  const totalPages = Math.max(serverPageCount || 0, sortedSlides.length);
  const completedPages = sortedSlides.filter((slide) => slide.explanation).length;
  const completionPercent = totalPages ? Math.round((completedPages / totalPages) * 100) : 0;
  const isComplete = totalPages > 0 && completedPages >= totalPages && (documentStatus ?? "complete") === "complete";
  const unitLabel = documentKind === "academic_paper" || hasBuildFrames ? " 个讲解单元" : " 页";
  const qaLoading = qaPanel.messages.some((message) => message.loading);
  const requestAccessCode = accessCode.trim() || storedAccessCode.trim();

  useEffect(() => {
    sortedSlidesRef.current = sortedSlides;
  }, [sortedSlides]);

  useEffect(() => {
    if (accessCode.trim()) {
      setStoredAccessCode(accessCode.trim());
      return;
    }

    try {
      setStoredAccessCode(window.localStorage.getItem(ACCESS_STORAGE_KEY)?.trim() ?? "");
    } catch {
      setStoredAccessCode("");
    }
  }, [accessCode]);

  useEffect(() => {
    const hashPage = pageNumberFromHash(slides);

    setCurrentSlides(slides);
    setDocumentStatus(initialStatus);
    setServerPageCount(expectedPageCount);
    setLastError(initialLastError);
    setActivePage(hashPage ?? slides[0]?.pageNumber ?? null);
  }, [slides, expectedPageCount, initialStatus, initialLastError]);

  useEffect(() => {
    if (!documentId || isComplete || resumeActive) return undefined;

    let cancelled = false;

    async function refreshStoredDocument() {
      try {
        const response = await fetch(`/api/documents/${documentId}`, {
          headers: requestAccessCode ? { [BETA_ACCESS_HEADER]: requestAccessCode } : undefined,
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          document?: {
            slides?: SlideResult[];
            pageCount?: number;
            status?: StoredDocumentStatus;
            lastError?: string;
          };
        };
        if (cancelled || !data.document?.slides?.length) return;

        setCurrentSlides(data.document.slides);
        setServerPageCount(data.document.pageCount ?? data.document.slides.length);
        setDocumentStatus(data.document.status);
        setLastError(data.document.lastError || "");
      } catch {
        // Polling is best-effort; visible errors should come from explicit user actions.
      }
    }

    void refreshStoredDocument();
    const interval = window.setInterval(refreshStoredDocument, documentStatus === "processing" ? 3000 : 12000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [requestAccessCode, documentId, documentStatus, isComplete, resumeActive]);

  useEffect(() => {
    if (!sortedSlides.length) return undefined;

    let frame = 0;
    let timer = 0;

    function syncHashPage(shouldScroll: boolean) {
      const currentSlidesForHash = sortedSlidesRef.current;
      const hashPage = pageNumberFromHash(currentSlidesForHash);
      if (!hashPage) return;

      setActivePage(hashPage);
      if (!shouldScroll) return;

      frame = window.requestAnimationFrame(() => {
        document.getElementById(`p${hashPage}`)?.scrollIntoView({ block: "start" });
      });
      timer = window.setTimeout(() => {
        document.getElementById(`p${hashPage}`)?.scrollIntoView({ block: "start" });
        setActivePage(hashPage);
      }, 260);
    }

    const currentHash = window.location.hash;
    const shouldInitialScroll = Boolean(currentHash && currentHash !== lastHashScrollRef.current);
    if (shouldInitialScroll) {
      lastHashScrollRef.current = currentHash;
    }
    syncHashPage(shouldInitialScroll);

    function handleHashChange() {
      lastHashScrollRef.current = window.location.hash;
      syncHashPage(true);
    }

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [sortedSlides.length]);

  useEffect(() => {
    if (!sortedSlides.length) return undefined;

    const sections = Array.from(document.querySelectorAll<HTMLElement>(".page-pair"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const next = Number(visible.target.id.replace("p", ""));
        setActivePage(next);
      },
      {
        rootMargin: "-18% 0px -58% 0px",
        threshold: [0.1, 0.25, 0.45, 0.65],
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [sortedSlides.length]);

  useEffect(() => {
    if (!dialog.open) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDialog(initialDialog);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialog.open]);

  useEffect(() => {
    activeNavItemRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activePage]);

  useEffect(() => {
    function movePanel(event: globalThis.PointerEvent) {
      if (!dragOffsetRef.current) return;

      const panelWidth = Math.min(440, window.innerWidth - 24);
      const nextX = clamp(event.clientX - dragOffsetRef.current.x, 12, window.innerWidth - panelWidth - 12);
      const nextY = clamp(event.clientY - dragOffsetRef.current.y, 12, window.innerHeight - 88);

      setQaPanel((current) => ({
        ...current,
        x: nextX,
        y: nextY,
      }));
    }

    function stopDragging() {
      dragOffsetRef.current = null;
    }

    window.addEventListener("pointermove", movePanel);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", movePanel);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  useEffect(() => {
    if (!qaPanel.open) return undefined;

    function keepPanelInViewport() {
      const panelWidth = Math.min(440, window.innerWidth - 24);

      setQaPanel((current) => ({
        ...current,
        x: clamp(current.x, 12, window.innerWidth - panelWidth - 12),
        y: clamp(current.y, 12, window.innerHeight - 88),
      }));
    }

    window.addEventListener("resize", keepPanelInViewport);
    return () => window.removeEventListener("resize", keepPanelInViewport);
  }, [qaPanel.open]);

  function updateSelectionFromWindow() {
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionState(null);
      return;
    }

    const selectedText = normalizedSelectionText(selection.toString());
    if (!selectedText) {
      setSelectionState(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const selectableElement = findSelectableElement(range.commonAncestorContainer) ?? findSelectableElement(selection.anchorNode);

    if (!selectableElement) {
      setSelectionState(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setSelectionState(null);
      return;
    }

    const pageNumber = Number(selectableElement.dataset.pageNumber);
    const sourceLabel = selectableElement.dataset.sourceLabel || "页面选中文字";
    const pageContext = selectableElement.innerText.trim();
    const x = clamp(rect.right + 10, 12, window.innerWidth - 104);
    const y = clamp(rect.top - 6, 12, window.innerHeight - 52);

    setSelectionState({
      text: selectedText.slice(0, MAX_SELECTED_TEXT_CHARS),
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : undefined,
      sourceLabel,
      pageContext,
      x,
      y,
    });
  }

  function handleSelectionChange() {
    window.setTimeout(updateSelectionFromWindow, 0);
  }

  function openQuestionPanel() {
    if (!selectionState) return;

    const panelWidth = Math.min(440, window.innerWidth - 24);
    const x = clamp(selectionState.x, 12, window.innerWidth - panelWidth - 12);
    const y = clamp(selectionState.y + 44, 12, window.innerHeight - 260);

    setQaPanel((current) => ({
      ...current,
      open: true,
      x,
      y,
      selectedText: selectionState.text,
      sourceLabel: selectionState.sourceLabel,
      pageNumber: selectionState.pageNumber,
      pageContext: selectionState.pageContext,
      question: "",
    }));
    setSelectionState(null);
  }

  function startPanelDrag(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragOffsetRef.current = {
      x: event.clientX - qaPanel.x,
      y: event.clientY - qaPanel.y,
    };
  }

  function scrollNav(direction: -1 | 1) {
    const nav = navRef.current;
    if (!nav) return;

    nav.scrollBy({
      left: direction * Math.max(220, nav.clientWidth * 0.72),
      behavior: "smooth",
    });
  }

  async function submitSelectionQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = qaPanel.question.trim();
    const selectedText = qaPanel.selectedText.trim();
    if (!question || !selectedText || qaLoading) return;

    const messageId = createClientId();
    const message: QaMessage = {
      id: messageId,
      selectedText,
      question,
      sourceLabel: qaPanel.sourceLabel,
      pageNumber: qaPanel.pageNumber,
      loading: true,
    };

    setQaPanel((current) => ({
      ...current,
      question: "",
      messages: [...current.messages, message],
    }));

    try {
      const response = await fetch("/api/ask-selection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestAccessCode ? { [BETA_ACCESS_HEADER]: requestAccessCode } : {}),
        },
        body: JSON.stringify({
          documentTitle: title,
          documentKind,
          pageNumber: qaPanel.pageNumber,
          sourceLabel: qaPanel.sourceLabel,
          selectedText,
          question,
          pageContext: qaPanel.pageContext,
        }),
      });

      const data = (await response.json()) as { answer?: string; error?: string };

      if (!response.ok || !data.answer) {
        throw new Error(data.error || "提问失败，请稍后重试。");
      }

      setQaPanel((current) => ({
        ...current,
        messages: current.messages.map((item) =>
          item.id === messageId
            ? {
                ...item,
                answer: data.answer,
                loading: false,
              }
            : item,
        ),
      }));
    } catch (nextError) {
      setQaPanel((current) => ({
        ...current,
        messages: current.messages.map((item) =>
          item.id === messageId
            ? {
                ...item,
                error: nextError instanceof Error ? nextError.message : "提问失败，请稍后重试。",
                loading: false,
              }
            : item,
        ),
      }));
    }
  }

  function upsertSlide(slide: SlideResult) {
    setCurrentSlides((current) => {
      const next = current.filter((item) => item.pageNumber !== slide.pageNumber);
      next.push(slide);
      return next.sort((a, b) => a.pageNumber - b.pageNumber);
    });
  }

  async function resumeMissingExplanations() {
    if (!documentId || resumeActive || isComplete) return;

    setResumeActive(true);
    setResumeMessage("正在准备继续生成。");
    setDocumentStatus("processing");
    setError("");

    try {
      const response = await fetch(`/api/documents/${documentId}/resume`, {
        method: "POST",
        headers: requestAccessCode ? { [BETA_ACCESS_HEADER]: requestAccessCode } : undefined,
      });

      if (!response.body) {
        throw new Error("浏览器没有收到继续生成的处理流。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ProcessEvent;

          if (event.type === "progress") {
            setResumeMessage(event.message);
          }

          if (event.type === "meta") {
            setDocumentStatus(event.status);
            setServerPageCount(event.pageCount);
            setLastError("");
          }

          if (event.type === "page") {
            upsertSlide(event.slide);
          }

          if (event.type === "done") {
            setCurrentSlides(event.slides);
            setServerPageCount(event.slides.length);
            setDocumentStatus(event.status);
            setLastError("");
            setResumeMessage(event.status === "complete" ? "精讲已全部完成。" : "已保存当前进度。");
          }

          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "继续生成失败，请稍后重试。";
      setDocumentStatus("partial");
      setLastError(message);
      setError(message);
    } finally {
      setResumeActive(false);
    }
  }

  async function regenerateSlide(slide: SlideResult) {
    setRegeneratingPages((current) => new Set(current).add(slide.pageNumber));
    setError("");

    try {
      const response = await fetch("/api/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestAccessCode ? { [BETA_ACCESS_HEADER]: requestAccessCode } : {}),
        },
        body: JSON.stringify({
          documentId,
          documentTitle: title,
          documentKind,
          pageNumber: slide.pageNumber,
          buildContext: slide.buildContext,
          pageText: slide.text,
          imageDataUrl: slide.imageDataUrl,
        }),
      });

      const data = (await response.json()) as { explanation?: SlideExplanation; error?: string };

      if (!response.ok || !data.explanation) {
        throw new Error(data.error || "重新生成失败。");
      }

      upsertSlide({ ...slide, explanation: data.explanation, error: undefined });
    } catch (nextError) {
      upsertSlide({
        ...slide,
        error: nextError instanceof Error ? nextError.message : "重新生成失败。",
      });
    } finally {
      setRegeneratingPages((current) => {
        const next = new Set(current);
        next.delete(slide.pageNumber);
        return next;
      });
    }
  }

  const generationActive = resumeActive || documentStatus === "processing";
  const incompleteCount = Math.max(0, totalPages - completedPages);
  const visibleLastError = lastError.includes("Controller is already closed") || lastError.includes("controller")
    ? ""
    : lastError;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="top-title">
            <h1 title={title}>{title}</h1>
            <span>
              {documentKindLabels[documentKind]} · {completedPages}/{totalPages}
              {unitLabel}
            </span>
          </div>
          <div className="nav-shell" aria-label="讲解单元导航">
            <button className="nav-scroll-button" type="button" aria-label="向左查看讲解单元" onClick={() => scrollNav(-1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <nav className="nav" ref={navRef} aria-label="讲解单元">
              {sortedSlides.map((slide, index) => {
                const navLabel = slideNavLabel(slide, index);

                return (
                  <a
                    key={slide.pageNumber}
                    ref={activePage === slide.pageNumber ? activeNavItemRef : null}
                    href={`#p${slide.pageNumber}`}
                    className={activePage === slide.pageNumber ? "active" : ""}
                    title={`源页 ${slidePageLabel(slide)} · ${slideUnitTitle(slide)}`}
                    onClick={() => setActivePage(slide.pageNumber)}
                  >
                    <span className="nav-label">{navLabel}</span>
                  </a>
                );
              })}
            </nav>
            <button className="nav-scroll-button" type="button" aria-label="向右查看讲解单元" onClick={() => scrollNav(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className="top-actions">
            <a className="top-action" href="/">
              <ArrowLeft aria-hidden="true" />
              <span>返回首页</span>
            </a>
            <button
              className={`completion-status ${isComplete ? "is-complete" : "is-partial"}`}
              type="button"
              aria-live="polite"
              aria-label={isComplete ? "全部精讲已生成完毕" : `精讲生成进度 ${completedPages}/${totalPages}`}
            >
              {isComplete ? <CheckCircle2 aria-hidden="true" /> : <Loader2 className={generationActive ? "spin" : undefined} aria-hidden="true" />}
              <span>
                {isComplete
                  ? "精讲已完成"
                  : generationActive
                    ? `生成中 ${completedPages}/${totalPages}`
                    : `精讲 ${completedPages}/${totalPages}`}
              </span>
              {!isComplete ? (
                <span className="completion-track" aria-hidden="true">
                  <span style={{ width: `${completionPercent}%` }} />
                </span>
              ) : null}
            </button>
            {documentId && !isComplete ? (
              <button className="top-action" type="button" onClick={() => void resumeMissingExplanations()} disabled={resumeActive}>
                {resumeActive ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                <span>{resumeActive ? "生成中" : "继续生成"}</span>
              </button>
            ) : null}
            {documentUrl ? (
              <a className="top-action" href={documentUrl}>
                <span>保存链接</span>
              </a>
            ) : null}
            {onReset ? (
              <button className="top-action" type="button" onClick={onReset}>
                <UploadCloud aria-hidden="true" />
                <span>重新上传</span>
              </button>
            ) : (
              <a className="top-action" href="/">
                <UploadCloud aria-hidden="true" />
                <span>上传新文档</span>
              </a>
            )}
          </div>
        </div>
      </header>

      <main onKeyUp={handleSelectionChange} onMouseUp={handleSelectionChange}>
        {documentUrl ? (
          <div className="saved-document-banner">
            <strong>已保存</strong>
            <span>以后可直接打开这个链接查看，不需要再次上传同一份文档。</span>
            <a href={documentUrl}>{documentUrl}</a>
          </div>
        ) : null}

        {!isComplete ? (
          <div className={`saved-document-banner ${generationActive ? "is-processing" : "is-warning"}`}>
            <strong>{generationActive ? "正在生成" : "未完成"}</strong>
            <span>
              {generationActive
                ? resumeMessage || `正在补齐剩余 ${incompleteCount} 个讲解单元，页面会自动更新。`
                : `还有 ${incompleteCount} 个讲解单元没有精讲。点击顶部“继续生成”即可从已保存进度后继续，不需要重新上传。`}
            </span>
            {visibleLastError ? <span>最近停止原因：{visibleLastError}</span> : null}
          </div>
        ) : null}

        {error ? (
          <div className="floating-error">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {sortedSlides.map((slide) => {
          return (
            <section id={`p${slide.pageNumber}`} className="page-pair" key={slide.pageNumber}>
              <ExplanationArticle
                slide={slide}
                title={title}
                documentKind={documentKind}
                onRegenerate={(nextSlide) => void regenerateSlide(nextSlide)}
                regenerating={regeneratingPages.has(slide.pageNumber)}
              />

              <SourcePagesPanel slide={slide} title={title} onOpenImage={setDialog} />
            </section>
          );
        })}
      </main>

      {selectionState ? (
        <button
          className="selection-ask-button"
          type="button"
          style={{ left: selectionState.x, top: selectionState.y }}
          onClick={openQuestionPanel}
          onMouseDown={(event) => event.preventDefault()}
        >
          <MessageCircle aria-hidden="true" />
          <span>提问</span>
        </button>
      ) : null}

      {qaPanel.open ? (
        <section className="qa-panel" style={{ left: qaPanel.x, top: qaPanel.y }} aria-label="选中内容提问浮窗">
          <div className="qa-panel-header" onPointerDown={startPanelDrag}>
            <div className="qa-panel-title">
              <GripVertical aria-hidden="true" />
              <span>选中提问</span>
            </div>
            <button
              className="qa-panel-close"
              type="button"
              aria-label="关闭选中提问"
              onClick={() => setQaPanel((current) => ({ ...current, open: false }))}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="qa-panel-body">
            <div className="qa-selected-block">
              <div className="qa-selected-meta">
                <span>{qaPanel.sourceLabel}</span>
                {qaPanel.pageNumber ? <strong>第 {qaPanel.pageNumber} 页</strong> : null}
              </div>
              <blockquote>{qaPanel.selectedText}</blockquote>
            </div>

            <form className="qa-question-form" onSubmit={(event) => void submitSelectionQuestion(event)}>
              <textarea
                value={qaPanel.question}
                maxLength={MAX_QUESTION_CHARS}
                placeholder="围绕这段内容继续问..."
                onChange={(event) =>
                  setQaPanel((current) => ({
                    ...current,
                    question: event.target.value,
                  }))
                }
              />
              <button className="qa-send-button" type="submit" disabled={!qaPanel.question.trim() || qaLoading}>
                {qaLoading ? <Loader2 className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                <span>{qaLoading ? "思考中" : "发送"}</span>
              </button>
            </form>

            <div className="qa-answer-list">
              {qaPanel.messages.length ? (
                qaPanel.messages.map((message) => (
                  <article className="qa-answer-card" key={message.id}>
                    <div className="qa-answer-meta">
                      <span>{message.sourceLabel}</span>
                      {message.pageNumber ? <strong>第 {message.pageNumber} 页</strong> : null}
                    </div>
                    <p className="qa-question-text">问：{message.question}</p>
                    <blockquote>{message.selectedText}</blockquote>
                    <div className={`qa-answer-body ${message.error ? "is-error" : ""}`}>
                      {message.loading ? (
                        <span className="qa-loading">
                          <Loader2 className="spin" aria-hidden="true" />
                          正在生成回答...
                        </span>
                      ) : message.error ? (
                        message.error
                      ) : message.answer ? (
                        renderAnswer(message.answer)
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="qa-empty">输入问题后，回答会保留在这个浮窗里。</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <div className={`image-dialog ${dialog.open ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-label="原图预览" onClick={() => setDialog(initialDialog)}>
        <div className="image-dialog-panel" onClick={(event) => event.stopPropagation()}>
          <div className="image-dialog-header">
            <span>{dialog.title}</span>
            <button className="image-dialog-close" type="button" aria-label="关闭原图预览" onClick={() => setDialog(initialDialog)}>
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="image-dialog-body">
            {dialog.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dialog.imageDataUrl} alt={dialog.alt} />
            ) : null}
          </div>
        </div>
      </div>

      {!error && isComplete ? (
        <div className="completion-toast">
          <CheckCircle2 aria-hidden="true" />
          <span>精讲已完成</span>
        </div>
      ) : null}
    </>
  );
}
