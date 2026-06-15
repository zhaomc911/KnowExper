import "server-only";

import { createHash } from "crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import path from "path";
import type {
  DocumentKind,
  PageRange,
  SlideExplanation,
  SlideResult,
  SourceType,
  StoredDocumentStatus,
} from "./types";

export type StoredDocument = {
  version: 1;
  id: string;
  ownerId?: string;
  fileHash: string;
  fileName: string;
  title: string;
  documentKind?: DocumentKind;
  sourceType?: SourceType;
  pageRange?: PageRange;
  status?: StoredDocumentStatus;
  pageCount: number;
  completedPageCount?: number;
  sourcePageCount?: number;
  collapsedPageCount?: number;
  slides: SlideResult[];
  completedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredDocumentSummary = Pick<
  StoredDocument,
  | "id"
  | "fileName"
  | "title"
  | "documentKind"
  | "sourceType"
  | "pageRange"
  | "pageCount"
  | "sourcePageCount"
  | "collapsedPageCount"
  | "lastError"
  | "createdAt"
  | "updatedAt"
> & {
  status: StoredDocumentStatus;
  completedPageCount: number;
  url: string;
};

export type LibraryTitleOverrides = Record<string, { title?: string; updatedAt: string; deleted?: boolean }>;

const DEFAULT_DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const DOCUMENT_STORE_DIR = process.env.DOCUMENT_STORE_DIR || path.join(/*turbopackIgnore: true*/ DEFAULT_DATA_DIR, "documents");
const LIBRARY_OVERRIDES_PATH =
  process.env.LIBRARY_OVERRIDES_PATH || path.join(/*turbopackIgnore: true*/ DEFAULT_DATA_DIR, "library-overrides.json");

function safeDocumentId(id: string) {
  return /^[a-f0-9]{64}$/.test(id);
}

function documentPath(id: string) {
  if (!safeDocumentId(id)) {
    throw new Error("无效的文档 ID。");
  }

  return path.join(/*turbopackIgnore: true*/ DOCUMENT_STORE_DIR, `${id}.json`);
}

function safeLibraryDocumentId(id: string) {
  return safeDocumentId(id) || /^[a-z0-9][a-z0-9-]{0,100}$/.test(id);
}

function generatedSlideCount(slides: SlideResult[]) {
  return slides.filter((slide) => Boolean(slide.explanation)).length;
}

function normalizeStoredDocument(document: StoredDocument): StoredDocument {
  const status = document.status ?? "complete";
  const completedPageCount = document.completedPageCount ?? generatedSlideCount(document.slides);

  return {
    ...document,
    status,
    pageCount: document.pageCount ?? document.slides.length,
    completedPageCount,
  };
}

function storedDocumentSummary(document: StoredDocument): StoredDocumentSummary {
  const normalized = normalizeStoredDocument(document);

  return {
    id: normalized.id,
    fileName: normalized.fileName,
    title: normalized.title,
    documentKind: normalized.documentKind,
    sourceType: normalized.sourceType,
    pageRange: normalized.pageRange,
    status: normalized.status ?? "complete",
    pageCount: normalized.pageCount,
    completedPageCount: normalized.completedPageCount ?? 0,
    sourcePageCount: normalized.sourcePageCount,
    collapsedPageCount: normalized.collapsedPageCount,
    lastError: normalized.lastError,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    url: documentUrl(normalized.id),
  };
}

export function normalizeLibraryTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!title) {
    throw new Error("标题不能为空。");
  }

  if (title.length > 160) {
    throw new Error("标题不能超过 160 个字符。");
  }

  return title;
}

export function hashPdfBytes(bytes: ArrayBuffer | Uint8Array, salt = "") {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hash = createHash("sha256").update(buffer);
  if (salt) hash.update(`\n${salt}`);
  return hash.digest("hex");
}

export function documentUrl(id: string) {
  return `/documents/${id}`;
}

