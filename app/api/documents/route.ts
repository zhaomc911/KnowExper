import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listLibraryTitleOverrides, listStoredDocuments } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ documents: [], titleOverrides: {} });
  }

  const documents = await listStoredDocuments(user.id);
  const titleOverrides = await listLibraryTitleOverrides(user.id);
  return NextResponse.json({ documents, titleOverrides });
}
