import type { Metadata } from "next";
import { DocumentPageClient } from "./DocumentPageClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  return {
    title: `${id.slice(0, 8)} | KnowExper`,
  };
}

export default async function StoredDocumentPage({ params }: PageProps) {
  const { id } = await params;
  return <DocumentPageClient documentId={id} />;
}
