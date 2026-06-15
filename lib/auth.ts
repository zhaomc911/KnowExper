import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getUserById, publicUser, type UserRecord } from "./user-store";

export const AUTH_COOKIE_NAME = "knowexper_session";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

export type AuthUser = ReturnType<typeof publicUser>;

function sessionSecret() {
  const configured = process.env.SESSION_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("缺少 SESSION_SECRET，无法创建登录会话。");
  }

  return configured || "knowexper-local-dev-session-secret";
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed || typeof parsed.sub !== "string" || typeof parsed.exp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function createSessionToken(user: Pick<UserRecord, "id">) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodePayload({
    sub: user.id,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  });

  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string) {
  const [payloadText, signature] = token.split(".");
  if (!payloadText || !signature) return null;

  const expected = sign(payloadText);
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(signature);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    return null;
  }

  const payload = decodePayload(payloadText);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const prefix = `${name}=`;
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!entry) return "";

  return decodeURIComponent(entry.slice(prefix.length));
}

export async function getCurrentUser(request: Request): Promise<AuthUser | null> {
  const token = cookieValue(request, AUTH_COOKIE_NAME);
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await getUserById(payload.sub);
  return user ? publicUser(user) : null;
}

export async function requireCurrentUser(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    throw new Error("请先登录。");
  }

  return user;
}

export function attachSessionCookie(response: NextResponse, user: Pick<UserRecord, "id">) {
  response.cookies.set(AUTH_COOKIE_NAME, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export function authErrorResponse(message = "请先登录。", status = 401) {
  return NextResponse.json({ error: message }, { status });
}
