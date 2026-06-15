import "server-only";

import type { PdfPageAnalysis } from "./pdf";

export type CollapsedBuildGroup = {
  pageNumbers: number[];
  representativePageNumber: number;
  unitTitle: string;
  text: string;
  buildContext: string;
  kind: "build" | "topic";
};

export type BuildCollapseResult = {
  groups: CollapsedBuildGroup[];
  sourcePageCount: number;
  collapsedPageCount: number;
};

export type CollapseBuildFramesOptions = {
  targetGroupCount?: number;
  maxTopicSourcePages?: number;
};

const MIN_TOKEN_LENGTH = 2;
const DEFAULT_MAX_TOPIC_SOURCE_PAGES = 6;
const DEFAULT_MAX_PAPER_SECTION_PAGES = 4;

type PageGroup = {
  pages: PdfPageAnalysis[];
  kind: "build" | "topic";
};

function normalizedText(text: string) {
  return text
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/π/g, "pi")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFromText(text: string) {
  const normalized = normalizedText(text);
  const latinTokens = normalized
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
  const cjkTokens = Array.from(normalized.matchAll(/[\u3400-\u9fff]+/g)).flatMap((match) => {
    const run = match[0];
    if (run.length < 2) return [];
    return Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2));
  });

  return [...latinTokens, ...cjkTokens];
}

function uniqueTokens(tokens: string[]) {
  return Array.from(new Set(tokens));
}

function normalizedFrameTitle(title: string | undefined) {
  return normalizedText(title || "")
    .replace(/\b\d+\s*\/\s*\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string | undefined) {
  return uniqueTokens(
    normalizedFrameTitle(title)
      .replace(/\([^)]*(?:cont\.?|continued|\d+)[^)]*\)/gi, " ")
      .replace(/\bcont\.?\b/g, " ")
      .replace(/\b\d+\b/g, " ")
      .split(/[^a-z0-9\u3400-\u9fff]+/i)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH)
      .filter((token) => !["the", "and", "for", "with", "from", "into", "onto"].includes(token)),
  );
}

