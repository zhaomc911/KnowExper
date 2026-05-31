"use client";

import {
  AlertCircle,
  BookOpen,
  FileText,
  KeyRound,
  Loader2,
  Presentation,
  ShieldCheck,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { SlidesDocumentView } from "@/components/SlidesDocumentView";
import { documentKindLabels } from "@/lib/document-kind";
import type { DocumentKind, ProcessEvent, SlideResult } from "@/lib/types";

type ConfigResponse = {
  limits: {
    maxUploadMb: number;
    maxPages: number;
    acceptedTypes: string[];
  };
  ai: {
    configured: boolean;
    provider: string;
    model: string;
    hasBaseURL: boolean;
    missing: string[];
  };
  access: {
    required: boolean;
  };
};

type ProgressState = {
  active: boolean;
  percent: number;
  message: string;
  phase: ProcessEvent extends infer Event
    ? Event extends { type: "progress"; phase: infer Phase }
      ? Phase
      : "validate"
    : "validate";
};

const initialProgress: ProgressState = {
  active: false,
  percent: 0,
  message: "",
  phase: "validate",
};

const ACCESS_STORAGE_KEY = "knowexper-beta-access-code";
const RECENT_DOCUMENTS_KEY = "knowexper-recent-documents";
const BETA_ACCESS_HEADER = "x-beta-access-code";

function normalizeFileTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isPptx(file: File) {
  return file.name.toLowerCase().endsWith(".pptx");
}

type RecentDocument = {
  id: string;
  title: string;
  pageCount: number;
  url: string;
  createdAt: string;
  documentKind?: DocumentKind;
};

function UploadWorkbench({
  config,
  progress,
  error,
  onPickFile,
  onDropFile,
  selectedFile,
  accessCode,
  onAccessCodeChange,
  recentDocuments,
  startPage,
  endPage,
  onStartPageChange,
  onEndPageChange,
}: {
  config: ConfigResponse | null;
  progress: ProgressState;
  error: string;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
  selectedFile: File | null;
  accessCode: string;
  onAccessCodeChange: (value: string) => void;
  recentDocuments: RecentDocument[];
  startPage: string;
  endPage: string;
  onStartPageChange: (value: string) => void;
  onEndPageChange: (value: string) => void;
}) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onDropFile(file);
  }

  return (
    <section className="upload-band">
      <div
        className={`upload-shell ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="upload-copy">
          <div className="upload-mark" aria-hidden="true">
            <UploadCloud />
          </div>
          <h1>KnowExper</h1>
          <p>上传课程 slides、PPTX/PDF 课件或学术论文，自动识别类型并生成细粒度中文详解。</p>
        </div>

        <div className="document-mode-grid" aria-label="支持的文档类型">
          <div>
            <Presentation aria-hidden="true" />
            <span>课程 slides</span>
            <strong>按页精讲概念、图示、公式和复习重点</strong>
          </div>
          <div>
            <BookOpen aria-hidden="true" />
            <span>学术论文</span>
            <strong>按论文逻辑细读问题、方法、结果和图表</strong>
          </div>
        </div>

        <div className="upload-actions">
          <button className="primary-button" type="button" onClick={onPickFile} disabled={progress.active}>
            <FileText aria-hidden="true" />
            <span>选择文件</span>
          </button>
          <div className="limit-row">
            <span>PDF</span>
            <span>PPTX</span>
            <span>{config ? `≤ ${config.limits.maxUploadMb} MB` : "读取限制中"}</span>
            <span>{config ? `单次 ≤ ${config.limits.maxPages} 页` : ""}</span>
          </div>
        </div>

        <div className="range-panel">
          <div className="range-copy">
            <strong>精讲范围</strong>
            <span>适合课件只讲某一章；留空则处理整份文档。</span>
          </div>
          <div className="range-inputs">
            <label>
              <span>从第</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="1"
                value={startPage}
                disabled={progress.active}
                onChange={(event) => onStartPageChange(event.currentTarget.value)}
              />
              <span>页</span>
            </label>
            <label>
              <span>到第</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="末页"
                value={endPage}
                disabled={progress.active}
                onChange={(event) => onEndPageChange(event.currentTarget.value)}
              />
              <span>页</span>
            </label>
          </div>
        </div>

        <div className="status-strip">
          <div className={`status-dot ${config?.ai.configured ? "is-ok" : "is-warn"}`} />
          <span>
            {config?.ai.configured
              ? `${config.ai.provider} · ${config.ai.model}`
              : config
                ? `网关未配置：${config.ai.missing.join("、") || "环境变量"}`
                : "正在检查网关配置"}
          </span>
        </div>

        {config?.access.required ? (
          <label className="access-row">
            <span className="access-label">
              <KeyRound aria-hidden="true" />
              <span>测试访问码</span>
            </span>
            <input
              type="password"
              value={accessCode}
              placeholder="输入后再上传"
              autoComplete="off"
              onChange={(event) => onAccessCodeChange(event.currentTarget.value)}
            />
          </label>
        ) : null}

        <div className="privacy-note">
          <ShieldCheck aria-hidden="true" />
          <span>公开测试版：文档会发送到本站后端并调用 Highland 模型生成详解，请勿上传敏感或受保密限制的资料。</span>
        </div>

        {recentDocuments.length ? (
          <div className="recent-documents">
            <div className="recent-documents-title">最近生成</div>
            <div className="recent-documents-list">
              {recentDocuments.map((document) => (
                <a href={document.url} key={document.id}>
                  <span>{document.title}</span>
                  <strong>{document.documentKind ? documentKindLabels[document.documentKind] : "文档"} · {document.pageCount} 页</strong>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {selectedFile ? (
          <div className="file-pill">
            <FileText aria-hidden="true" />
            <span>{selectedFile.name}</span>
          </div>
        ) : null}

        {progress.active ? (
          <div className="progress-panel">
            <div className="progress-copy">
              <Loader2 className="spin" aria-hidden="true" />
              <span>{progress.message}</span>
              <strong>{progress.percent}%</strong>
            </div>
            <div className="progress-track" aria-label="处理进度">
              <div style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="error-panel">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [slides, setSlides] = useState<SlideResult[]>([]);
  const [documentTitle, setDocumentTitle] = useState("KnowExper");
  const [documentKind, setDocumentKind] = useState<DocumentKind>("knowledge_document");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProgressState>(initialProgress);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [startPage, setStartPage] = useState("");
  const [endPage, setEndPage] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([]);

  const sortedSlides = useMemo(() => [...slides].sort((a, b) => a.pageNumber - b.pageNumber), [slides]);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((data: ConfigResponse) => setConfig(data))
      .catch(() => {
        setConfig(null);
        setError("无法读取服务端配置。");
      });
  }, []);

  useEffect(() => {
    try {
      const storedCode = window.localStorage.getItem(ACCESS_STORAGE_KEY);
      if (storedCode) setAccessCode(storedCode);
    } catch {
      setAccessCode("");
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_DOCUMENTS_KEY);
      if (stored) {
        setRecentDocuments(JSON.parse(stored) as RecentDocument[]);
      }
    } catch {
      setRecentDocuments([]);
    }
  }, []);

  function parseRangeValue(value: string, label: string) {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const number = Number(trimmed);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`${label}必须是大于 0 的整数。`);
    }
    return number;
  }

  function currentPageRange() {
    const start = parseRangeValue(startPage, "起始页");
    const end = parseRangeValue(endPage, "结束页");

    if (start && end && start > end) {
      throw new Error("页码范围无效：起始页不能大于结束页。");
    }

    if (config && start && end && end - start + 1 > config.limits.maxPages) {
      throw new Error(`本次选择 ${end - start + 1} 页，超过当前限制 ${config.limits.maxPages} 页。`);
    }

    return { start, end };
  }

  function validateFile(file: File) {
    if (!isPdf(file) && !isPptx(file)) {
      return "当前支持 PDF 和 PPTX 文件。";
    }

    if (config && file.size > config.limits.maxUploadMb * 1024 * 1024) {
      return `文件大小超过 ${config.limits.maxUploadMb} MB。`;
    }

    if (config && !config.ai.configured) {
      return `服务端 AI 网关未配置完整：${config.ai.missing.join("、") || "环境变量"}。`;
    }

    if (config?.access.required && !accessCode.trim()) {
      return "请输入测试访问码。";
    }

    try {
      currentPageRange();
    } catch (rangeError) {
      return rangeError instanceof Error ? rangeError.message : "页码范围无效。";
    }

    return "";
  }

  function updateAccessCode(value: string) {
    setAccessCode(value);
    const trimmed = value.trim();
    try {
      if (trimmed) {
        window.localStorage.setItem(ACCESS_STORAGE_KEY, trimmed);
      } else {
        window.localStorage.removeItem(ACCESS_STORAGE_KEY);
      }
    } catch {
      // The in-memory value is enough for the current session.
    }
  }

  function rememberDocument(document: RecentDocument) {
    setRecentDocuments((current) => {
      const next = [document, ...current.filter((item) => item.id !== document.id)].slice(0, 8);
      try {
        window.localStorage.setItem(RECENT_DOCUMENTS_KEY, JSON.stringify(next));
      } catch {
        // Recent links are a convenience only.
      }
      return next;
    });
  }

  function upsertSlide(slide: SlideResult) {
    setSlides((current) => {
      const next = current.filter((item) => item.pageNumber !== slide.pageNumber);
      next.push(slide);
      return next.sort((a, b) => a.pageNumber - b.pageNumber);
    });
  }

  async function processFile(file: File) {
    const validationError = validateFile(file);
    setSelectedFile(file);

    if (validationError) {
      setError(validationError);
      return;
    }

    setSlides([]);
    setDocumentId("");
    setDocumentUrl("");
    setError("");
    setDocumentKind("knowledge_document");
    setDocumentTitle(normalizeFileTitle(file) || "KnowExper");
    setProgress({
      active: true,
      percent: 1,
      phase: "validate",
      message: "正在上传文档。",
    });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", normalizeFileTitle(file));
    const range = currentPageRange();
    if (range.start) formData.append("startPage", String(range.start));
    if (range.end) formData.append("endPage", String(range.end));

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: accessCode.trim() ? { [BETA_ACCESS_HEADER]: accessCode.trim() } : undefined,
        body: formData,
      });

      if (!response.body) {
        throw new Error("浏览器没有收到处理流。");
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
            setProgress({ active: true, percent: event.percent, message: event.message, phase: event.phase });
          }

          if (event.type === "meta") {
            setDocumentTitle(event.title);
            if (event.documentKind) setDocumentKind(event.documentKind);
          }

          if (event.type === "page") {
            upsertSlide(event.slide);
          }

          if (event.type === "done") {
            setDocumentTitle(event.title);
            setSlides(event.slides);
            if (event.documentKind) setDocumentKind(event.documentKind);
            setDocumentId(event.documentId ?? "");
            setDocumentUrl(event.documentUrl ?? "");
            if (event.documentId && event.documentUrl) {
              rememberDocument({
                id: event.documentId,
                title: event.title,
                pageCount: event.slides.length,
                url: event.documentUrl,
                createdAt: new Date().toISOString(),
                documentKind: event.documentKind,
              });
              window.history.replaceState(null, "", event.documentUrl);
            }
          }

          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      setProgress((current) => ({ ...current, active: false, percent: 100 }));
    } catch (nextError) {
      setProgress(initialProgress);
      setError(nextError instanceof Error ? nextError.message : "处理失败，请稍后重试。");
    }
  }

  function resetApp() {
    setSlides([]);
    setSelectedFile(null);
    setDocumentTitle("KnowExper");
    setDocumentKind("knowledge_document");
    setStartPage("");
    setEndPage("");
    setDocumentId("");
    setDocumentUrl("");
    setProgress(initialProgress);
    setError("");
    window.history.replaceState(null, "", "/");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (sortedSlides.length) {
    return (
      <SlidesDocumentView
        title={documentTitle}
        slides={sortedSlides}
        documentKind={documentKind}
        documentId={documentId}
        documentUrl={documentUrl}
        accessCode={accessCode}
        onReset={resetApp}
      />
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf,.pptx"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void processFile(file);
        }}
      />

      <header className="app-topbar">
        <div className="app-topbar-inner">
          <div className="brand-lockup">
            <WandSparkles aria-hidden="true" />
            <span>KnowExper</span>
          </div>
          <button className="top-action" type="button" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud aria-hidden="true" />
            <span>上传</span>
          </button>
        </div>
      </header>

      <main>
        <UploadWorkbench
          config={config}
          progress={progress}
          error={error}
          selectedFile={selectedFile}
          accessCode={accessCode}
          onAccessCodeChange={updateAccessCode}
          recentDocuments={recentDocuments}
          startPage={startPage}
          endPage={endPage}
          onStartPageChange={setStartPage}
          onEndPageChange={setEndPage}
          onPickFile={() => fileInputRef.current?.click()}
          onDropFile={(file) => void processFile(file)}
        />
      </main>
    </>
  );
}
