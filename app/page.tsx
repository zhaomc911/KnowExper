"use client";

import {
  AlertCircle,
  FileText,
  KeyRound,
  Loader2,
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
          <p>上传 PDF 课件或论文，自动识别类型并生成细粒度中文详解。</p>
        </div>

        <div className="upload-actions">
          <button className="primary-button" type="button" onClick={onPickFile} disabled={progress.active}>
            <FileText aria-hidden="true" />
            <span>选择 PDF</span>
          </button>
          <div className="limit-row">
            <span>PDF</span>
            <span>PPTX 规划中</span>
            <span>{config ? `≤ ${config.limits.maxUploadMb} MB` : "读取限制中"}</span>
            <span>{config ? `≤ ${config.limits.maxPages} 页` : ""}</span>
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

  function validateFile(file: File) {
    if (isPptx(file)) {
      return "当前公开 MVP 先支持 PDF。PPTX 会在接入转换服务后支持；现在请先把 PPTX 导出为 PDF 后上传。";
    }

    if (!isPdf(file)) {
      return "当前仅支持 PDF 文件。";
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
          onPickFile={() => fileInputRef.current?.click()}
          onDropFile={(file) => void processFile(file)}
        />
      </main>
    </>
  );
}
