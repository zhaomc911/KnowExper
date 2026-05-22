import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SlidesDocumentView } from "@/components/SlidesDocumentView";
import { documentUrl, getStoredDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const document = await getStoredDocument(id);

  return {
    title: document ? `${document.title} | Slides Explainer` : "Document not found",
  };
}

export default async function StoredDocumentPage({ params }: PageProps) {
  const { id } = await params;
  const document = await getStoredDocument(id);

  if (!document) {
    notFound();
  }

  return (
    <SlidesDocumentView
      title={document.title}
      slides={document.slides}
      documentId={document.id}
      documentUrl={documentUrl(document.id)}
    />
  );
}
