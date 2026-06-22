export const DEFAULT_MAX_UPLOAD_MB = 100;
export const DEFAULT_MAX_PAGES = 100;
export const DEFAULT_MAX_PAPER_PAGES = 30;
export const DEFAULT_MAX_SOURCE_PAGES = 500;
export const DEFAULT_COURSE_SOURCE_PAGES_PER_UNIT = 10;
export const DEFAULT_RENDER_SCALE = 1.8;
export const DEFAULT_RATE_LIMIT_WINDOW_MIN = 15;
export const DEFAULT_PROCESS_RATE_LIMIT = 6;
export const DEFAULT_REGENERATE_RATE_LIMIT = 30;
export const DEFAULT_ASK_RATE_LIMIT = 60;
export const DEFAULT_MAX_CONCURRENT_JOBS = 2;
export const DEFAULT_AI_REQUEST_TIMEOUT_SECONDS = 90;
export const DEFAULT_TOTAL_JOB_TIMEOUT_SECONDS = 3600;
export const DEFAULT_SLIDE_TEXT_CHAR_LIMIT = 5000;

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, parsed));
}

export function getProcessingLimits() {
  const maxUploadMb = numberFromEnv("MAX_UPLOAD_MB", DEFAULT_MAX_UPLOAD_MB, 1, 500);
  const maxPages = numberFromEnv("MAX_PAGES", DEFAULT_MAX_PAGES, 1, 100);
  const maxPaperPages = numberFromEnv("MAX_PAPER_PAGES", Math.min(DEFAULT_MAX_PAPER_PAGES, maxPages), 1, maxPages);
  const maxSourcePages = numberFromEnv("MAX_SOURCE_PAGES", DEFAULT_MAX_SOURCE_PAGES, maxPages, 1500);
  const defaultCourseSourcePages = Math.min(
    1500,
    Math.max(maxSourcePages, maxPages * DEFAULT_COURSE_SOURCE_PAGES_PER_UNIT),
  );
  const maxCourseSourcePages = numberFromEnv(
    "MAX_COURSE_SOURCE_PAGES",
    defaultCourseSourcePages,
    maxPages,
    1500,
  );
  const renderScale = numberFromEnv("PDF_RENDER_SCALE", DEFAULT_RENDER_SCALE, 1, 3);

  return {
    maxUploadMb,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    maxPages,
    maxPaperPages,
    maxSourcePages,
    maxCourseSourcePages,
    renderScale,
  };
}

export function getHardeningConfig() {
  const rateLimitWindowMin = numberFromEnv("RATE_LIMIT_WINDOW_MIN", DEFAULT_RATE_LIMIT_WINDOW_MIN, 1, 1440);
  const processRateLimit = numberFromEnv("PROCESS_RATE_LIMIT", DEFAULT_PROCESS_RATE_LIMIT, 1, 100);
  const regenerateRateLimit = numberFromEnv("REGENERATE_RATE_LIMIT", DEFAULT_REGENERATE_RATE_LIMIT, 1, 300);
  const askRateLimit = numberFromEnv("ASK_RATE_LIMIT", DEFAULT_ASK_RATE_LIMIT, 1, 600);
  const maxConcurrentJobs = numberFromEnv("MAX_CONCURRENT_JOBS", DEFAULT_MAX_CONCURRENT_JOBS, 1, 20);
  const aiRequestTimeoutSeconds = numberFromEnv(
    "AI_REQUEST_TIMEOUT_SECONDS",
    DEFAULT_AI_REQUEST_TIMEOUT_SECONDS,
    10,
    300,
  );
  const totalJobTimeoutSeconds = numberFromEnv(
    "TOTAL_JOB_TIMEOUT_SECONDS",
    DEFAULT_TOTAL_JOB_TIMEOUT_SECONDS,
    30,
    3600,
  );
  const slideTextCharLimit = numberFromEnv("SLIDE_TEXT_CHAR_LIMIT", DEFAULT_SLIDE_TEXT_CHAR_LIMIT, 500, 20000);

  return {
    rateLimitWindowMin,
    rateLimitWindowMs: rateLimitWindowMin * 60 * 1000,
    processRateLimit,
    regenerateRateLimit,
    askRateLimit,
    maxConcurrentJobs,
    aiRequestTimeoutSeconds,
    aiRequestTimeoutMs: aiRequestTimeoutSeconds * 1000,
    totalJobTimeoutSeconds,
    totalJobTimeoutMs: totalJobTimeoutSeconds * 1000,
    slideTextCharLimit,
  };
}
