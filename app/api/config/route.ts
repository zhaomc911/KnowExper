import { NextResponse } from "next/server";
import { isBetaAccessRequired } from "@/lib/access";
import { getAiConfigStatus } from "@/lib/ai";
import { getProcessingLimits } from "@/lib/limits";

export const runtime = "nodejs";

export async function GET() {
  const limits = getProcessingLimits();
  const ai = getAiConfigStatus();

  return NextResponse.json({
    limits: {
      maxUploadMb: limits.maxUploadMb,
      maxPages: limits.maxPages,
      acceptedTypes: ["application/pdf"],
    },
    ai,
    access: {
      required: isBetaAccessRequired(),
    },
  });
}
