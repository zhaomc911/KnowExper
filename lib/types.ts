export type SlideExplanation = {
  title: string;
  topic: string;
  keyPoints: string[];
  detailedExplanation: string[];
  confusionPoints: string[];
  remember: string;
};

export type SlideResult = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  imageDataUrl: string;
  explanation?: SlideExplanation;
  error?: string;
};

export type ProcessEvent =
  | {
      type: "progress";
      percent: number;
      message: string;
      phase: "validate" | "render" | "ai" | "done";
    }
  | {
      type: "meta";
      title: string;
      fileName: string;
      pageCount: number;
      maxPages: number;
    }
  | {
      type: "page";
      slide: SlideResult;
    }
  | {
      type: "done";
      title: string;
      slides: SlideResult[];
      documentId?: string;
      documentUrl?: string;
      cached?: boolean;
    }
  | {
      type: "error";
      message: string;
    };

export const fallbackExplanation: SlideExplanation = {
  title: "这一页讲什么",
  topic: "Slide",
  keyPoints: ["本页内容已渲染，但讲解生成暂未完成。"],
  detailedExplanation: ["可以点击本页的重新生成按钮，重新调用模型生成中文讲解。"],
  confusionPoints: ["如果重复失败，请检查模型是否支持图像输入，以及网关 Base URL / API Key 是否配置正确。"],
  remember: "保留 slide 图片和抽取文字后，可以单页重新生成。",
};
