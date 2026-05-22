"use client";

import {
  AlertCircle,
  CheckCircle2,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { documentKindLabels } from "@/lib/document-kind";
import { fallbackExplanation, type DocumentKind, type SlideExplanation, type SlideResult } from "@/lib/types";

const BETA_ACCESS_HEADER = "x-beta-access-code";
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
    return <p>{items[0]}</p>;
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function renderAnswer(answer: string) {
  return answer
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>);
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
      data-source-label={`第 ${slide.pageNumber} 页 AI 讲解`}
    >
      <div className="eyeline">
        <span className="page-number">{slide.pageNumber}</span>
        <span>{explanation.topic}</span>
      </div>

      <div className="explain-heading">
        <h2>{explanation.title}</h2>
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

      <h3>{copy.keyPoints}</h3>
      {renderList(explanation.keyPoints)}

      <h3>{copy.detailed}</h3>
      {explanation.detailedExplanation.map((paragraph, index) => (
        <p key={`${paragraph}-${index}`}>{paragraph}</p>
      ))}

      <h3>{copy.confusion}</h3>
      {renderList(explanation.confusionPoints)}

      <div className="takeaway">
        <strong>{copy.remember}</strong>
        {explanation.remember}
      </div>

      <p className="sr-only">{title}</p>
    </article>
  );
}

export function SlidesDocumentView({
  title,
  slides,
  documentKind = "knowledge_document",
  documentId,
  documentUrl,
  accessCode = "",
  onReset,
}: {
  title: string;
  slides: SlideResult[];
  documentKind?: DocumentKind;
  documentId?: string;
  documentUrl?: string;
  accessCode?: string;
  onReset?: () => void;
}) {
  const [currentSlides, setCurrentSlides] = useState(slides);
  const [dialog, setDialog] = useState<DialogState>(initialDialog);
  const [activePage, setActivePage] = useState<number | null>(slides[0]?.pageNumber ?? null);
  const [error, setError] = useState("");
  const [regeneratingPages, setRegeneratingPages] = useState<Set<number>>(new Set());
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [qaPanel, setQaPanel] = useState<QaPanelState>(initialQaPanel);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const sortedSlides = useMemo(() => [...currentSlides].sort((a, b) => a.pageNumber - b.pageNumber), [currentSlides]);
  const completedPages = sortedSlides.filter((slide) => slide.explanation).length;
  const qaLoading = qaPanel.messages.some((message) => message.loading);

  useEffect(() => {
    setCurrentSlides(slides);
    setActivePage(slides[0]?.pageNumber ?? null);
  }, [slides]);

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
          ...(accessCode.trim() ? { [BETA_ACCESS_HEADER]: accessCode.trim() } : {}),
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

  async function regenerateSlide(slide: SlideResult) {
    setRegeneratingPages((current) => new Set(current).add(slide.pageNumber));
    setError("");

    try {
      const response = await fetch("/api/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessCode.trim() ? { [BETA_ACCESS_HEADER]: accessCode.trim() } : {}),
        },
        body: JSON.stringify({
          documentId,
          documentTitle: title,
          documentKind,
          pageNumber: slide.pageNumber,
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

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="top-title">
            <h1>{title}</h1>
            <span>
              {documentKindLabels[documentKind]} · {completedPages}/{sortedSlides.length} 页
            </span>
          </div>
          <nav className="nav" aria-label="页码导航">
            {sortedSlides.map((slide) => (
              <a key={slide.pageNumber} href={`#p${slide.pageNumber}`} className={activePage === slide.pageNumber ? "active" : ""}>
                {slide.pageNumber}
              </a>
            ))}
          </nav>
          <div className="top-actions">
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

        {error ? (
          <div className="floating-error">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {sortedSlides.map((slide) => (
          <section id={`p${slide.pageNumber}`} className="page-pair" key={slide.pageNumber}>
            <ExplanationArticle
              slide={slide}
              title={title}
              documentKind={documentKind}
              onRegenerate={(nextSlide) => void regenerateSlide(nextSlide)}
              regenerating={regeneratingPages.has(slide.pageNumber)}
            />

            <aside className="slide-column">
              <figure className="slide-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.imageDataUrl} alt={`${title} page ${slide.pageNumber}`} />
              </figure>
              <div className="slide-meta">
                <span>Page {slide.pageNumber}</span>
                <button
                  type="button"
                  onClick={() =>
                    setDialog({
                      open: true,
                      imageDataUrl: slide.imageDataUrl,
                      title: `第 ${slide.pageNumber} 页原图`,
                      alt: `${title} page ${slide.pageNumber}`,
                    })
                  }
                >
                  <ImageIcon aria-hidden="true" />
                  <span>打开原图</span>
                </button>
              </div>
              <div className="source-text-panel">
                <div className="source-text-heading">
                  <FileText aria-hidden="true" />
                  <span>原文抽取文本</span>
                </div>
                <div
                  className={`source-text ${slide.text.trim() ? "" : "is-empty"}`}
                  data-page-number={slide.pageNumber}
                  data-selectable-context="true"
                  data-source-label={`第 ${slide.pageNumber} 页原文`}
                >
                  {slide.text.trim() || "这一页没有抽取到可选择的原文文字，可以直接选中左侧讲解继续提问。"}
                </div>
              </div>
            </aside>
          </section>
        ))}
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

      {!error ? (
        <div className="completion-toast">
          <CheckCircle2 aria-hidden="true" />
          <span>已生成</span>
        </div>
      ) : null}
    </>
  );
}
