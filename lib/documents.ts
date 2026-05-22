import "server-only";

import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { DocumentKind, SlideExplanation, SlideResult } from "./types";

export type StoredDocument = {
  version: 1;
  id: string;
  fileHash: string;
  fileName: string;
  title: string;
  documentKind?: DocumentKind;
  pageCount: number;
  slides: SlideResult[];
  createdAt: string;
  updatedAt: string;
};

const DOCUMENT_STORE_DIR = process.env.DOCUMENT_STORE_DIR || path.join(process.cwd(), "data", "documents");

function safeDocumentId(id: string) {
  return /^[a-f0-9]{64}$/.test(id);
}

function documentPath(id: string) {
  if (!safeDocumentId(id)) {
    throw new Error("无效的文档 ID。");
  }

  return path.join(DOCUMENT_STORE_DIR, `${id}.json`);
}

export function hashPdfBytes(bytes: ArrayBuffer | Uint8Array) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return createHash("sha256").update(buffer).digest("hex");
}

export function documentUrl(id: string) {
  return `/documents/${id}`;
}

export async function getStoredDocument(id: string) {
  if (!safeDocumentId(id)) return null;

  try {
    const raw = await readFile(documentPath(id), "utf8");
    return JSON.parse(raw) as StoredDocument;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function saveStoredDocument(document: StoredDocument) {
  await mkdir(DOCUMENT_STORE_DIR, { recursive: true });
  await writeFile(documentPath(document.id), JSON.stringify(document, null, 2));
}

export async function createStoredDocument({
  fileHash,
  fileName,
  title,
  documentKind,
  slides,
}: {
  fileHash: string;
  fileName: string;
  title: string;
  documentKind?: DocumentKind;
  slides: SlideResult[];
}) {
  const now = new Date().toISOString();
  const existing = await getStoredDocument(fileHash);

  const document: StoredDocument = {
    version: 1,
    id: fileHash,
    fileHash,
    fileName,
    title,
    documentKind,
    pageCount: slides.length,
    slides,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await saveStoredDocument(document);
  return document;
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
  document.updatedAt = new Date().toISOString();

  await saveStoredDocument(document);
  return document.slides[slideIndex];
}
