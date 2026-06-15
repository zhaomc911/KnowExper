import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  AI_PROVIDER_PRESETS,
  deleteUserAiCredential,
  getUserAiCredentialSummary,
  setUserAiCredential,
} from "@/lib/user-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const credential = await getUserAiCredentialSummary(user.id);
  return NextResponse.json({
    credential,
    providers: AI_PROVIDER_PRESETS,
  });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      provider?: unknown;
      baseURL?: unknown;
      apiKey?: unknown;
      model?: unknown;
      supportsVision?: unknown;
    };
    const credential = await setUserAiCredential(user.id, body);

    return NextResponse.json({ credential });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法保存 API 配置。" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  await deleteUserAiCredential(user.id);
  return NextResponse.json({ credential: null });
}
