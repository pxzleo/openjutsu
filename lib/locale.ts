export type Locale = "en" | "zh-CN";

export const placeLabels = {
  Whole: "整段",
  Start: "开头",
  Middle: "中间",
  End: "结尾",
} as const;

export const toneLabels: Readonly<Record<string, string>> = {
  Exposure: "曝光",
  Contrast: "对比度",
  Pivot: "对比度中点",
  "Highlight rolloff": "高光衰减",
  "Shadow lift": "阴影提亮",
  "Black floor": "黑位",
  Saturation: "饱和度",
  Strength: "强度",
};

export function preferredLocale(acceptLanguage: string | null): Locale {
  let locale: Locale = "en";
  let best = 0;
  for (const entry of (acceptLanguage ?? "").split(",")) {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
    const language = tag.trim().split("-")[0];
    if (language !== "zh" && language !== "en") continue;
    const weight = parameters.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const quality = weight === undefined ? 1 : Number(weight.slice(2));
    if (quality <= best || quality > 1 || !Number.isFinite(quality)) continue;
    locale = language === "zh" ? "zh-CN" : "en";
    best = quality;
  }
  return locale;
}