export async function getStoredDocument(id: string) {
  if (!safeDocumentId(id)) return null;

  try {
    const raw = await readFile(documentPath(id), "utf8");
    return normalizeStoredDocument(JSON.parse(raw) as StoredDocument);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function userCanAccessDocument(document: StoredDocument, ownerId?: string) {
  if (!ownerId) return true;
  return document.ownerId === ownerId;
}

export function canAccessStoredDocument(document: StoredDocument, ownerId: string) {
  return userCanAccessDocument(document, ownerId);
}

export async function listStoredDocuments(ownerId?: string): Promise<StoredDocumentSummary[]> {
  try {
    const entries = await readdir(DOCUMENT_STORE_DIR, { withFileTypes: true });
    const documents: Array<StoredDocumentSummary | null> = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const id = entry.name.replace(/\.json$/, "");
          if (!safeDocumentId(id)) return null;

          try {
            const document = await getStoredDocument(id);
            if (!document) return null;
            if (!userCanAccessDocument(document, ownerId)) return null;

            return storedDocumentSummary(document);
          } catch {
            return null;
          }
        }),
    );

    return documents
      .filter((document): document is StoredDocumentSummary => Boolean(document))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function libraryOverrideKey(id: string, ownerId?: string) {
  return ownerId ? `${ownerId}:${id}` : id;
}

function parseLibraryOverrideKey(key: string) {
  const match = key.match(/^([a-f0-9]{32}):(.+)$/);
  if (!match) {
    return { ownerId: undefined, id: key };
  }

  return { ownerId: match[1], id: match[2] };
}

export async function listLibraryTitleOverrides(ownerId?: string): Promise<LibraryTitleOverrides> {
  try {
    const raw = await readFile(LIBRARY_OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw) as LibraryTitleOverrides;
    const overrides: LibraryTitleOverrides = {};

    for (const [key, override] of Object.entries(parsed)) {
      const parsedKey = parseLibraryOverrideKey(key);
      if (ownerId && parsedKey.ownerId !== ownerId) continue;
      if (!ownerId && parsedKey.ownerId) continue;
      const id = parsedKey.id;

      if (!safeLibraryDocumentId(id)) continue;
      if (!override || typeof override !== "object") continue;
      if (typeof override.updatedAt !== "string") continue;
      if (!override.deleted && typeof override.title !== "string") continue;
      overrides[id] = {
        title: override.title,
        updatedAt: override.updatedAt,
        deleted: Boolean(override.deleted),
      };
    }

    return overrides;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function readRawLibraryTitleOverrides(): Promise<LibraryTitleOverrides> {
  try {
    const raw = await readFile(LIBRARY_OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw) as LibraryTitleOverrides;

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function setLibraryTitleOverride(id: string, title: string, ownerId?: string) {
  if (!safeLibraryDocumentId(id)) {
    throw new Error("无效的文档 ID。");
  }

  const updatedAt = new Date().toISOString();
  const rawOverrides = await readRawLibraryTitleOverrides();
  rawOverrides[libraryOverrideKey(id, ownerId)] = { title, updatedAt, deleted: false };

  await mkdir(path.dirname(LIBRARY_OVERRIDES_PATH), { recursive: true });
  await writeFile(LIBRARY_OVERRIDES_PATH, JSON.stringify(rawOverrides, null, 2));

  return { id, title, updatedAt };
}

export async function setLibraryDocumentDeleted(id: string, ownerId?: string) {
  if (!safeLibraryDocumentId(id)) {
    throw new Error("无效的文档 ID。");
  }

  const updatedAt = new Date().toISOString();
  const rawOverrides = await readRawLibraryTitleOverrides();
  const key = libraryOverrideKey(id, ownerId);
  rawOverrides[key] = { ...rawOverrides[key], updatedAt, deleted: true };

  await mkdir(path.dirname(LIBRARY_OVERRIDES_PATH), { recursive: true });
  await writeFile(LIBRARY_OVERRIDES_PATH, JSON.stringify(rawOverrides, null, 2));

  return { id, updatedAt, deleted: true };
}

export async function deleteStoredDocument(id: string, ownerId?: string) {
  if (!safeDocumentId(id)) return false;

  try {
    const document = await getStoredDocument(id);
    if (!document || !userCanAccessDocument(document, ownerId)) return false;

    await unlink(documentPath(id));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function saveStoredDocument(document: StoredDocument) {
  await mkdir(DOCUMENT_STORE_DIR, { recursive: true });
  await writeFile(documentPath(document.id), JSON.stringify(document, null, 2));
}

export async function renameStoredDocument(id: string, title: string, ownerId?: string) {
  const document = await getStoredDocument(id);
  if (!document) return null;
  if (!userCanAccessDocument(document, ownerId)) return null;

  document.title = title;
  document.updatedAt = new Date().toISOString();
  await saveStoredDocument(document);

  return storedDocumentSummary(document);
}

export async function createStoredDocument({
  fileHash,
  ownerId,
  fileName,
  title,
  documentKind,
  sourceType,
  pageRange,
  status = "complete",
  sourcePageCount,
  collapsedPageCount,
  lastError,
  slides,
}: {
  fileHash: string;
  ownerId?: string;
  fileName: string;
  title: string;
  documentKind?: DocumentKind;
  sourceType?: SourceType;
  pageRange?: StoredDocument["pageRange"];
  status?: StoredDocumentStatus;
  sourcePageCount?: number;
  collapsedPageCount?: number;
  lastError?: string;
  slides: SlideResult[];
}) {
  const now = new Date().toISOString();
  const existing = await getStoredDocument(fileHash);
  const completedPageCount = generatedSlideCount(slides);

  const document: StoredDocument = {
    version: 1,
    id: fileHash,
    ownerId,
    fileHash,
    fileName,
    title,
    documentKind,
    sourceType,
    pageRange,
    status,
    pageCount: slides.length,
    completedPageCount,
    sourcePageCount,
    collapsedPageCount,
    slides,
    completedAt: status === "complete" ? now : undefined,
    lastError: status === "partial" ? lastError : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await saveStoredDocument(document);
  return document;
}

export async function updateStoredDocumentStatus({
  documentId,
  status,
  lastError,
}: {
  documentId: string;
  status: StoredDocumentStatus;
  lastError?: string;
}) {
  const document = await getStoredDocument(documentId);
  if (!document) return null;

  const now = new Date().toISOString();
  document.status = status;
  document.completedPageCount = generatedSlideCount(document.slides);
  document.updatedAt = now;
  document.completedAt = status === "complete" ? now : undefined;
  document.lastError = status === "partial" ? lastError : undefined;

  await saveStoredDocument(document);
  return document;
}

export async function updateStoredSlideResult({
  documentId,
  slide,
  status = "processing",
}: {
  documentId: string;
  slide: SlideResult;
  status?: StoredDocumentStatus;
}) {
  const document = await getStoredDocument(documentId);
  if (!document) return null;

  const slideIndex = document.slides.findIndex((item) => item.pageNumber === slide.pageNumber);
  if (slideIndex === -1) return null;

  document.slides[slideIndex] = slide;
  document.status = status;
  document.completedPageCount = generatedSlideCount(document.slides);
  document.updatedAt = new Date().toISOString();
  document.lastError = undefined;

  await saveStoredDocument(document);
  return document.slides[slideIndex];
}

export async function updateStoredSlideExplanation({
  documentId,
  pageNumber,
  explanation,
}: {
  documentId: string;
  pageNumber: number;
  explanation: SlideExplanation;
}) {
  const document = await getStoredDocument(documentId);
  if (!document) return null;

  const slideIndex = document.slides.findIndex((slide) => slide.pageNumber === pageNumber);
  if (slideIndex === -1) return null;

  document.slides[slideIndex] = {
    ...document.slides[slideIndex],
    explanation,
    error: undefined,
  };
  document.completedPageCount = generatedSlideCount(document.slides);
  if ((document.status === "partial" || document.status === "processing") && document.completedPageCount >= document.pageCount) {
    document.status = "complete";
    document.completedAt = new Date().toISOString();
    document.lastError = undefined;
  }
  document.updatedAt = new Date().toISOString();

  await saveStoredDocument(document);
  return document.slides[slideIndex];
}
