import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);

const DEFAULT_DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const USER_STORE_PATH =
  process.env.USER_STORE_PATH || path.join(/*turbopackIgnore: true*/ DEFAULT_DATA_DIR, "users.json");

const PASSWORD_HASH_BYTES = 64;
const API_KEY_VERSION = "v1";

export type AiProviderId = "openai-compatible" | "highland" | "openai" | "deepseek";

export type AiCredentialSummary = {
  provider: AiProviderId;
  providerLabel: string;
  baseURL?: string;
  model: string;
  supportsVision: boolean;
  apiKeyLast4: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
};

export type ResolvedAiCredential = AiCredentialSummary & {
  apiKey: string;
};

type StoredAiCredential = {
  provider: AiProviderId;
  providerLabel: string;
  baseURL?: string;
  model: string;
  supportsVision: boolean;
  encryptedApiKey: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  apiKeyLast4: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
};

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
  aiCredential?: StoredAiCredential;
};

type UserStoreFile = {
  version: 1;
  users: UserRecord[];
};

export const AI_PROVIDER_PRESETS: Record<
  AiProviderId,
  {
    label: string;
    defaultBaseURL?: string;
    requiresBaseURL: boolean;
    defaultModel: string;
    defaultSupportsVision: boolean;
  }
> = {
  "openai-compatible": {
    label: "OpenAI-compatible",
    requiresBaseURL: true,
    defaultModel: "gpt-4o-mini",
    defaultSupportsVision: true,
  },
  highland: {
    label: "Highland",
    requiresBaseURL: true,
    defaultModel: "gpt-4o-mini",
    defaultSupportsVision: true,
  },
  openai: {
    label: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    requiresBaseURL: false,
    defaultModel: "gpt-4o-mini",
    defaultSupportsVision: true,
  },
  deepseek: {
    label: "DeepSeek",
    defaultBaseURL: "https://api.deepseek.com",
    requiresBaseURL: false,
    defaultModel: "deepseek-chat",
    defaultSupportsVision: false,
  },
};

export function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("请输入有效邮箱。");
  }

  return email;
}

export function normalizePassword(value: unknown) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 8) {
    throw new Error("密码至少需要 8 个字符。");
  }

  if (password.length > 256) {
    throw new Error("密码过长。");
  }

  return password;
}

async function readUserStore(): Promise<UserStoreFile> {
  try {
    const raw = await readFile(USER_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as UserStoreFile;

    return {
      version: 1,
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: 1, users: [] };
    }

    throw error;
  }
}

async function writeUserStore(store: UserStoreFile) {
  await mkdir(path.dirname(USER_STORE_PATH), { recursive: true });
  await writeFile(USER_STORE_PATH, JSON.stringify(store, null, 2));
}

async function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const hash = (await scrypt(password, salt, PASSWORD_HASH_BYTES)) as Buffer;

  return {
    salt,
    hash: hash.toString("base64url"),
  };
}

async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const hash = (await scrypt(password, salt, PASSWORD_HASH_BYTES)) as Buffer;
  const expected = Buffer.from(expectedHash, "base64url");
  if (hash.length !== expected.length) return false;

  return timingSafeEqual(hash, expected);
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    aiCredential: credentialSummary(user.aiCredential),
  };
}

export async function createUser(emailValue: unknown, passwordValue: unknown) {
  const email = normalizeEmail(emailValue);
  const password = normalizePassword(passwordValue);
  const store = await readUserStore();

  if (store.users.some((user) => user.email === email)) {
    throw new Error("这个邮箱已经注册。");
  }

  const now = new Date().toISOString();
  const passwordDigest = await hashPassword(password);
  const user: UserRecord = {
    id: randomBytes(16).toString("hex"),
    email,
    passwordHash: passwordDigest.hash,
    passwordSalt: passwordDigest.salt,
    createdAt: now,
    updatedAt: now,
  };

  store.users.push(user);
  await writeUserStore(store);

  return user;
}

export async function authenticateUser(emailValue: unknown, passwordValue: unknown) {
  const email = normalizeEmail(emailValue);
  const password = normalizePassword(passwordValue);
  const store = await readUserStore();
  const user = store.users.find((item) => item.email === email);

  if (!user) return null;
  const passwordMatches = await verifyPassword(password, user.passwordSalt, user.passwordHash);
  return passwordMatches ? user : null;
}

export async function getUserById(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;

  const store = await readUserStore();
  return store.users.find((user) => user.id === id) ?? null;
}

function encryptionKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("缺少 CREDENTIAL_ENCRYPTION_KEY，无法安全保存用户 API Key。");
  }

  const raw = configured || "knowexper-local-dev-credential-key";

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall back to a stable hash of the configured string.
  }

  return createHash("sha256").update(raw).digest();
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedApiKey: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}

function decryptSecret(credential: StoredAiCredential) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(credential.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(credential.authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(credential.encryptedApiKey, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function credentialSummary(credential: StoredAiCredential | undefined): AiCredentialSummary | null {
  if (!credential) return null;

  return {
    provider: credential.provider,
    providerLabel: credential.providerLabel,
    baseURL: credential.baseURL,
    model: credential.model,
    supportsVision: credential.supportsVision,
    apiKeyLast4: credential.apiKeyLast4,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    lastValidatedAt: credential.lastValidatedAt,
  };
}

function normalizeProvider(value: unknown): AiProviderId {
  if (
    value === "openai-compatible" ||
    value === "highland" ||
    value === "openai" ||
    value === "deepseek"
  ) {
    return value;
  }

  throw new Error("暂不支持这个模型服务。");
}

function normalizeModel(value: unknown, provider: AiProviderId) {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model) return AI_PROVIDER_PRESETS[provider].defaultModel;
  if (model.length > 120) throw new Error("模型名称过长。");

  return model;
}

function isPrivateHost(hostname: string) {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "0.0.0.0" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local")
  ) {
    return true;
  }

  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;

    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.includes("::ffff:127.") ||
    lower.includes("::ffff:10.") ||
    lower.includes("::ffff:192.168.")
  ) {
    return true;
  }

  return false;
}

function normalizeBaseURL(value: unknown, provider: AiProviderId) {
  const preset = AI_PROVIDER_PRESETS[provider];
  const raw = typeof value === "string" ? value.trim() : "";
  const candidate = raw || preset.defaultBaseURL || "";

  if (!candidate) {
    if (preset.requiresBaseURL) throw new Error("请填写 Base URL。");
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Base URL 格式无效。");
  }

  if (url.protocol !== "https:") {
    throw new Error("Base URL 必须使用 https。");
  }

  if (url.username || url.password) {
    throw new Error("Base URL 不能包含用户名或密码。");
  }

  if (isPrivateHost(url.hostname)) {
    throw new Error("Base URL 不能指向本机或内网地址。");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeApiKey(value: unknown) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (apiKey.length < 8) throw new Error("请填写有效 API Key。");
  if (apiKey.length > 4096) throw new Error("API Key 过长。");

  return apiKey;
}

export async function setUserAiCredential(
  userId: string,
  input: {
    provider?: unknown;
    baseURL?: unknown;
    apiKey?: unknown;
    model?: unknown;
    supportsVision?: unknown;
  },
) {
  const provider = normalizeProvider(input.provider);
  const apiKey = normalizeApiKey(input.apiKey);
  const baseURL = normalizeBaseURL(input.baseURL, provider);
  const model = normalizeModel(input.model, provider);
  const supportsVision =
    typeof input.supportsVision === "boolean"
      ? input.supportsVision
      : AI_PROVIDER_PRESETS[provider].defaultSupportsVision;
  const store = await readUserStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("用户不存在。");

  const now = new Date().toISOString();
  const encrypted = encryptSecret(apiKey);
  user.aiCredential = {
    provider,
    providerLabel: AI_PROVIDER_PRESETS[provider].label,
    baseURL,
    model,
    supportsVision,
    ...encrypted,
    keyVersion: API_KEY_VERSION,
    apiKeyLast4: apiKey.slice(-4),
    createdAt: user.aiCredential?.createdAt ?? now,
    updatedAt: now,
    lastValidatedAt: now,
  };
  user.updatedAt = now;

  await writeUserStore(store);
  return credentialSummary(user.aiCredential);
}

export async function deleteUserAiCredential(userId: string) {
  const store = await readUserStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) return false;

  delete user.aiCredential;
  user.updatedAt = new Date().toISOString();
  await writeUserStore(store);

  return true;
}

export async function getUserAiCredentialSummary(userId: string) {
  const user = await getUserById(userId);
  return credentialSummary(user?.aiCredential);
}

export async function getResolvedUserAiCredential(userId: string): Promise<ResolvedAiCredential | null> {
  const user = await getUserById(userId);
  if (!user?.aiCredential) return null;

  const summary = credentialSummary(user.aiCredential);
  if (!summary) return null;

  return {
    ...summary,
    apiKey: decryptSecret(user.aiCredential),
  };
}
