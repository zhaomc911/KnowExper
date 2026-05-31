import "server-only";

import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function libreOfficeCandidates() {
  return [
    process.env.LIBREOFFICE_BIN,
    "soffice",
    "libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter(Boolean) as string[];
}

async function runLibreOffice(inputPath: string, outputDir: string) {
  let lastError: unknown;

  for (const command of libreOfficeCandidates()) {
    try {
      await execFileAsync(
        command,
        [
          "--headless",
          "--nologo",
          "--nofirststartwizard",
          "--convert-to",
          "pdf",
          "--outdir",
          outputDir,
          inputPath,
        ],
        { timeout: 120_000 },
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "未找到 LibreOffice。";
  throw new Error(
    `当前环境无法自动转换 PPTX。请安装 LibreOffice，或先把 PPTX 导出为 PDF 后上传。详细原因：${message}`,
  );
}

export async function convertPptxToPdf(buffer: ArrayBuffer, fileName: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "knowexper-pptx-"));
  const safeName = path.basename(fileName).replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_") || "slides.pptx";
  const inputPath = path.join(tempDir, safeName.toLowerCase().endsWith(".pptx") ? safeName : "slides.pptx");
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(tempDir, `${baseName}.pdf`);

  try {
    await writeFile(inputPath, Buffer.from(buffer));
    await runLibreOffice(inputPath, tempDir);
    const pdfBuffer = await readFile(outputPath);
    return pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
