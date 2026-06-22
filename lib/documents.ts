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
export type LibraryKind = Extract<DocumentKind, "course_slides" | "academic_paper">;
export type LibraryFolder = {
  id: string;
  kind: LibraryKind;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};
export type LibraryDocumentPlacement = {
  folderId?: string;
  order: number;
  updatedAt: string;
};
export type LibraryOrganization = {
  folders: LibraryFolder[];
  placements: Record<string, LibraryDocumentPlacement>;
};

const DEFAULT_DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const DOCUMENT_STORE_DIR = process.env.DOCUMENT_STORE_DIR || path.join(/*turbopackIgnore: true*/ DEFAULT_DATA_DIR, "documents");
const LIBRARY_OVERRIDES_PATH =
  process.env.LIBRARY_OVERRIDES_PATH || path.join(/*turbopackIgnore: true*/ DEFAULT_DATA_DIR, "library-overrides.json");
const LIBRARY_ORGANIZATION_PATH =
  process.env.LIBRARY_ORGANIZATION_PATH || path.join(/*turbopackIgnore: true*/ DEFAULT_DATA_DIR, "library-organization.json");

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

function safeLibraryFolderId(id: string) {
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);
}

function safeLibraryKind(value: unknown): value is LibraryKind {
  return value === "course_slides" || value === "academic_paper";
}

export function normalizeLibraryFolderName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    throw new Error("文件夹名称不能为空。");
  }

  if (name.length > 80) {
    throw new Error("文件夹名称不能超过 80 个字符。");
  }

  return name;
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

type LibraryOrganizationStore = Record<string, LibraryOrganization>;

function libraryOwnerKey(ownerId?: string) {
  return ownerId || "__public__";
}

function normalizeLibraryOrder(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLibraryOrganization(
  value: unknown,
  validDocumentIds?: Set<string>,
): LibraryOrganization {
  const parsed = value && typeof value === "object" ? (value as Partial<LibraryOrganization>) : {};
  const now = new Date().toISOString();
  const folders: LibraryFolder[] = [];
  const folderIds = new Set<string>();

  for (const [index, rawFolder] of Array.isArray(parsed.folders) ? parsed.folders.entries() : []) {
    if (!rawFolder || typeof rawFolder !== "object") continue;
    const folder = rawFolder as Partial<LibraryFolder>;
    if (typeof folder.id !== "string" || !safeLibraryFolderId(folder.id)) continue;
    if (!safeLibraryKind(folder.kind)) continue;
    if (folderIds.has(folder.id)) continue;

    let name: string;
    try {
      name = normalizeLibraryFolderName(folder.name);
    } catch {
      continue;
    }

    const createdAt = typeof folder.createdAt === "string" ? folder.createdAt : now;
    const updatedAt = typeof folder.updatedAt === "string" ? folder.updatedAt : createdAt;
    folders.push({
      id: folder.id,
      kind: folder.kind,
      name,
      order: normalizeLibraryOrder(folder.order, index),
      createdAt,
      updatedAt,
    });
    folderIds.add(folder.id);
  }

  const placements: Record<string, LibraryDocumentPlacement> = {};
  const rawPlacements =
    parsed.placements && typeof parsed.placements === "object" ? parsed.placements : {};
  for (const [documentId, rawPlacement] of Object.entries(rawPlacements)) {
    if (!safeDocumentId(documentId)) continue;
    if (validDocumentIds && !validDocumentIds.has(documentId)) continue;
    if (!rawPlacement || typeof rawPlacement !== "object") continue;

    const placement = rawPlacement as Partial<LibraryDocumentPlacement>;
    const folderId =
      typeof placement.folderId === "string" && folderIds.has(placement.folderId)
        ? placement.folderId
        : undefined;
    placements[documentId] = {
      folderId,
      order: normalizeLibraryOrder(placement.order, Object.keys(placements).length),
      updatedAt: typeof placement.updatedAt === "string" ? placement.updatedAt : now,
    };
  }

  folders.sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order || a.name.localeCompare(b.name));

  return { folders, placements };
}

async function readRawLibraryOrganizationStore(): Promise<LibraryOrganizationStore> {
  try {
    const raw = await readFile(LIBRARY_ORGANIZATION_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    const store: LibraryOrganizationStore = {};
    for (const [ownerKey, organization] of Object.entries(parsed)) {
      store[ownerKey] = normalizeLibraryOrganization(organization);
    }

    return store;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function getLibraryOrganization(ownerId?: string, documentIds?: string[]): Promise<LibraryOrganization> {
  const store = await readRawLibraryOrganizationStore();
  const validDocumentIds = documentIds ? new Set(documentIds.filter(safeDocumentId)) : undefined;
  return normalizeLibraryOrganization(store[libraryOwnerKey(ownerId)], validDocumentIds);
}

export async function saveLibraryOrganization({
  ownerId,
  organization,
  documentIds,
}: {
  ownerId?: string;
  organization: LibraryOrganization;
  documentIds?: string[];
}) {
  const store = await readRawLibraryOrganizationStore();
  const validDocumentIds = documentIds ? new Set(documentIds.filter(safeDocumentId)) : undefined;
  const normalized = normalizeLibraryOrganization(organization, validDocumentIds);
  store[libraryOwnerKey(ownerId)] = normalized;

  await mkdir(path.dirname(LIBRARY_ORGANIZATION_PATH), { recursive: true });
  await writeFile(LIBRARY_ORGANIZATION_PATH, JSON.stringify(store, null, 2));

  return normalized;
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
