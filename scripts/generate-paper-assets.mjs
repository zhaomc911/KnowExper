import { DOMMatrix, ImageData, createCanvas } from "canvas";
import fs from "fs/promises";
import path from "path";

const inputPdf =
  process.argv[2] ??
  "/Users/zhaomc/Research/论文分享/Rapid concerted switching of the neural code in the inferotemporal cortex.pdf";

const outRoot = path.join(process.cwd(), "public/paper-it-switching");
const pageDir = path.join(outRoot, "pages");
const textDir = path.join(process.cwd(), "output/paper-it-switching/text");
const scale = Number(process.env.PAPER_RENDER_SCALE ?? 1.25);

globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;

function textFromItems(items) {
  return items
    .map((item) => item.str ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  await fs.mkdir(pageDir, { recursive: true });
  await fs.mkdir(textDir, { recursive: true });

  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.js")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.js",
  );

  const data = new Uint8Array(await fs.readFile(inputPdf));
  const document = await pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textFromItems(textContent.items);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport,
        background: "white",
      }).promise;

      const fileName = `page-${String(pageNumber).padStart(2, "0")}.jpg`;
      const textName = `page-${String(pageNumber).padStart(2, "0")}.txt`;

      await fs.writeFile(path.join(pageDir, fileName), canvas.toBuffer("image/jpeg", { quality: 0.86 }));
      await fs.writeFile(path.join(textDir, textName), text);

      pages.push({
        pageNumber,
        width: canvas.width,
        height: canvas.height,
        image: `/paper-it-switching/pages/${fileName}`,
        textFile: `output/paper-it-switching/text/${textName}`,
        textLength: text.length,
      });

      page.cleanup();
      console.log(`Rendered page ${pageNumber}/${document.numPages}`);
    }
  } finally {
    await document.destroy();
  }

  await fs.writeFile(
    path.join(outRoot, "manifest.json"),
    JSON.stringify(
      {
        source: inputPdf,
        pageCount: pages.length,
        scale,
        generatedAt: new Date().toISOString(),
        pages,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
