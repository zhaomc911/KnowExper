import { NextResponse } from "next/server";
import { attachSessionCookie } from "@/lib/auth";
import { authenticateUser, publicUser } from "@/lib/user-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const user = await authenticateUser(body.email, body.password);
    if (!user) {
      return NextResponse.json({ error: "邮箱或密码不正确。" }, { status: 401 });
    }

    const response = NextResponse.json({ user: publicUser(user) });
    attachSessionCookie(response, user);

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败。" },
      { status: 400 },
    );
  }
}
