import "server-only";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult =
  | {
      allowed: true;
      remaining: number;
      resetAt: number;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      resetAt: number;
    };

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let activeJobs = 0;

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();

  return forwarded || realIp || cloudflareIp || "local";
}

export function checkRateLimit(request: Request, scope: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const ip = getClientIp(request);
  const key = `${scope}:${ip}`;
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - 1),
      resetAt: now + windowMs,
    };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - existing.count),
    resetAt: existing.resetAt,
  };
}

export function tryAcquireJobSlot(maxConcurrentJobs: number) {
  if (activeJobs >= maxConcurrentJobs) {
    return null;
  }

  activeJobs += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeJobs = Math.max(0, activeJobs - 1);
  };
}

export function assertNotAborted(signal: AbortSignal, message = "处理时间过长，任务已停止。请减少页数或稍后重试。") {
  if (signal.aborted) {
    throw new Error(message);
  }
}

export function createTimeoutController(timeoutMs: number, reason: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(reason)), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function publicErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "处理失败，请稍后重试。";
  }

  const message = error.message;
  const lower = message.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429")) {
    return "AI 网关请求过于频繁，请稍后重试。";
  }

  if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("401")) {
    return "AI 网关鉴权失败，请检查服务端 API Key 配置。";
  }

  if (lower.includes("model") && (lower.includes("not found") || lower.includes("unsupported"))) {
    return "当前模型不可用或不支持图片输入，请换成 Highland 中支持视觉的模型。";
  }

  if (lower.includes("connection error") || lower.includes("fetch failed") || lower.includes("network")) {
    return "AI 网关连接失败，请稍后重试。";
  }

  return message || "处理失败，请稍后重试。";
}
