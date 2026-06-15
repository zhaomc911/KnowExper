import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canAccessStoredDocument,
  deleteStoredDocument,
  getStoredDocument,
  normalizeLibraryTitle,
  renameStoredDocument,
  setLibraryDocumentDeleted,
  setLibraryTitleOverride,
} from "@/lib/documents";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { id } = await params;
  const document = await getStoredDocument(id);

  if (!document || !canAccessStoredDocument(document, user.id)) {
    return NextResponse.json({ error: "文档不存在或已被清理。" }, { status: 404 });
  }

  return NextResponse.json({ document });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { id } = await params;

  let title: string;
  try {
    const body = (await request.json()) as { title?: unknown };
    title = normalizeLibraryTitle(body.title);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "标题格式无效。" },
      { status: 400 },
    );
  }

  const document = await renameStoredDocument(id, title, user.id);
  if (document) {
    return NextResponse.json({ document });
  }

  const storedDocument = await getStoredDocument(id);
  if (storedDocument && !canAccessStoredDocument(storedDocument, user.id)) {
    return NextResponse.json({ error: "文档不存在或无权访问。" }, { status: 404 });
  }

  try {
    const override = await setLibraryTitleOverride(id, title, user.id);
    return NextResponse.json({ document: override });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法重命名文档。" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const storedDocument = await getStoredDocument(id);
    if (storedDocument && !canAccessStoredDocument(storedDocument, user.id)) {
      return NextResponse.json({ error: "文档不存在或无权访问。" }, { status: 404 });
    }

    await deleteStoredDocument(id, user.id);
    const deletion = await setLibraryDocumentDeleted(id, user.id);
    return NextResponse.json({ document: deletion });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法删除文档。" },
      { status: 400 },
    );
  }
}
