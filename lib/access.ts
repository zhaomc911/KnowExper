import { timingSafeEqual } from "crypto";

export const BETA_ACCESS_HEADER = "x-beta-access-code";

function configuredAccessCode() {
  return process.env.BETA_ACCESS_CODE?.trim() ?? "";
}

export function isBetaAccessRequired() {
  return configuredAccessCode().length > 0;
}

export function hasBetaAccess(request: Request) {
  const expected = configuredAccessCode();
  if (!expected) return true;

  const provided = request.headers.get(BETA_ACCESS_HEADER)?.trim() ?? "";
  if (!provided) return false;

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;

  return timingSafeEqual(expectedBytes, providedBytes);
}
