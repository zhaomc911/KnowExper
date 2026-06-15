"use client";

import { AlertCircle, Loader2, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { SlidesDocumentView } from "@/components/SlidesDocumentView";
import type { DocumentKind, SlideResult, StoredDocumentStatus } from "@/lib/types";

type StoredDocumentPayload = {
  id: string;
  title: string;
  slides: SlideResult[];
  documentKind?: DocumentKind;
  pageCount: number;
  status?: StoredDocumentStatus;
  lastError?: string;
};

type StoredDocumentResponse = {
  document?: StoredDocumentPayload;
  error?: string;
};

export function DocumentPageClient({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<StoredDocumentPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadDocument() {
      try {
        setError("");
        const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => ({}))) as StoredDocumentResponse;

        if (!response.ok || !data.document) {
          throw new Error(data.error || "文档不存在或暂时无法读取。");
        }

        if (!controller.signal.aborted) {
          setDocument(data.document);
          window.document.title = `${data.document.title} | KnowExper`;
        }
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setError(nextError instanceof Error ? nextError.message : "文档加载失败。");
      }
    }

    void loadDocument();

    return () => controller.abort();
  }, [documentId]);

  if (document) {
    return (
      <SlidesDocumentView
        title={document.title}
        slides={document.slides}
        documentKind={document.documentKind}
        documentId={document.id}
        documentUrl={`/documents/${document.id}`}
        expectedPageCount={document.pageCount}
        initialStatus={document.status}
        initialLastError={document.lastError}
      />
    );
  }

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
                {error ? <AlertCircle /> : <Loader2 className="spin" />}
              </div>
              <h1>{error ? "文档加载失败" : "正在打开文档"}</h1>
              <p>{error || "正在读取已保存的精讲内容。大文档首次通过公网隧道打开可能需要多等几秒。"}</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
