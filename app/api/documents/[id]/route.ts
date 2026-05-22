import { NextResponse } from "next/server";
import { getStoredDocument } from "@/lib/documents";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const document = await getStoredDocument(id);

  if (!document) {
    return NextResponse.json({ error: "文档不存在或已被清理。" }, { status: 404 });
  }

  return NextResponse.json({ document });
}
