import { NextResponse } from "next/server";
import { attachSessionCookie } from "@/lib/auth";
import { createUser, publicUser } from "@/lib/user-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const user = await createUser(body.email, body.password);
    const response = NextResponse.json({ user: publicUser(user) });
    attachSessionCookie(response, user);

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败。" },
      { status: 400 },
    );
  }
}
