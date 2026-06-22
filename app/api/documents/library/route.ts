import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listStoredDocuments, saveLibraryOrganization, type LibraryOrganization } from "@/lib/documents";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  let organization: LibraryOrganization;
  try {
    const body = (await request.json()) as { organization?: LibraryOrganization };
    if (!body.organization || typeof body.organization !== "object") {
      throw new Error("文档库组织数据无效。");
    }
    organization = body.organization;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文档库组织数据无效。" },
      { status: 400 },
    );
  }

  try {
    const documents = await listStoredDocuments(user.id);
    const normalized = await saveLibraryOrganization({
      ownerId: user.id,
      organization,
      documentIds: documents.map((document) => document.id),
    });

    return NextResponse.json({ libraryOrganization: normalized });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法保存文档库组织。" },
      { status: 400 },
    );
  }
}
