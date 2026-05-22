import type { DocumentKind, SlideResult } from "./types";

type DetectDocumentKindInput = {
  fileName: string;
  title: string;
  pages: Pick<SlideResult, "text" | "width" | "height">[];
};

export const documentKindLabels: Record<DocumentKind, string> = {
  course_slides: "课程课件",
  academic_paper: "学术论文",
  knowledge_document: "知识文档",
};

const PAPER_PATTERNS = [
  /\babstract\b/i,
  /\bintroduction\b/i,
  /\bmaterials?\s+and\s+methods?\b/i,
  /\bmethods?\b/i,
  /\bresults?\b/i,
  /\bdiscussion\b/i,
  /\breferences?\b/i,
  /\bdoi\b/i,
  /\bet\s+al\./i,
  /\bfig(?:ure)?\.?\s*\d+/i,
  /\bsupplementary\b/i,
  /\breceived\b/i,
  /\baccepted\b/i,
  /\bcorrespondence\b/i,
  /摘要|关键词|引言|方法|结果|讨论|参考文献|通讯作者/,
];

const SLIDE_PATTERNS = [
  /\blecture\b/i,
  /\bslides?\b/i,
  /\bchapter\b/i,
  /\bcourse\b/i,
  /\bquiz\b/i,
  /\bhomework\b/i,
  /\btoday'?s\s+outline\b/i,
  /\blearning\s+objectives?\b/i,
  /课件|课程|课堂|作业|复习|学习目标|本节|讲义/,
];

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function detectDocumentKind({ fileName, title, pages }: DetectDocumentKindInput): DocumentKind {
  const samplePages = pages.slice(0, 8);
  const combinedText = [fileName, title, ...samplePages.map((page) => page.text)].join("\n");
  const avgTextLength = average(samplePages.map((page) => page.text.trim().length));
  const landscapeRatio = samplePages.filter((page) => page.width > page.height).length / Math.max(samplePages.length, 1);
  const portraitRatio = samplePages.filter((page) => page.height > page.width * 1.12).length / Math.max(samplePages.length, 1);

  let paperScore = countMatches(combinedText, PAPER_PATTERNS);
  let slideScore = countMatches(combinedText, SLIDE_PATTERNS);

  if (/\bpaper\b|论文|article|journal|nature|science|cell/i.test(`${fileName} ${title}`)) paperScore += 2;
  if (/\bslides?\b|lecture|课件|讲义|course/i.test(`${fileName} ${title}`)) slideScore += 2;
  if (avgTextLength > 1200 && portraitRatio > 0.5) paperScore += 2;
  if (avgTextLength < 900 && landscapeRatio > 0.5) slideScore += 2;
  if (combinedText.match(/\[\d+\]|\(\d{4}\)|\bet\s+al\./gi)?.length) paperScore += 1;

  if (paperScore >= 4 && paperScore >= slideScore) return "academic_paper";
  if (slideScore >= 3 && slideScore > paperScore) return "course_slides";

  return "knowledge_document";
}