function titlePrefix(title: string | undefined) {
  return normalizedFrameTitle(title)
    .split(":")[0]
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string | undefined, b: string | undefined) {
  const aTokens = new Set(titleTokens(a));
  const bTokens = new Set(titleTokens(b));
  if (!aTokens.size || !bTokens.size) return 0;

  return tokenIntersectionSize(aTokens, bTokens) / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

function isOutlineTitle(title: string | undefined) {
  const normalized = normalizedFrameTitle(title);
  return normalized === "outline" || normalized.startsWith("outline ");
}

function tokenIntersectionSize(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

function firstSharedTokenCount(a: string[], b: string[]) {
  const count = Math.min(a.length, b.length, 8);
  let shared = 0;

  for (let index = 0; index < count; index += 1) {
    if (a[index] === b[index]) shared += 1;
  }

  return shared;
}

function compactDiff(previousText: string, currentText: string) {
  const previousTokens = new Set(tokensFromText(previousText));
  const seen = new Set<string>();
  const added = tokensFromText(currentText)
    .filter((token) => {
      if (previousTokens.has(token) || seen.has(token)) return false;
      seen.add(token);
      return true;
    })
    .slice(0, 32);

  return added.join(" ");
}

function clippedText(text: string, maxChars: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function clippedTitle(text: string, maxChars = 48) {
  return clippedText(text, maxChars).replace(/\s+\/\s+/g, " / ");
}

function groupTitle(group: PageGroup) {
  return group.pages[group.pages.length - 1].frameTitle || "";
}

function groupSection(group: PageGroup) {
  return group.pages[group.pages.length - 1].sectionTitle || "";
}

function pageRangeLabel(group: PdfPageAnalysis[]) {
  const first = group[0].pageNumber;
  const last = group[group.length - 1].pageNumber;
  return first === last ? String(first) : `${first}-${last}`;
}

function courseUnitTitle(group: PdfPageAnalysis[], kind: "build" | "topic") {
  const finalFrame = group[group.length - 1];
  const title = finalFrame.frameTitle || finalFrame.sectionTitle || group[0].frameTitle || "";
  const normalized = clippedTitle(title);

  if (normalized && !isOutlineTitle(normalized)) {
    return normalized;
  }

  if (group.length > 1) {
    return kind === "topic" ? `主题 ${pageRangeLabel(group)}` : `构建帧 ${pageRangeLabel(group)}`;
  }

  return `第 ${finalFrame.pageNumber} 页`;
}

function mergeFrameText(group: PdfPageAnalysis[]) {
  const finalFrame = group[group.length - 1];
  if (group.length === 1) return finalFrame.text;

  const lines = [
    finalFrame.text,
    "",
    `[智能合并说明] 原 PDF 第 ${group[0].pageNumber}-${finalFrame.pageNumber} 页属于同一张课件的逐步展开或高亮帧。请把它们作为一个讲解单元解释，以最后一帧为主，同时保留构建顺序。`,
  ];

  for (let index = 1; index < group.length; index += 1) {
    const diff = compactDiff(group[index - 1].text, group[index].text);
    if (diff) {
      lines.push(`第 ${group[index].pageNumber} 页相对上一帧新增或强调的关键词：${diff}`);
    }
  }

  return lines.join("\n");
}

function mergeTopicText(group: PdfPageAnalysis[]) {
  const finalFrame = group[group.length - 1];
  if (group.length === 1) return finalFrame.text;

  const lines = [
    finalFrame.text,
    "",
    `[智能合并说明] 原 PDF 第 ${pageRangeLabel(group)} 页属于同一课程小主题或一组连续高相关课件页。请把它们作为一个讲解单元解释；右侧可查看本单元全部源页，讲解需要覆盖下面列出的所有源页。`,
    "本讲解单元包含：",
  ];

  for (const page of group) {
    const title = page.frameTitle ? `「${page.frameTitle}」` : "未识别标题";
    lines.push(`第 ${page.pageNumber} 页 ${title}：${clippedText(page.text, 360)}`);
  }

  return lines.join("\n");
}

function hasHeading(text: string, headingPattern: RegExp) {
  const squashed = text.replace(/\s+/g, " ").trim();
  const topWindow = squashed.slice(0, 850);
  const numberedHeading = new RegExp(`(?:^|\\s)\\d+(?:\\.\\d+)*\\.?\\s+${headingPattern.source}`, "i");
  const topHeading = new RegExp(`(?:^|\\s)${headingPattern.source}(?:\\s*[:：]|\\s{2,}|\\s+[A-Z][a-z])`, "i");

  return numberedHeading.test(squashed) || topHeading.test(topWindow);
}

function paperSectionName(page: PdfPageAnalysis, isFirstPage: boolean) {
  const text = page.text;
  const normalized = normalizedText(text);
  const titleText = `${page.frameTitle || ""} ${page.sectionTitle || ""}`;
  const titleOrTop = `${titleText} ${text.slice(0, 1200)}`;

  if (isFirstPage && normalized.length < 80) return "题目 / 摘要";
  if (isFirstPage && /\babstract\b/i.test(titleOrTop)) {
    return hasHeading(text, /introduction|引言|介绍/) ? "题目 / 摘要 / 引言" : "题目 / 摘要";
  }
  if (hasHeading(text, /references?|参考文献/)) return "参考文献";
  if (hasHeading(text, /appendix|supplementary|附录|补充材料/)) return "附录 / 补充材料";
  if (hasHeading(text, /conclusions?|discussion|讨论|结论/)) return "讨论 / 结论";
  if (hasHeading(text, /experiments?|results?|evaluation|analysis|实验|结果|评估|分析/)) return "实验 / 结果";
  if (hasHeading(text, /methods?|methodology|approach|model|algorithm|materials?|方法|模型|算法|材料/)) return "方法 / 模型";
  if (hasHeading(text, /related work|background|preliminar(?:y|ies)|相关工作|背景|预备/)) return "背景 / 相关工作";
  if (hasHeading(text, /introduction|引言|介绍/)) return "引言";

  return "";
}

function figureTitleFromText(text: string) {
  const match = text.match(/\b(?:fig(?:ure)?\.?)\s*([0-9]+[a-z]?)/i);
  if (!match) return "";

  return `Fig. ${match[1].toUpperCase()}`;
}

function paperUnitTitle(group: PdfPageAnalysis[], sectionName: string) {
  const firstPage = group[0];
  const section = sectionName.toLowerCase();
  const headingText = group
    .map((page) => `${page.frameTitle || ""} ${page.sectionTitle || ""} ${page.text.slice(0, 1600)}`)
    .join(" ");
  const figureTitle = figureTitleFromText(headingText);

  if (figureTitle && !section.includes("题目") && !section.includes("摘要") && !section.includes("引言")) {
    return figureTitle;
  }

  if (sectionName.includes("题目") || sectionName.includes("摘要")) return "总论点";
  if (sectionName.includes("背景") || sectionName.includes("相关工作")) return "背景争论";
  if (sectionName.includes("引言")) return "引言";
  if (sectionName.includes("方法") || sectionName.includes("模型") || sectionName.includes("算法")) return "方法 / 模型";
  if (sectionName.includes("实验") || sectionName.includes("结果") || sectionName.includes("评估")) return "实验 / 结果";
  if (sectionName.includes("讨论") || sectionName.includes("结论")) return "讨论 / 结论";
  if (sectionName.includes("参考文献")) return "参考文献";
  if (sectionName.includes("附录") || sectionName.includes("补充材料")) return "附录 / 补充材料";

  const title = firstPage.frameTitle || firstPage.sectionTitle || sectionName;
  return title ? clippedTitle(title) : `精读 ${pageRangeLabel(group)}`;
}

function mergePaperSectionText(group: PdfPageAnalysis[], sectionName: string) {
  const finalFrame = group[group.length - 1];
  const lines = [
    finalFrame.text,
    "",
    `[论文板块说明] 原 PDF 第 ${pageRangeLabel(group)} 页被识别为论文板块「${sectionName}」。请把这些页面作为一个连续论文板块精读，不要逐页割裂。右侧可查看本板块全部源页，讲解需要覆盖下面列出的所有源页。`,
    "本板块包含：",
  ];

  for (const page of group) {
    lines.push(`第 ${page.pageNumber} 页：${clippedText(page.text, 1200)}`);
  }

  return lines.join("\n");
}

function createPaperBuildContext(group: PdfPageAnalysis[], sectionName: string) {
  return `原 PDF 第 ${pageRangeLabel(group)} 页被识别为论文板块「${sectionName}」，共 ${group.length} 个源页。右侧可查看本板块全部源页。请按论文逻辑综合精读这一整块内容。`;
}

function createBuildContext(group: PdfPageAnalysis[], kind: "build" | "topic") {
  if (group.length === 1) {
    return `原 PDF 第 ${group[0].pageNumber} 页。`;
  }

  if (kind === "topic") {
    return `原 PDF 第 ${pageRangeLabel(group)} 页被智能合并为一个课程小主题讲解单元，共 ${group.length} 个源页。右侧可查看本单元全部源页。`;
  }

  return `原 PDF 第 ${pageRangeLabel(group)} 页被智能合并为一个讲解单元，共 ${group.length} 个构建帧。右侧可查看本单元全部源页。`;
}

function sameFrameTitle(previous: PdfPageAnalysis, current: PdfPageAnalysis) {
  const previousTitle = normalizedFrameTitle(previous.frameTitle);
  const currentTitle = normalizedFrameTitle(current.frameTitle);

  return Boolean(previousTitle && currentTitle && previousTitle === currentTitle);
}

function canMergeRelatedGroups(previous: PageGroup, current: PageGroup) {
  const previousTitle = groupTitle(previous);
  const currentTitle = groupTitle(current);
  const previousSection = groupSection(previous);
  const currentSection = groupSection(current);
  const sameSection = Boolean(previousSection && currentSection && previousSection === currentSection);
  const previousPrefix = titlePrefix(previousTitle);
  const currentPrefix = titlePrefix(currentTitle);

  if (!sameSection) return false;
  if (isOutlineTitle(previousTitle) || isOutlineTitle(currentTitle)) return true;
  if (previousPrefix && previousPrefix === currentPrefix && previousPrefix.length > 6) return true;

  return titleSimilarity(previousTitle, currentTitle) >= 0.62;
}

function mergePageGroups(previous: PageGroup, current: PageGroup): PageGroup {
  return {
    pages: [...previous.pages, ...current.pages],
    kind: previous.kind === "topic" || current.kind === "topic" || groupTitle(previous) !== groupTitle(current)
      ? "topic"
      : "build",
  };
}

function isStandaloneIntro(group: PageGroup) {
  return group.pages[0]?.pageNumber === 1 && !groupSection(group) && group.pages.length <= 2;
}

function compactRelatedGroups(groups: PageGroup[], maxSourcePages: number) {
  const compacted: PageGroup[] = [];

  for (const group of groups) {
    const previous = compacted[compacted.length - 1];
    if (
      previous &&
      previous.pages.length + group.pages.length <= maxSourcePages &&
      canMergeRelatedGroups(previous, group)
    ) {
      compacted[compacted.length - 1] = mergePageGroups(previous, group);
    } else {
      compacted.push(group);
    }
  }

  return compacted;
}

function packToTarget(groups: PageGroup[], targetGroupCount: number, maxSourcePages: number) {
  const packed = [...groups];

  while (packed.length > targetGroupCount) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let index = 0; index < packed.length - 1; index += 1) {
      const left = packed[index];
      const right = packed[index + 1];
      const combinedLength = left.pages.length + right.pages.length;
      const sameSection = groupSection(left) && groupSection(left) === groupSection(right);
      const related = canMergeRelatedGroups(left, right);
      const withinSoftCap = combinedLength <= maxSourcePages;
      const score =
        (related ? 100 : 0) +
        (sameSection ? 40 : 0) +
        (withinSoftCap ? 20 : 0) -
        combinedLength -
        (isStandaloneIntro(left) || isStandaloneIntro(right) ? 1000 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) break;

    packed.splice(bestIndex, 2, mergePageGroups(packed[bestIndex], packed[bestIndex + 1]));
  }

  return packed;
}

function toCollapsedGroup(group: PageGroup): CollapsedBuildGroup {
  const pages = group.pages;
  const kind = group.kind;

  return {
    pageNumbers: pages.map((page) => page.pageNumber),
    representativePageNumber: pages[pages.length - 1].pageNumber,
    unitTitle: courseUnitTitle(pages, kind),
    text: kind === "topic" ? mergeTopicText(pages) : mergeFrameText(pages),
    buildContext: createBuildContext(pages, kind),
    kind,
  };
}

export function collapseBuildFrames(
  pages: PdfPageAnalysis[],
  options: CollapseBuildFramesOptions = {},
): BuildCollapseResult {
  if (!pages.length) {
    return {
      groups: [],
      sourcePageCount: 0,
      collapsedPageCount: 0,
    };
  }

  const targetGroupCount = options.targetGroupCount || Number.POSITIVE_INFINITY;
  const maxTopicSourcePages = options.maxTopicSourcePages || DEFAULT_MAX_TOPIC_SOURCE_PAGES;
  const tokenLists = pages.map((page) => uniqueTokens(tokensFromText(page.text)));
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenLists) {
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const commonThreshold = Math.max(8, Math.ceil(pages.length * 0.55));
  const reducedTokenLists = tokenLists.map((tokens) => {
    const reduced = tokens.filter((token) => (documentFrequency.get(token) || 0) < commonThreshold);
    return reduced.length >= 8 ? reduced : tokens;
  });
  const tokenSets = reducedTokenLists.map((tokens) => new Set(tokens));

  function shouldMerge(previousIndex: number, currentIndex: number) {
    if (sameFrameTitle(pages[previousIndex], pages[currentIndex])) return true;

    const previousSet = tokenSets[previousIndex];
    const currentSet = tokenSets[currentIndex];
    if (!previousSet.size || !currentSet.size) return false;

    const intersection = tokenIntersectionSize(previousSet, currentSet);
    const minCoverage = intersection / Math.max(1, Math.min(previousSet.size, currentSet.size));
    const maxCoverage = intersection / Math.max(1, Math.max(previousSet.size, currentSet.size));
    const leadingShared = firstSharedTokenCount(reducedTokenLists[previousIndex], reducedTokenLists[currentIndex]);
    const textLengthRatio =
      Math.max(pages[previousIndex].text.length, pages[currentIndex].text.length) /
      Math.max(1, Math.min(pages[previousIndex].text.length, pages[currentIndex].text.length));

    return minCoverage >= 0.82 && (maxCoverage >= 0.45 || leadingShared >= 4) && textLengthRatio <= 2.35;
  }

  let pageGroups: PageGroup[] = [];
  let currentGroup: PdfPageAnalysis[] = [pages[0]];

  for (let index = 1; index < pages.length; index += 1) {
    if (shouldMerge(index - 1, index)) {
      currentGroup.push(pages[index]);
    } else {
      pageGroups.push({ pages: currentGroup, kind: "build" });
      currentGroup = [pages[index]];
    }
  }

  pageGroups.push({ pages: currentGroup, kind: "build" });

  if (pageGroups.length > targetGroupCount) {
    pageGroups = compactRelatedGroups(pageGroups, maxTopicSourcePages);
  }

  if (pageGroups.length > targetGroupCount) {
    pageGroups = packToTarget(pageGroups, targetGroupCount, maxTopicSourcePages);
  }

  const groups = pageGroups.map(toCollapsedGroup);

  return {
    groups,
    sourcePageCount: pages.length,
    collapsedPageCount: pages.length - groups.length,
  };
}

export function collapseAcademicPaperSections(
  pages: PdfPageAnalysis[],
  options: CollapseBuildFramesOptions = {},
): BuildCollapseResult {
  if (!pages.length) {
    return {
      groups: [],
      sourcePageCount: 0,
      collapsedPageCount: 0,
    };
  }

  const targetGroupCount = options.targetGroupCount || Number.POSITIVE_INFINITY;
  const maxSectionPages = options.maxTopicSourcePages || DEFAULT_MAX_PAPER_SECTION_PAGES;
  const sections: Array<{ sectionName: string; pages: PdfPageAnalysis[] }> = [];
  let currentSection = "";

  for (const page of pages) {
    const detected = paperSectionName(page, page.pageNumber === pages[0].pageNumber);
    const sectionName = detected || currentSection || "正文";
    const previous = sections[sections.length - 1];
    const startsNewSection = Boolean(detected && detected !== currentSection);
    const exceedsSectionSize = Boolean(previous && previous.pages.length >= maxSectionPages);

    if (!previous || startsNewSection || exceedsSectionSize) {
      sections.push({ sectionName, pages: [page] });
    } else {
      previous.pages.push(page);
    }

    currentSection = sectionName;
  }

  while (sections.length > targetGroupCount && sections.length > 1) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < sections.length - 1; index += 1) {
      const combinedLength = sections[index].pages.length + sections[index + 1].pages.length;
      const sameSection = sections[index].sectionName === sections[index + 1].sectionName;
      const score = combinedLength - (sameSection ? 4 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    sections.splice(bestIndex, 2, {
      sectionName:
        sections[bestIndex].sectionName === sections[bestIndex + 1].sectionName
          ? sections[bestIndex].sectionName
          : `${sections[bestIndex].sectionName} / ${sections[bestIndex + 1].sectionName}`,
      pages: [...sections[bestIndex].pages, ...sections[bestIndex + 1].pages],
    });
  }

  const groups = sections.map((section): CollapsedBuildGroup => {
    const finalPage = section.pages[section.pages.length - 1].pageNumber;

    return {
      pageNumbers: section.pages.map((page) => page.pageNumber),
      representativePageNumber: finalPage,
      unitTitle: paperUnitTitle(section.pages, section.sectionName),
      text: mergePaperSectionText(section.pages, section.sectionName),
      buildContext: createPaperBuildContext(section.pages, section.sectionName),
      kind: section.pages.length > 1 ? "topic" : "build",
    };
  });

  return {
    groups,
    sourcePageCount: pages.length,
    collapsedPageCount: pages.length - groups.length,
  };
}
