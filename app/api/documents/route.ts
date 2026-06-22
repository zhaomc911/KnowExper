import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLibraryOrganization, listLibraryTitleOverrides, listStoredDocuments } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ documents: [], titleOverrides: {} });
  }

  const documents = await listStoredDocuments(user.id);
  const titleOverrides = await listLibraryTitleOverrides(user.id);
  const libraryOrganization = await getLibraryOrganization(
    user.id,
    documents.map((document) => document.id),
  );

  return NextResponse.json({ documents, titleOverrides, libraryOrganization });
}
