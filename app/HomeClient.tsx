"use client";

import {
  AlertCircle,
  BookOpen,
  Check,
  FileText,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Presentation,
  Save,
  ServerCog,
  ShieldCheck,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { SlidesDocumentView } from "@/components/SlidesDocumentView";
import { documentKindLabels } from "@/lib/document-kind";
import type { DocumentKind, PageRange, ProcessEvent, SlideResult, SourceType, StoredDocumentStatus } from "@/lib/types";

type ConfigResponse = {
  limits: {
    maxUploadMb: number;
    maxPages: number;
    maxPaperPages: number;
    maxSourcePages: number;
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

type AiProviderId = "openai-compatible" | "highland" | "openai" | "deepseek";

type AiCredentialSummary = {
  provider: AiProviderId;
  providerLabel: string;
  baseURL?: string;
  model: string;
  supportsVision: boolean;
  apiKeyLast4: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
};

type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
  aiCredential?: AiCredentialSummary | null;
};

type AiConfigForm = {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  apiKey: string;
  supportsVision: boolean;
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
const BETA_ACCESS_HEADER = "x-beta-access-code";
const ACCESS_CODE_REQUIRED_MESSAGE = "请输入测试访问码。";

const PROVIDER_OPTIONS: Array<{
  id: AiProviderId;
  label: string;
  description: string;
  defaultBaseURL: string;
  defaultModel: string;
  supportsVision: boolean;
  requiresBaseURL: boolean;
}> = [
  {
    id: "highland",
    label: "Highland",
    description: "Highland 或同类网关",
    defaultBaseURL: "",
    defaultModel: "gpt-4o-mini",
    supportsVision: true,
    requiresBaseURL: true,
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    description: "自定义兼容接口",
    defaultBaseURL: "",
    defaultModel: "gpt-4o-mini",
    supportsVision: true,
    requiresBaseURL: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "官方 OpenAI API",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    supportsVision: true,
    requiresBaseURL: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "适合选区问答，页面详解需视觉模型",
    defaultBaseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    supportsVision: false,
    requiresBaseURL: false,
  },
];

const DEFAULT_AI_FORM: AiConfigForm = {
  provider: "highland",
  baseURL: "",
  model: "gpt-4o-mini",
  apiKey: "",
  supportsVision: true,
};

function normalizeFileTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isPptx(file: File) {
  return file.name.toLowerCase().endsWith(".pptx");
}

type LibraryDocument = {
  id: string;
  fileName?: string;
  title: string;
  pageCount: number;
  url: string;
  createdAt: string;
  updatedAt?: string;
  documentKind?: DocumentKind;
  sourceType?: SourceType;
  pageRange?: PageRange;
  status?: StoredDocumentStatus;
  completedPageCount?: number;
  sourcePageCount?: number;
  collapsedPageCount?: number;
  lastError?: string;
};

type TitleOverrides = Record<string, { title?: string; updatedAt: string; deleted?: boolean }>;

function applyTitleOverrides(documents: LibraryDocument[], titleOverrides: TitleOverrides) {
  return documents.map((document) => {
    const override = titleOverrides[document.id];
    if (!override || override.deleted || !override.title) return document;

    return {
      ...document,
      title: override.title,
      updatedAt: override.updatedAt,
    };
  });
}

function mergeLibraryDocuments(documents: LibraryDocument[], titleOverrides: TitleOverrides = {}) {
  const seen = new Set<string>();
  const deletedIds = new Set(
    Object.entries(titleOverrides)
      .filter(([, override]) => override.deleted)
      .map(([id]) => id),
  );
  const merged = documents.filter((document) => {
    if (deletedIds.has(document.id)) return false;
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });

  return applyTitleOverrides(merged, titleOverrides);
}

function providerPreset(provider: AiProviderId) {
  return PROVIDER_OPTIONS.find((option) => option.id === provider) ?? PROVIDER_OPTIONS[0];
}

function AuthWorkbench({
  mode,
  email,
  password,
  loading,
  error,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  mode: "login" | "register";
  email: string;
  password: string;
  loading: boolean;
  error: string;
  onModeChange: (mode: "login" | "register") => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="upload-band">
      <div className="upload-shell auth-shell">
        <div className="upload-copy">
          <div className="upload-mark" aria-hidden="true">
            <LogIn />
          </div>
          <h1>KnowExper</h1>
          <p>登录后使用自己的模型 API，生成的文档和密钥配置只归属于当前账号。</p>
        </div>

        <div className="auth-mode-tabs" role="tablist" aria-label="账号操作">
          <button
            className={mode === "login" ? "is-selected" : ""}
            type="button"
            onClick={() => onModeChange("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "is-selected" : ""}
            type="button"
            onClick={() => onModeChange("register")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={loading}
              onChange={(event) => onEmailChange(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              placeholder="至少 8 个字符"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={loading}
              onChange={(event) => onPasswordChange(event.currentTarget.value)}
            />
          </label>

          {error ? (
            <div className="error-panel">
              <AlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? <Loader2 className="spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            <span>{mode === "login" ? "登录" : "创建账号"}</span>
          </button>
        </form>
      </div>
    </section>
  );
}

function AccountApiPanel({
  user,
  aiCredential,
  aiForm,
  saving,
  error,
  onFormChange,
  onSave,
  onDelete,
  onLogout,
}: {
  user: AuthUser;
  aiCredential: AiCredentialSummary | null;
  aiForm: AiConfigForm;
  saving: boolean;
  error: string;
  onFormChange: (form: AiConfigForm) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const selectedProvider = providerPreset(aiForm.provider);

  function updateProvider(provider: AiProviderId) {
    const preset = providerPreset(provider);
    onFormChange({
      provider,
      baseURL: preset.defaultBaseURL,
      model: preset.defaultModel,
      apiKey: "",
      supportsVision: preset.supportsVision,
    });
  }

  return (
    <div className="account-api-panel">
      <div className="account-api-head">
        <div>
          <strong>{user.email}</strong>
          <span>
            {aiCredential
              ? `${aiCredential.providerLabel} · ${aiCredential.model} · key 后四位 ${aiCredential.apiKeyLast4}`
              : "还没有配置个人模型 API"}
          </span>
        </div>
        <button className="recent-document-text-button" type="button" onClick={() => void onLogout()}>
          <LogOut aria-hidden="true" />
          <span>退出</span>
        </button>
      </div>

      <form className="api-config-form" onSubmit={onSave}>
        <div className="api-provider-grid" role="radiogroup" aria-label="选择模型服务">
          {PROVIDER_OPTIONS.map((option) => (
            <button
              className={aiForm.provider === option.id ? "is-selected" : ""}
              key={option.id}
              type="button"
              role="radio"
              aria-checked={aiForm.provider === option.id}
              disabled={saving}
              onClick={() => updateProvider(option.id)}
            >
              <ServerCog aria-hidden="true" />
              <span>{option.label}</span>
              <strong>{option.description}</strong>
            </button>
          ))}
        </div>

        <div className="api-config-grid">
          <label>
            <span>Base URL</span>
            <input
              value={aiForm.baseURL}
              placeholder={selectedProvider.requiresBaseURL ? "https://your-provider.example/v1" : selectedProvider.defaultBaseURL}
              disabled={saving}
              onChange={(event) => onFormChange({ ...aiForm, baseURL: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>模型</span>
            <input
              value={aiForm.model}
              placeholder={selectedProvider.defaultModel}
              disabled={saving}
              onChange={(event) => onFormChange({ ...aiForm, model: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={aiForm.apiKey}
              placeholder={aiCredential ? "输入新 key 后会替换当前配置" : "粘贴自己的 API Key"}
              autoComplete="off"
              disabled={saving}
              onChange={(event) => onFormChange({ ...aiForm, apiKey: event.currentTarget.value })}
            />
          </label>
          <label className="api-checkbox">
            <input
              type="checkbox"
              checked={aiForm.supportsVision}
              disabled={saving}
              onChange={(event) => onFormChange({ ...aiForm, supportsVision: event.currentTarget.checked })}
            />
            <span>这个模型支持图片输入</span>
          </label>
        </div>

        {error ? (
          <div className="inline-error">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="api-config-actions">
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? <Loader2 className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            <span>保存 API 配置</span>
          </button>
          {aiCredential ? (
            <button className="recent-document-text-button is-danger" type="button" disabled={saving} onClick={() => void onDelete()}>
              <Trash2 aria-hidden="true" />
              <span>移除配置</span>
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function libraryDocumentMeta(document: LibraryDocument) {
  const status = document.status ?? "complete";
  const completedPageCount =
    document.completedPageCount ?? (status === "complete" ? document.pageCount : 0);
  const selectedSourcePages = document.pageRange
    ? document.pageRange.endPage - document.pageRange.startPage + 1
    : document.pageCount;
  const pageCountLabel =
    document.pageRange && selectedSourcePages > document.pageCount
      ? `${document.pageCount} 个讲解单元`
      : `${document.pageCount} 页`;
  const statusLabel =
    status === "complete"
      ? ""
      : status === "processing"
        ? `处理中 ${completedPageCount}/${document.pageCount}`
        : `部分完成 ${completedPageCount}/${document.pageCount}`;
  const parts = [
    statusLabel,
    document.documentKind ? documentKindLabels[document.documentKind] : "文档",
    document.sourceType?.toUpperCase(),
    pageCountLabel,
  ].filter(Boolean);

  if (document.pageRange && document.pageRange.totalPageCount > document.pageCount) {
    parts.push(`第 ${document.pageRange.startPage}-${document.pageRange.endPage} 页`);
  }

  return parts.join(" · ");
}

function UploadWorkbench({
  config,
  authUser,
  aiCredential,
  aiForm,
  apiConfigSaving,
  apiConfigError,
  progress,
  error,
  onPickFile,
  onDropFile,
  selectedFile,
  accessCode,
  onAccessCodeChange,
  libraryDocuments,
  startPage,
  endPage,
  onStartPageChange,
  onEndPageChange,
  uploadKind,
  onUploadKindChange,
  onAiConfigFormChange,
  onSaveAiConfig,
  onDeleteAiConfig,
  onLogout,
  onRenameDocument,
  onDeleteDocument,
}: {
  config: ConfigResponse | null;
  authUser: AuthUser;
  aiCredential: AiCredentialSummary | null;
  aiForm: AiConfigForm;
  apiConfigSaving: boolean;
  apiConfigError: string;
  progress: ProgressState;
  error: string;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
  selectedFile: File | null;
  accessCode: string;
  onAccessCodeChange: (value: string) => void;
  libraryDocuments: LibraryDocument[];
  startPage: string;
  endPage: string;
  onStartPageChange: (value: string) => void;
  onEndPageChange: (value: string) => void;
  uploadKind: Extract<DocumentKind, "course_slides" | "academic_paper">;
  onUploadKindChange: (value: Extract<DocumentKind, "course_slides" | "academic_paper">) => void;
  onAiConfigFormChange: (form: AiConfigForm) => void;
  onSaveAiConfig: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteAiConfig: () => Promise<void>;
  onLogout: () => Promise<void>;
  onRenameDocument: (documentId: string, title: string) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [renamingDocumentId, setRenamingDocumentId] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [pendingDeleteDocumentId, setPendingDeleteDocumentId] = useState("");
  const [renameError, setRenameError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const visibleUnitLimit = config
    ? uploadKind === "academic_paper"
      ? config.limits.maxPaperPages
      : config.limits.maxPages
    : undefined;
  const courseLibraryDocuments = libraryDocuments.filter((document) => document.documentKind !== "academic_paper");
  const paperLibraryDocuments = libraryDocuments.filter((document) => document.documentKind === "academic_paper");
  const librarySections = [
    {
      id: "course_slides",
      title: "课程 slides",
      description: "课件、讲义和普通学习资料",
      documents: courseLibraryDocuments,
    },
    {
      id: "academic_paper",
      title: "学术论文",
      description: "论文、综述和研究文章",
      documents: paperLibraryDocuments,
    },
  ];

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onDropFile(file);
  }

  function startRename(document: LibraryDocument) {
    setEditingDocumentId(document.id);
    setDraftTitle(document.title);
    setPendingDeleteDocumentId("");
    setRenameError("");
    setDeleteError("");
  }

  function cancelRename() {
    setEditingDocumentId("");
    setDraftTitle("");
    setRenameError("");
  }

  async function submitRename(document: LibraryDocument) {
    const title = draftTitle.trim().replace(/\s+/g, " ");
    if (!title) {
      setRenameError("标题不能为空。");
      return;
    }

    setRenamingDocumentId(document.id);
    setRenameError("");

    try {
      await onRenameDocument(document.id, title);
      cancelRename();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "重命名失败。");
    } finally {
      setRenamingDocumentId("");
    }
  }

  function requestDeleteDocument(document: LibraryDocument) {
    if (editingDocumentId === document.id) cancelRename();
    setPendingDeleteDocumentId(document.id);
    setRenameError("");
    setDeleteError("");
  }

  function cancelDeleteDocument() {
    setPendingDeleteDocumentId("");
    setDeleteError("");
  }

  async function confirmDeleteDocument(document: LibraryDocument) {
    setDeletingDocumentId(document.id);
    setRenameError("");
    setDeleteError("");

    try {
      await onDeleteDocument(document.id);
      setPendingDeleteDocumentId("");
      if (editingDocumentId === document.id) cancelRename();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setDeletingDocumentId("");
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, document: LibraryDocument) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitRename(document);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  function renderDocumentRow(document: LibraryDocument) {
    const isEditing = editingDocumentId === document.id;
    const isRenaming = renamingDocumentId === document.id;
    const isDeleting = deletingDocumentId === document.id;
    const isConfirmingDelete = pendingDeleteDocumentId === document.id;

    return (
      <div
        className={`recent-document-row ${isEditing ? "is-editing" : ""} ${
          isConfirmingDelete ? "is-confirming-delete" : ""
        }`}
        key={document.id}
      >
        {isEditing ? (
          <form
            className="recent-document-edit"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename(document);
            }}
          >
            <input
              autoFocus
              value={draftTitle}
              maxLength={160}
              disabled={isRenaming}
              aria-label={`重命名 ${document.title}`}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              onKeyDown={(event) => handleRenameKeyDown(event, document)}
            />
            <div className="recent-document-edit-actions">
              <button
                className="recent-document-icon-button"
                type="submit"
                aria-label="保存标题"
                disabled={isRenaming}
              >
                {isRenaming ? <Loader2 className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
              </button>
              <button
                className="recent-document-icon-button"
                type="button"
                aria-label="取消重命名"
                disabled={isRenaming}
                onClick={cancelRename}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <>
            <a className="recent-document-link" href={document.url} title={document.title}>
              <span>{document.title}</span>
              <strong>{libraryDocumentMeta(document)}</strong>
            </a>
            <div className="recent-document-actions">
              {isConfirmingDelete ? (
                <>
                  <button
                    className="recent-document-text-button is-danger"
                    type="button"
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void confirmDeleteDocument(document);
                    }}
                  >
                    {isDeleting ? <Loader2 className="spin" aria-hidden="true" /> : null}
                    <span>确认删除</span>
                  </button>
                  <button
                    className="recent-document-text-button"
                    type="button"
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      cancelDeleteDocument();
                    }}
                  >
                    <span>取消</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="recent-document-icon-button"
                    type="button"
                    aria-label={`重命名 ${document.title}`}
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startRename(document);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    className="recent-document-icon-button is-danger"
                    type="button"
                    aria-label={`删除 ${document.title}`}
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      requestDeleteDocument(document);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
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
          <p>上传课程 slides、PPTX/PDF 课件或学术论文，按所选类型生成细粒度中文详解。</p>
        </div>

        <AccountApiPanel
          user={authUser}
          aiCredential={aiCredential}
          aiForm={aiForm}
          saving={apiConfigSaving}
          error={apiConfigError}
          onFormChange={onAiConfigFormChange}
          onSave={onSaveAiConfig}
          onDelete={onDeleteAiConfig}
          onLogout={onLogout}
        />

        <div className="document-mode-grid" role="radiogroup" aria-label="选择文档类型">
          <button
            className={uploadKind === "course_slides" ? "is-selected" : ""}
            type="button"
            role="radio"
            aria-checked={uploadKind === "course_slides"}
            disabled={progress.active}
            onClick={() => onUploadKindChange("course_slides")}
          >
            <Presentation aria-hidden="true" />
            <span>课程 slides</span>
            <strong>按页精讲概念、图示、公式和复习重点</strong>
          </button>
          <button
            className={uploadKind === "academic_paper" ? "is-selected" : ""}
            type="button"
            role="radio"
            aria-checked={uploadKind === "academic_paper"}
            disabled={progress.active}
            onClick={() => onUploadKindChange("academic_paper")}
          >
            <BookOpen aria-hidden="true" />
            <span>学术论文</span>
            <strong>先按论文板块分区，再综合精读问题、方法、结果和图表</strong>
          </button>
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
            <span>
              {visibleUnitLimit
                ? `≤ ${visibleUnitLimit} ${uploadKind === "academic_paper" ? "个精读单元" : "个讲解单元"}`
                : ""}
            </span>
          </div>
        </div>

        <div className="range-panel">
          <div className="range-copy">
            <strong>{uploadKind === "academic_paper" ? "精读范围" : "精讲范围"}</strong>
            <span>
              {uploadKind === "academic_paper"
                ? `适合整篇论文或一个章节；系统会按论文结构自动分块，最多生成 ${
                    visibleUnitLimit ?? "规定"
                  } 个精读单元。`
                : `可扫描 ${config ? config.limits.maxSourcePages : "数百"} 个原始页面；动画/高亮页会智能合并，最终不超过 ${
                    visibleUnitLimit ?? "规定"
                  } 个讲解单元。`}
            </span>
          </div>
          {uploadKind === "course_slides" ? (
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
          ) : (
            <div className="range-mode-note">自动分块精读</div>
          )}
        </div>

        <div className="status-strip">
          <div className={`status-dot ${aiCredential ? "is-ok" : "is-warn"}`} />
          <span>
            {aiCredential
              ? `${aiCredential.providerLabel} · ${aiCredential.model}${
                  aiCredential.supportsVision ? "" : " · 未标记为视觉模型"
                }`
              : "请先配置个人模型 API"}
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
          <span>文档会发送到本站后端，并使用你账号中保存的 API 配置调用模型；请勿上传敏感或受保密限制的资料。</span>
        </div>

        {libraryDocuments.length ? (
          <div className="recent-documents">
            <div className="recent-documents-title">本地文档库</div>
            <div className="recent-documents-grid">
              {librarySections.map((section) => (
                <section className="recent-documents-section" key={section.id} aria-label={`${section.title} 文档`}>
                  <div className="recent-documents-section-head">
                    <strong>{section.title}</strong>
                    <span>{section.description}</span>
                  </div>
                  {section.documents.length ? (
                    <div className="recent-documents-list">{section.documents.map(renderDocumentRow)}</div>
                  ) : (
                    <div className="recent-documents-empty">还没有保存的{section.title}。</div>
                  )}
                </section>
              ))}
            </div>
            {renameError || deleteError ? (
              <div className="recent-documents-error">{renameError || deleteError}</div>
            ) : null}
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

function ProcessingWorkbench({
  title,
  documentKind,
  selectedFile,
  progress,
  documentUrl,
  expectedPageCount,
  onPickFile,
}: {
  title: string;
  documentKind: DocumentKind;
  selectedFile: File | null;
  progress: ProgressState;
  documentUrl: string;
  expectedPageCount?: number;
  onPickFile: () => void;
}) {
  return (
    <section className="processing-band">
      <div className="processing-shell">
        <div className="processing-header">
          <div className="processing-mark" aria-hidden="true">
            <Loader2 className="spin" />
          </div>
          <div className="processing-copy">
            <span>{documentKindLabels[documentKind] ?? "文档"}处理中</span>
            <h1>{title || selectedFile?.name || "正在生成精讲"}</h1>
            <p>
              {expectedPageCount
                ? `已完成分区，共 ${expectedPageCount} 个讲解单元。第一段讲解生成后会自动进入阅读界面。`
                : "正在上传、解析并渲染文档。完成分区后会开始生成中文详解。"}
            </p>
          </div>
        </div>

        <div className="processing-status-card">
          <div className="progress-copy">
            <Loader2 className="spin" aria-hidden="true" />
            <span>{progress.message || "正在处理文档。"}</span>
            <strong>{progress.percent}%</strong>
          </div>
          <div className="progress-track" aria-label="处理进度">
            <div style={{ width: `${progress.percent}%` }} />
          </div>
        </div>

        <div className="processing-details">
          {selectedFile ? (
            <div className="processing-detail-row">
              <FileText aria-hidden="true" />
              <span>{selectedFile.name}</span>
            </div>
          ) : null}
          {documentUrl ? (
            <a className="processing-detail-row" href={documentUrl}>
              <ShieldCheck aria-hidden="true" />
              <span>已保存到本地文档库，稍后可从这个链接继续查看。</span>
            </a>
          ) : (
            <div className="processing-detail-row">
              <ShieldCheck aria-hidden="true" />
              <span>生成过程中请保持这个页面打开，已完成的单元会被逐步保存。</span>
            </div>
          )}
        </div>

        <button className="top-action" type="button" onClick={onPickFile} disabled={progress.active}>
          <UploadCloud aria-hidden="true" />
          <span>上传新文档</span>
        </button>
      </div>
    </section>
  );
}

export default function HomeClient({
  initialLibraryDocuments = [],
  initialTitleOverrides = {},
}: {
  initialLibraryDocuments?: LibraryDocument[];
  initialTitleOverrides?: TitleOverrides;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const accessCodeRef = useRef("");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [aiCredential, setAiCredential] = useState<AiCredentialSummary | null>(null);
  const [aiForm, setAiForm] = useState<AiConfigForm>(DEFAULT_AI_FORM);
  const [apiConfigSaving, setApiConfigSaving] = useState(false);
  const [apiConfigError, setApiConfigError] = useState("");
  const [slides, setSlides] = useState<SlideResult[]>([]);
  const [documentTitle, setDocumentTitle] = useState("KnowExper");
  const [documentKind, setDocumentKind] = useState<DocumentKind>("course_slides");
  const [uploadKind, setUploadKind] = useState<Extract<DocumentKind, "course_slides" | "academic_paper">>("course_slides");
  const [documentStatus, setDocumentStatus] = useState<StoredDocumentStatus | undefined>(undefined);
  const [expectedPageCount, setExpectedPageCount] = useState<number | undefined>(undefined);
  const [lastDocumentError, setLastDocumentError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProgressState>(initialProgress);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [startPage, setStartPage] = useState("");
  const [endPage, setEndPage] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(() =>
    mergeLibraryDocuments(initialLibraryDocuments, initialTitleOverrides),
  );
  const [locallyDeletedDocumentIds, setLocallyDeletedDocumentIds] = useState<Set<string>>(() => new Set());

  const sortedSlides = useMemo(() => [...slides].sort((a, b) => a.pageNumber - b.pageNumber), [slides]);
  const visibleLibraryDocuments = useMemo(
    () => libraryDocuments.filter((document) => !locallyDeletedDocumentIds.has(document.id)),
    [libraryDocuments, locallyDeletedDocumentIds],
  );

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
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { user?: AuthUser | null };
        if (cancelled) return;

        setAuthUser(data.user ?? null);
        setAiCredential(data.user?.aiCredential ?? null);
        if (data.user?.aiCredential) {
          setAiForm((current) => ({
            ...current,
            provider: data.user!.aiCredential!.provider,
            baseURL: data.user!.aiCredential!.baseURL ?? "",
            model: data.user!.aiCredential!.model,
            apiKey: "",
            supportsVision: data.user!.aiCredential!.supportsVision,
          }));
        }
      } catch {
        if (!cancelled) {
          setAuthUser(null);
          setAiCredential(null);
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const storedCode = window.localStorage.getItem(ACCESS_STORAGE_KEY);
      if (storedCode) {
        accessCodeRef.current = storedCode.trim();
        setAccessCode(storedCode);
      }
    } catch {
      accessCodeRef.current = "";
      setAccessCode("");
    }
  }, []);

  useEffect(() => {
    if (!authUser) {
      setLibraryDocuments(mergeLibraryDocuments([], initialTitleOverrides));
      return;
    }

    fetch("/api/documents")
      .then((response) => response.json())
      .then((data: { documents?: LibraryDocument[]; titleOverrides?: TitleOverrides }) =>
        setLibraryDocuments(mergeLibraryDocuments(data.documents ?? [], data.titleOverrides ?? {})),
      )
      .catch(() => setLibraryDocuments(mergeLibraryDocuments([], initialTitleOverrides)));
  }, [authUser, initialTitleOverrides]);

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

    if (config && start && end && end - start + 1 > config.limits.maxSourcePages) {
      throw new Error(`本次选择 ${end - start + 1} 个原始页面，超过当前扫描限制 ${config.limits.maxSourcePages} 页。`);
    }

    return { start, end };
  }

  function currentAccessCode() {
    const inMemory = accessCodeRef.current.trim() || accessCode.trim();
    if (inMemory) return inMemory;

    try {
      return window.localStorage.getItem(ACCESS_STORAGE_KEY)?.trim() ?? "";
    } catch {
      return "";
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError("");

    try {
      const response = await fetch(`/api/auth/${authMode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { user?: AuthUser; error?: string };

      if (!response.ok || !data.user) {
        throw new Error(data.error || "账号操作失败。");
      }

      setAuthUser(data.user);
      setAiCredential(data.user.aiCredential ?? null);
      if (data.user.aiCredential) {
        setAiForm({
          provider: data.user.aiCredential.provider,
          baseURL: data.user.aiCredential.baseURL ?? "",
          model: data.user.aiCredential.model,
          apiKey: "",
          supportsVision: data.user.aiCredential.supportsVision,
        });
      }
      setAuthPassword("");
    } catch (nextError) {
      setAuthError(nextError instanceof Error ? nextError.message : "账号操作失败。");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function saveAiConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiConfigSaving(true);
    setApiConfigError("");

    try {
      const response = await fetch("/api/account/ai-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(aiForm),
      });
      const data = (await response.json().catch(() => ({}))) as {
        credential?: AiCredentialSummary | null;
        error?: string;
      };

      if (!response.ok || !data.credential) {
        throw new Error(data.error || "保存 API 配置失败。");
      }

      setAiCredential(data.credential);
      setAuthUser((current) => (current ? { ...current, aiCredential: data.credential } : current));
      setAiForm({
        provider: data.credential.provider,
        baseURL: data.credential.baseURL ?? "",
        model: data.credential.model,
        apiKey: "",
        supportsVision: data.credential.supportsVision,
      });
      setError("");
    } catch (nextError) {
      setApiConfigError(nextError instanceof Error ? nextError.message : "保存 API 配置失败。");
    } finally {
      setApiConfigSaving(false);
    }
  }

  async function deleteAiConfig() {
    setApiConfigSaving(true);
    setApiConfigError("");

    try {
      const response = await fetch("/api/account/ai-config", {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "移除 API 配置失败。");
      }

      setAiCredential(null);
      setAuthUser((current) => (current ? { ...current, aiCredential: null } : current));
      setAiForm(DEFAULT_AI_FORM);
    } catch (nextError) {
      setApiConfigError(nextError instanceof Error ? nextError.message : "移除 API 配置失败。");
    } finally {
      setApiConfigSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setAuthUser(null);
    setAiCredential(null);
    setAiForm(DEFAULT_AI_FORM);
    setSlides([]);
    setDocumentId("");
    setDocumentUrl("");
    setLibraryDocuments(mergeLibraryDocuments([], initialTitleOverrides));
    window.history.replaceState(null, "", "/");
  }

  function validateFile(file: File) {
    if (!authUser) {
      return "请先登录后再上传。";
    }

    if (!aiCredential) {
      return "请先保存自己的模型 API 配置。";
    }

    if (!aiCredential.supportsVision) {
      return "当前模型未标记为支持图片输入，无法生成页面详解。";
    }

    if (!isPdf(file) && !isPptx(file)) {
      return "当前支持 PDF 和 PPTX 文件。";
    }

    if (config && file.size > config.limits.maxUploadMb * 1024 * 1024) {
      return `文件大小超过 ${config.limits.maxUploadMb} MB。`;
    }

    if (config?.access.required && !currentAccessCode()) {
      return ACCESS_CODE_REQUIRED_MESSAGE;
    }

    if (uploadKind === "course_slides") {
      try {
        currentPageRange();
      } catch (rangeError) {
        return rangeError instanceof Error ? rangeError.message : "页码范围无效。";
      }
    }

    return "";
  }

  function updateAccessCode(value: string) {
    setAccessCode(value);
    const trimmed = value.trim();
    accessCodeRef.current = trimmed;
    if (trimmed && error === ACCESS_CODE_REQUIRED_MESSAGE) {
      setError("");
    }
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

  function rememberDocument(document: LibraryDocument) {
    setLocallyDeletedDocumentIds((current) => {
      if (!current.has(document.id)) return current;
      const next = new Set(current);
      next.delete(document.id);
      return next;
    });
    setLibraryDocuments((current) => {
      const existing = current.find((item) => item.id === document.id);
      return [
        {
          ...existing,
          ...document,
          updatedAt: document.updatedAt ?? new Date().toISOString(),
        },
        ...current.filter((item) => item.id !== document.id),
      ];
    });
  }

  async function renameLibraryDocument(documentId: string, title: string) {
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      document?: { title?: string; updatedAt?: string };
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "重命名失败。");
    }

    setLibraryDocuments((current) =>
      current.map((document) =>
        document.id === documentId
          ? {
              ...document,
              title: data.document?.title || title,
              updatedAt: data.document?.updatedAt || new Date().toISOString(),
            }
          : document,
      ),
    );
  }

  async function deleteLibraryDocument(documentId: string) {
    const documentToRestore = libraryDocuments.find((document) => document.id === documentId);

    function restoreDeletedDocument() {
      setLocallyDeletedDocumentIds((current) => {
        const next = new Set(current);
        next.delete(documentId);
        return next;
      });
      if (documentToRestore) {
        setLibraryDocuments((current) =>
          current.some((document) => document.id === documentId) ? current : [documentToRestore, ...current],
        );
      }
    }

    setLocallyDeletedDocumentIds((current) => new Set(current).add(documentId));
    setLibraryDocuments((current) => current.filter((document) => document.id !== documentId));

    let response: Response;
    let data: { error?: string };
    try {
      response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: "DELETE",
      });
      data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
    } catch (error) {
      restoreDeletedDocument();
      throw new Error(error instanceof Error ? error.message : "删除失败。");
    }

    if (!response.ok) {
      restoreDeletedDocument();
      throw new Error(data.error || "删除失败。");
    }
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
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSlides([]);
    setDocumentId("");
    setDocumentUrl("");
    setDocumentStatus("processing");
    setExpectedPageCount(undefined);
    setLastDocumentError("");
    setError("");
    setDocumentKind(uploadKind);
    setDocumentTitle(normalizeFileTitle(file) || "KnowExper");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setProgress({
      active: true,
      percent: 1,
      phase: "validate",
      message: "正在上传文档。",
    });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", normalizeFileTitle(file));
    formData.append("documentKind", uploadKind);
    const range = uploadKind === "course_slides" ? currentPageRange() : { start: undefined, end: undefined };
    if (uploadKind === "course_slides" && range.start) formData.append("startPage", String(range.start));
    if (uploadKind === "course_slides" && range.end) formData.append("endPage", String(range.end));

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: currentAccessCode() ? { [BETA_ACCESS_HEADER]: currentAccessCode() } : undefined,
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
            setExpectedPageCount(event.pageCount);
            setDocumentStatus(event.status);
            setLastDocumentError("");
            if (event.documentId && event.documentUrl) {
              setDocumentId(event.documentId);
              setDocumentUrl(event.documentUrl);
              rememberDocument({
                id: event.documentId,
                fileName: event.fileName,
                title: event.title,
                pageCount: event.pageCount,
                url: event.documentUrl,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                documentKind: event.documentKind,
                sourceType: event.sourceType,
                pageRange: event.pageRange,
                status: event.status,
                completedPageCount: event.completedPageCount,
                sourcePageCount: event.sourcePageCount,
                collapsedPageCount: event.collapsedPageCount,
              });
              window.history.replaceState(null, "", event.documentUrl);
            }
          }

          if (event.type === "page") {
            upsertSlide(event.slide);
          }

          if (event.type === "done") {
            setDocumentTitle(event.title);
            setSlides(event.slides);
            if (event.documentKind) setDocumentKind(event.documentKind);
            setExpectedPageCount(event.slides.length);
            setDocumentStatus(event.status);
            setLastDocumentError("");
            setDocumentId(event.documentId ?? "");
            setDocumentUrl(event.documentUrl ?? "");
            if (event.documentId && event.documentUrl) {
              rememberDocument({
                id: event.documentId,
                title: event.title,
                pageCount: event.slides.length,
                url: event.documentUrl,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                documentKind: event.documentKind,
                sourceType: event.sourceType,
                pageRange: event.pageRange,
                status: event.status,
                completedPageCount: event.completedPageCount,
                sourcePageCount: event.sourcePageCount,
                collapsedPageCount: event.collapsedPageCount,
              });
              window.history.replaceState(null, "", event.documentUrl);
            }
          }

          if (event.type === "error") {
            setDocumentStatus("partial");
            setLastDocumentError(event.message);
            throw new Error(event.message);
          }
        }
      }

      setProgress((current) => ({ ...current, active: false, percent: 100 }));
    } catch (nextError) {
      setDocumentStatus("partial");
      setLastDocumentError(nextError instanceof Error ? nextError.message : "处理失败，请稍后重试。");
      setProgress(initialProgress);
      setError(nextError instanceof Error ? nextError.message : "处理失败，请稍后重试。");
    }
  }

  function resetApp() {
    setSlides([]);
    setSelectedFile(null);
    setDocumentTitle("KnowExper");
    setDocumentKind(uploadKind);
    setStartPage("");
    setEndPage("");
    setDocumentId("");
    setDocumentUrl("");
    setDocumentStatus(undefined);
    setExpectedPageCount(undefined);
    setLastDocumentError("");
    setProgress(initialProgress);
    setError("");
    window.history.replaceState(null, "", "/");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (authLoading) {
    return (
      <>
        <header className="app-topbar">
          <div className="app-topbar-inner">
            <div className="brand-lockup">
              <WandSparkles aria-hidden="true" />
              <span>KnowExper</span>
            </div>
          </div>
        </header>
        <main>
          <section className="upload-band">
            <div className="upload-shell">
              <div className="upload-copy">
                <div className="upload-mark" aria-hidden="true">
                  <Loader2 className="spin" />
                </div>
                <h1>正在进入 KnowExper</h1>
                <p>正在确认登录状态和个人模型配置。</p>
              </div>
            </div>
          </section>
        </main>
      </>
    );
  }

  if (!authUser) {
    return (
      <>
        <header className="app-topbar">
          <div className="app-topbar-inner">
            <div className="brand-lockup">
              <WandSparkles aria-hidden="true" />
              <span>KnowExper</span>
            </div>
          </div>
        </header>
        <main>
          <AuthWorkbench
            mode={authMode}
            email={authEmail}
            password={authPassword}
            loading={authSubmitting}
            error={authError}
            onModeChange={(mode) => {
              setAuthMode(mode);
              setAuthError("");
            }}
            onEmailChange={setAuthEmail}
            onPasswordChange={setAuthPassword}
            onSubmit={submitAuth}
          />
        </main>
      </>
    );
  }

  if (sortedSlides.length) {
    return (
      <SlidesDocumentView
        title={documentTitle}
        slides={sortedSlides}
        documentKind={documentKind}
        documentId={documentId}
        documentUrl={documentUrl}
        expectedPageCount={expectedPageCount}
        initialStatus={documentStatus}
        initialLastError={lastDocumentError}
        accessCode={accessCode}
        onReset={resetApp}
      />
    );
  }

  if (progress.active) {
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
            <button className="top-action" type="button" disabled>
              <Loader2 className="spin" aria-hidden="true" />
              <span>处理中</span>
            </button>
          </div>
        </header>

        <main>
          <ProcessingWorkbench
            title={documentTitle}
            documentKind={documentKind}
            selectedFile={selectedFile}
            progress={progress}
            documentUrl={documentUrl}
            expectedPageCount={expectedPageCount}
            onPickFile={() => fileInputRef.current?.click()}
          />
        </main>
      </>
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
          authUser={authUser}
          aiCredential={aiCredential}
          aiForm={aiForm}
          apiConfigSaving={apiConfigSaving}
          apiConfigError={apiConfigError}
          progress={progress}
          error={error}
          selectedFile={selectedFile}
          accessCode={accessCode}
          onAccessCodeChange={updateAccessCode}
          libraryDocuments={visibleLibraryDocuments}
          startPage={startPage}
          endPage={endPage}
          onStartPageChange={setStartPage}
          onEndPageChange={setEndPage}
          uploadKind={uploadKind}
          onUploadKindChange={(kind) => {
            setUploadKind(kind);
            if (!slides.length) setDocumentKind(kind);
            if (kind === "academic_paper") {
              setStartPage("");
              setEndPage("");
            }
          }}
          onAiConfigFormChange={(form) => {
            setAiForm(form);
            setApiConfigError("");
          }}
          onSaveAiConfig={saveAiConfig}
          onDeleteAiConfig={deleteAiConfig}
          onLogout={logout}
          onPickFile={() => fileInputRef.current?.click()}
          onDropFile={(file) => void processFile(file)}
          onRenameDocument={renameLibraryDocument}
          onDeleteDocument={deleteLibraryDocument}
        />
      </main>
    </>
  );
}
