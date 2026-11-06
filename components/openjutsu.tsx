"use client";

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { useErrorText, useLocale, useT } from "../lib/locale-provider.tsx";
import { placeLabels, toneLabels } from "../lib/locale.ts";
import type { PublicJob } from "../lib/comfy.ts";
import type { SetupRequest, SetupResult } from "../lib/setup.ts";
import type { NodeInfo } from "../lib/progress.ts";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { CLIP_SECONDS, DEFAULT_TARGET, MARGINS, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, PLACES, placeStart, RESOLUTIONS, CUSTOM_SIZE, canvasSize, timecode, type Margin, type MotionSize, type Resolution, type Section, type Size } from "../lib/simple.ts";
import { MAX_CHARACTERS } from "../lib/advanced.ts";
import { ACCELERATIONS, DEFAULT_DESCRIBER, DEFAULT_MODEL, hasSpeedLora, installedDefault, isSpeedLora, MAX_LORAS, STEPS, STRENGTH, type Acceleration, type Lora, type ModelFiles } from "../lib/model.ts";
import type { EditMode, FitSummary, PaintKeyframe, PlacementKeyframe } from "../lib/object.ts";
import { Welcome } from "./welcome.tsx";
import { ObjectPlacement } from "./object-placement.tsx";
import { FromPicture } from "./from-picture.tsx";
import { CHUNK_SECONDS, FACE_STYLES, faceChunkCount, type FaceStyle } from "../lib/face.ts";
import { DEFAULT_PRESET, DEFAULT_TONE, DETAIL, TONE_MODES, TONE_RANGES, toneFromPreset, type ToneSettings, type ToneValue } from "../lib/color.ts";
import { appearances, renderLabels, type Appearance, type Kept, type Label, type People, type Review } from "../lib/montage.ts";

type Character = { file: File; url: string; role: string };
type Mode = "simple" | "advanced" | "object" | "post";
type Post = "face" | "color";
type Kind = "simple" | "mask" | "advanced" | "advanced_maxq" | "object" | "fit" | "face" | "color" | "people" | "montage";
type TonePreset = { name: string; settings: Record<string, unknown> };
// frames: the video, part and crop SAM saw
type Run = { id: string; kind: Kind; margin: Margin; clips: number; clipSeconds: number; startedAt: number; frames: string };
type PastRun = Run & { status?: string; result?: string };
// pass counts the sampler runs started so far: Fix faces samples its chunks one after another in the same node.
type Progress = NodeInfo & { step: number | null; steps: number | null; pass: number };

const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
const RUN_KEY = "openjutsu.run";
const SETTINGS_KEY = "openjutsu.settings";
const WELCOME_KEY = "openjutsu.welcome";
const HISTORY_KEY = "openjutsu.history";
const HISTORY_LENGTH = 20;

type Text = [en: string, zh: string];

const KIND_LABELS: Record<Kind, Text> = {
  simple: ["Person swap", "人物替换"], mask: ["Mask check", "遮罩检查"], advanced: ["Advanced swap", "高级人物替换"],
  advanced_maxq: ["Advanced swap", "高级人物替换"], object: ["Object swap", "物体替换"], fit: ["Fit check", "范围检查"],
  face: ["Fix faces", "人脸修复"], color: ["Fix colours", "色彩修正"], people: ["Find people", "查找人物"], montage: ["Montage", "蒙太奇"],
};
const STATUS_LABELS: Record<string, Text> = { succeeded: ["Done", "已完成"], failed: ["Failed", "失败"], canceled: ["Canceled", "已取消"], expired: ["Expired", "已失效"] };
const MARGIN_LABELS: Record<Margin, string> = { tight: "较窄", normal: "适中", loose: "较宽" };
const TONE_MODE_LABELS: Record<ToneSettings["mode"], string> = {
  "Filmic Soft": "柔和胶片", "Filmic Strong": "浓郁胶片", "ACES Approx": "近似 ACES", Reinhard: "Reinhard", "Cineon-ish": "近似 Cineon",
};
const SIDE_LABELS = { left: "左侧", right: "右侧", top: "上侧", bottom: "下侧" };

const MODES: { id: Mode; title: Text; text: Text; ready: boolean }[] = [
  { id: "simple", title: ["Simple motion transfer", "基础动作迁移"], text: ["Swap the main person in a video for your character.", "用你的角色替换视频中的主要人物。"], ready: true },
  { id: "advanced", title: ["Advanced motion transfer", "高级动作迁移"], text: ["Several people, pick who becomes who.", "支持多人，逐一指定要替换的角色。"], ready: true },
  { id: "object", title: ["Object swap", "物体替换"], text: ["Change hair, clothes, a prop or the background, or remove something.", "更换发型、衣服、道具或背景，也可以移除物体。"], ready: true },
  { id: "post", title: ["Post-processing", "后期处理"], text: ["Fix the faces or the colours of a finished video.", "修复成片中的人脸或调整色彩。"], ready: true },
];

const POSTS = ["face", "color"] as const;

const FACE_STYLE_TEXT: Record<FaceStyle, { label: Text; hint: Text }> = {
  photo: { label: ["Match the photo", "还原照片"], hint: ["The face is redrawn from the photo: the closest likeness, but H3 makes up its own expressions and mouth movements.", "按照片重绘人脸，相似度最高。表情和嘴部动作由 H3 生成。"] },
  mouth: { label: ["Follow the mouth", "跟随口型"], hint: ["The face follows the video's expressions and mouth movements; a little less like the photo.", "跟随原视频的表情和嘴部动作，与照片的相似度略低。"] },
  swap: { label: ["Replace face", "换脸"], hint: ["Use the original video and a photo of the new face. The workflow tracks the main face, including close-ups, and pastes the new face over it. The tracked person can change across cuts. Hair, clothes and background come from the source video.", "上传原视频和新的人脸照片。系统会跟踪主要人脸（包括特写）并覆盖为新脸。切镜时跟踪对象可能改变，头发、衣服和背景保留原样。"] },
};

type EditTab = EditMode | "picture";
const EDITS: { id: EditTab; label: Text; target: string; what: Text; to: string; toHint: Text }[] = [
  { id: "change", label: ["Change", "更换"], target: "hair, top", what: ["What to change", "更换目标"], to: "short bright pink hair and a black leather jacket", toHint: ["What it becomes", "更换后的样子"] },
  { id: "add", label: ["Add", "添加"], target: "on the table", what: ["Where it goes", "放置位置"], to: "a chocolate cake on a plate", toHint: ["Object to add", "添加的物体"] },
  { id: "remove", label: ["Remove", "移除"], target: "poster", what: ["What to remove", "移除目标"], to: "a plain wall", toHint: ["What shows instead (optional)", "移除后显示什么（可选）"] },
  { id: "background", label: ["Background", "背景"], target: "person", what: ["What stays", "保留的对象"], to: "a snowy mountain pass at dusk", toHint: ["The new place", "新背景"] },
  { id: "picture", label: ["From picture", "按图替换"], target: "person", what: ["Who is replaced", "替换的人物"], to: "", toHint: ["", ""] },
];

const isRun = (run: Run | null) => typeof run?.id === "string" && Object.hasOwn(KIND_LABELS, run.kind);

function readRun(): Run | null {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) ?? "null");
    return isRun(run) ? run : null;
  } catch {
    return null;
  }
}

function writeRun(run: Run | null) {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch {}
}

function readHistory(): PastRun[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(isRun) : [];
  } catch {
    return [];
  }
}

type Settings = {
  mode: Mode; maxQuality: boolean; montage: boolean; resolution: Resolution; customSize: Size; hatFix: boolean; noLipSync: boolean;
  margin: Margin; target: string; editMode: EditTab; editTarget: string; biggestOnly: boolean; keepOutline: boolean; post: Post;
  detailOn: boolean; detail: number; toneOn: boolean; tone: ToneSettings; tonePreset: string; faceStyle: FaceStyle;
  chunkSeconds: number; seed: number; clipSeconds: number; motion: MotionSize; steps: number; model: string; loras: Lora[];
  useLoras: boolean; describer: string; textEncoder: string; videoVae: string; audioVae: string; acceleration: Acceleration;
};

const isBoolean = (value: unknown) => typeof value === "boolean";
const isString = (value: unknown) => typeof value === "string";
const oneOf = (list: readonly unknown[]) => (value: unknown) => list.includes(value);
const inRange = ({ min, max }: { min: number; max: number }) => (value: unknown) => typeof value === "number" && value >= min && value <= max;
const isSize = (value: unknown) => !!value && typeof value === "object" && [(value as Size).width, (value as Size).height].every(inRange(CUSTOM_SIZE));

// A saved value that fails its check, say from an older version, is dropped and the field keeps its default.
const SETTING_CHECKS: Record<keyof Settings, (value: unknown) => boolean> = {
  mode: oneOf(MODES.map((m) => m.id)), maxQuality: isBoolean, montage: isBoolean,
  resolution: (value) => oneOf(RESOLUTIONS)(value) || isSize(value), customSize: isSize,
  hatFix: isBoolean, noLipSync: isBoolean, margin: oneOf(Object.keys(MARGINS)), target: isString,
  editMode: oneOf(EDITS.map((e) => e.id)), editTarget: isString, biggestOnly: isBoolean, keepOutline: isBoolean,
  post: oneOf(POSTS), detailOn: isBoolean, detail: inRange(DETAIL), toneOn: isBoolean,
  tone: (value) => !!value && typeof value === "object" && oneOf(TONE_MODES)((value as ToneSettings).mode)
    && Object.entries(TONE_RANGES).every(([key, range]) => inRange(range)((value as ToneSettings)[key as ToneValue])),
  tonePreset: isString, faceStyle: oneOf(FACE_STYLES), chunkSeconds: inRange(CHUNK_SECONDS),
  seed: (value) => Number.isInteger(value) && inRange({ min: 0, max: MAX_SEED })(value), clipSeconds: inRange(CLIP_SECONDS),
  motion: oneOf(MOTION_SIZES), steps: (value) => Number.isInteger(value) && inRange(STEPS)(value), model: isString,
  loras: (value) => Array.isArray(value) && value.length <= MAX_LORAS && value.every((l) => !!l && isString(l.name) && inRange(STRENGTH)(l.strength) && (l.speed === undefined || isBoolean(l.speed)) && (l.enabled === undefined || isBoolean(l.enabled))),
  useLoras: isBoolean, describer: isString, textEncoder: isString, videoVae: isString, audioVae: isString, acceleration: oneOf(ACCELERATIONS),
};

function readSettings(defaults: Settings): Settings {
  try {
    const saved = Object.entries(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"));
    return { ...defaults, ...Object.fromEntries(saved.filter(([key, value]) => Object.hasOwn(SETTING_CHECKS, key) && SETTING_CHECKS[key as keyof Settings](value))) };
  } catch {
    return defaults;
  }
}

function droppedFiles(event: DragEvent, kind: "video" | "image") {
  event.preventDefault();
  return [...event.dataTransfer.files].filter((file) => file.type.startsWith(`${kind}/`) || (kind === "video" && /\.(mkv|mov|avi)$/i.test(file.name)));
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Rough share of a clip done at each node: the sampler is most of the time.
function clipShare(progress: Progress) {
  const steps = progress.steps ? (progress.step ?? 0) / progress.steps : 0;
  // one pass per person samples twice per clip
  if (progress.classType === "SamplerCustomAdvanced" && progress.title.startsWith("Pass 1:")) return 0.1 + 0.4 * steps;
  if (progress.classType === "SamplerCustomAdvanced" && progress.title.startsWith("Pass 2:")) return 0.5 + 0.4 * steps;
  if (progress.classType === "SamplerCustomAdvanced") return 0.15 + 0.75 * steps;
  if (["VAEDecode", "VAEDecodeAudio", "MiniMaxH3LoopTrim", "MiniMaxH3ChainSegmentSave", "MiniMaxH3ChainReview"].includes(progress.classType)) return 0.95;
  return 0.05;
}

// Rough share of a colour fix done when each node starts; the tone mapper runs on the CPU and takes longest.
const COLOR_SHARE: Record<string, number> = { ImageDetailContrast: 0.15, Orion4D_FXMax_DCTLToneMapper: 0.3, VHS_VideoCombine: 0.9 };

// A picker over ComfyUI's files, or a text field when the list could not be read.
function FilePicker({ value, options, onChange, label }: { value: string; options: string[]; onChange: (value: string) => void; label: string }) {
  if (!options.length) return <input className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
  return (
    <select className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {(options.includes(value) ? options : [value, ...options]).map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  );
}

const NODE_LABELS: Readonly<Record<string, string>> = {
  "all hats": "所有帽子",
  "apply clip context": "应用片段上下文",
  "at most 20 frames": "最多取 20 帧",
  "audio vae": "音频 VAE",
  "blurred face (follow the mouth)": "模糊人脸（跟随口型）",
  "check the fit": "检查范围",
  "clip prompt (what h3 gets)": "片段提示词（供 H3 使用）",
  "clip seed": "片段种子",
  "clip start frame": "片段起始帧",
  "comfy kitchen attention": "Comfy Kitchen 注意力",
  "current clip": "当前片段",
  "custom size (centre crop)": "自定义尺寸（居中裁剪）",
  "decode audio": "解码音频",
  "decode face": "解码人脸",
  "decode video": "解码视频",
  "describe the face in picture 1": "描述照片 1 中的人脸",
  "describer: qwen3-vl 8b": "视觉描述模型 Qwen3-VL 8B",
  "detail contrast": "细节对比度",
  "edit latent (face + audio)": "编辑潜空间（人脸和音频）",
  "edit latent (source + mask + audio)": "编辑潜空间（原视频、遮罩和音频）",
  "face fix chunks": "划分人脸修复片段",
  "face fix join": "拼接人脸修复片段",
  "face from picture 1": "读取照片 1 中的人脸",
  "face mask (pasted back)": "人脸遮罩（贴回范围）",
  "face mask (regenerated)": "人脸遮罩（生成范围）",
  "faces (shown on the mannequin)": "人脸（显示在人偶上）",
  "faces (shown on the mannequins)": "人脸（显示在人偶上）",
  "final video": "输出最终视频",
  "find this clip's cuts": "检测片段切镜",
  "fit preview video": "生成范围预览视频",
  "fixed video": "输出修复视频",
  "generation profile": "生成参数",
  "grey mannequin (what h3 follows)": "灰色人偶（H3 动作参考）",
  "grow mask": "扩大遮罩",
  "grow mask (~4% of the frame)": "扩大遮罩（约为画面的 4%）",
  "guider": "采样引导",
  "h3 diffusion model": "H3 扩散模型",
  "h3 text encoder": "H3 文本编码器",
  "hat search area (person + 60 px)": "帽子搜索区域（人物周围 60 像素）",
  "hide the main person (grey mannequin)": "用灰色人偶遮盖主要人物",
  "hide them (grey mannequins)": "用灰色人偶遮盖人物",
  "insert shot list into prompt": "将镜头列表加入提示词",
  "labelled people (+ headroom)": "标记人物（预留头顶空间）",
  "labelled people (outlined for the shot list)": "标记人物（用轮廓辅助生成镜头列表）",
  "labelled people, no headroom (mannequin)": "标记人物（人偶用，无头顶余量）",
  "loop end": "结束片段循环",
  "loop start": "开始片段循环",
  "main person (+ headroom)": "主要人物（预留头顶空间）",
  "main person, no headroom (for the mannequin)": "主要人物（人偶用，无头顶余量）",
  "mask | mannequin": "遮罩 | 人偶",
  "mask preview": "遮罩预览",
  "mask preview (white = regenerated)": "遮罩预览（白色为重新生成区域）",
  "mask preview video": "生成遮罩预览视频",
  "masked target": "遮罩内的目标",
  "motion reference for this clip": "片段动作参考",
  "motion reference from pass 1 (~512 px)": "第一轮的动作参考（约 512 像素）",
  "motion reference video (~512 px)": "动作参考视频（约 512 像素）",
  "moving edit area (follows the copied routine)": "随参考动作移动的编辑区域",
  "moving edit area for this clip": "片段的移动编辑区域",
  "mute the clip audio h3 hears": "将 H3 使用的片段音频静音",
  "mute the reference audio h3 hears": "将 H3 使用的参考音频静音",
  "no lip-sync in the prompt": "提示词中关闭口型同步",
  "object placement area": "物体放置区域",
  "object swap plan (what to change)": "物体替换方案（更换目标）",
  "one frame every 2 s": "每 2 秒取一帧",
  "only the main person's hat": "仅主要人物的帽子",
  "only their hats": "仅人物帽子",
  "painted edit area (follows tracked mask)": "手绘编辑区域（跟随遮罩）",
  "pass 2 only where the piece has a second person": "仅在第二个人物出镜时运行第二轮",
  "paste the face back": "贴回人脸",
  "people (for the person list)": "提取人物列表",
  "people + hats": "人物和帽子",
  "picks without review": "自动匹配照片",
  "production plan (filled by object swap plan)": "生成方案（来自物体替换方案）",
  "production plan (filled by swap plan)": "生成方案（来自替换方案）",
  "reference conditioning": "参考条件",
  "regenerated area (cyan)": "重新生成区域（青色）",
  "review (off = no pause)": "检查结果（关闭时连续运行）",
  "run name for the moving edit area": "移动编辑区域的任务名称",
  "run name for this motion reference size": "当前动作参考尺寸的任务名称",
  "sam (face masks)": "SAM 人脸遮罩",
  "sam 3.1 track every person": "SAM 3.1 跟踪所有人物",
  "sam 3.1 track every person (whole video)": "SAM 3.1 跟踪整段视频中的人物",
  "sam 3.1 track faces": "SAM 3.1 跟踪人脸",
  "sam 3.1 track hats": "SAM 3.1 跟踪帽子",
  "sam 3.1 track it": "SAM 3.1 跟踪目标",
  "sam frames for this clip": "供 SAM 使用的片段帧",
  "sam video (1008 px)": "供 SAM 使用的视频（1008 像素）",
  "sam video (1008 px, as the render)": "供 SAM 使用的视频（1008 像素，与生成一致）",
  "sam video (1008 px, sam's own size)": "供 SAM 使用的视频（默认 1008 像素）",
  "sam: faces": "SAM 跟踪人脸",
  "sam: hats": "SAM 跟踪帽子",
  "sam: people": "SAM 跟踪人物",
  "sam: what to change": "SAM 跟踪修改目标",
  "sam: what to replace": "SAM 跟踪替换目标",
  "sample face": "采样人脸",
  "sample video + audio": "采样视频和音频",
  "sampler": "采样器",
  "save clip + checkpoint": "保存片段和检查点",
  "schedule": "采样调度",
  "seed": "种子",
  "show each track per shot": "显示每个镜头中的跟踪对象",
  "shrink for the describer": "缩小画面以供视觉描述模型使用",
  "sigma shift": "Sigma 偏移",
  "soundtrack (silence if none)": "音轨（原视频无音轨时使用静音）",
  "soundtrack (whole video)": "整段视频的音轨",
  "source clip (frames + audio)": "源片段（画面和音频）",
  "source soundtrack": "原音轨",
  "source video": "源视频",
  "source video (people get replaced)": "源视频（替换其中的人物）",
  "spectrum acceleration": "Spectrum 加速",
  "swap plan (roles, seed, size)": "替换方案（角色、种子和尺寸）",
  "this clip's person": "片段中的人物",
  "this clip's second person": "片段中的第二个人物",
  "tone mapper": "色调映射",
  "track + crop the face": "跟踪并裁剪人脸",
  "track labels": "跟踪对象的标签",
  "tracked area": "跟踪区域",
  "tracked area, tight (for the grey shape)": "紧贴目标的跟踪区域（用于灰色轮廓）",
  "tracked person (orange)": "跟踪到的人物（橙色）",
  "tracks from find people": "查找人物的跟踪结果",
  "trim overlap": "裁掉重叠部分",
  "turn it grey (shape and movement only)": "转换为灰色轮廓（保留形状和动作）",
  "video to fix": "待修复视频",
  "video vae": "视频 VAE",
  "who is each track (qwen3-vl)": "识别每个跟踪对象（Qwen3-VL）",
  "who is each track (what qwen saw)": "跟踪对象识别结果（Qwen）",
  "who is in the video": "识别视频中的人物",
  "write this clip's shot list (qwen3-vl)": "编写片段镜头列表（Qwen3-VL）",
};

function nodeLabel(title: string): string {
  const pass = /^(?:Pass ([12])|Swap): (.+)$/.exec(title);
  const node = pass?.[2] ?? title;
  const picture = /^(Describe picture|Picture|prompt for Subject) (\d+)(?: only)?$/.exec(node);
  const key = node.toLowerCase();
  const label = picture
    ? (picture[1] === "Picture" ? `照片 ${picture[2]}` : picture[1] === "Describe picture" ? `描述照片 ${picture[2]}` : `仅为人物 ${picture[2]} 生成提示词`)
    : Object.hasOwn(NODE_LABELS, key) ? NODE_LABELS[key] : node;
  return pass ? `${pass[1] ? `第 ${pass[1]} 轮` : "替换"}：${label}` : label;
}

function jobLine(run: Run, job: PublicJob | null) {
  return `Job: ${run.kind} ${run.id}, status ${job?.status ?? "unknown"}`;
}

// A plain-text report for a GitHub issue or Discord: nothing about the uploads, prompts or saved settings.
function CopyDetails({ lines }: { lines: string[] }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => box.current?.select(), [manual]);

  async function copy() {
    const text = ["Openjutsu", ...lines.filter(Boolean), `Browser: ${navigator.userAgent}`, `Time: ${new Date().toISOString()}`].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setManual("");
      setCopied(true);
    } catch {
      // No clipboard over plain HTTP: select the text so it can be copied by hand.
      setManual(text);
    }
  }

  return (<>
    <button className="secondary" onClick={copy}>{copied ? t("Copied", "已复制") : t("Copy error details", "复制错误详情")}</button>
    {manual && <textarea ref={box} className="report" readOnly rows={manual.split("\n").length} value={manual} aria-label={t("Error details", "错误详情")} onFocus={(event) => event.currentTarget.select()} />}
  </>);
}

function MarginPicker({ value, onChange }: { value: Margin; onChange: (margin: Margin) => void }) {
  const t = useT();
  return (
    <div className="segmented">
      {(Object.keys(MARGINS) as Margin[]).map((m) => (
        <button key={m} className={m === value ? "on" : ""} onClick={() => onChange(m)}>{t(m[0].toUpperCase() + m.slice(1), MARGIN_LABELS[m])}</button>
      ))}
    </div>
  );
}

function DropZone({ accept, onFiles, multiple, children, className }: {
  accept: string; onFiles: (files: File[]) => void; multiple?: boolean; children: ReactNode; className?: string;
}) {
  const [over, setOver] = useState(false);
  const kind = accept.startsWith("video") ? "video" : "image";
  return (
    <label
      className={`drop ${over ? "over" : ""} ${className ?? ""}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { setOver(false); onFiles(droppedFiles(event, kind)); }}
    >
      <input type="file" accept={accept} multiple={multiple} hidden onChange={(event) => { onFiles([...(event.target.files ?? [])]); event.target.value = ""; }} />
      {children}
    </label>
  );
}

export function Openjutsu() {
  const t = useT();
  const locale = useLocale();
  const errorText = useErrorText();
  const [mode, setMode] = useState<Mode>("simple");
  const [video, setVideo] = useState<{ file: File; url: string; duration: number; width: number; height: number } | null>(null);
  const [part, setPart] = useState<Section>({ start: 0, length: 0 });
  const player = useRef<HTMLVideoElement>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [maxQuality, setMaxQuality] = useState(false);
  const [montage, setMontage] = useState(false);
  const [resolution, setResolution] = useState<Resolution>("736p");
  const [customSize, setCustomSize] = useState<Size>({ width: 1248, height: 736 });
  const [hatFix, setHatFix] = useState(false);
  const [noLipSync, setNoLipSync] = useState(false);
  const [margin, setMargin] = useState<Margin>("normal");
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [editMode, setEditMode] = useState<EditTab>("change");
  const [editTarget, setEditTarget] = useState(EDITS[0].target);
  const [changeTo, setChangeTo] = useState("");
  const [action, setAction] = useState("");
  const [look, setLook] = useState<{ file: File; url: string } | null>(null);
  const [biggestOnly, setBiggestOnly] = useState(false);
  const [keepOutline, setKeepOutline] = useState(true);
  const [placement, setPlacement] = useState<PlacementKeyframe[]>([]);
  const [paint, setPaint] = useState<PaintKeyframe[]>([]);
  const [post, setPost] = useState<Post>("face");
  const [detailOn, setDetailOn] = useState(true);
  const [detail, setDetail] = useState(DETAIL.default);
  const [toneOn, setToneOn] = useState(true);
  const [tone, setTone] = useState<ToneSettings>(DEFAULT_TONE);
  // "" once a value is changed by hand
  const [tonePreset, setTonePreset] = useState(DEFAULT_PRESET);
  const [presets, setPresets] = useState<TonePreset[]>([]);
  const [faceStyle, setFaceStyle] = useState<FaceStyle>("photo");
  const [chunkSeconds, setChunkSeconds] = useState(CHUNK_SECONDS.default);
  const [seed, setSeed] = useState(0);
  const [clipSeconds, setClipSeconds] = useState(CLIP_SECONDS.default);
  const [motion, setMotion] = useState<MotionSize>(MOTION_SIZES[0]);
  const [steps, setSteps] = useState(DEFAULT_MODEL.steps);
  const [model, setModel] = useState(DEFAULT_MODEL.model);
  const [loras, setLoras] = useState<Lora[]>(DEFAULT_MODEL.loras);
  const [useLoras, setUseLoras] = useState(true);
  const [describer, setDescriber] = useState(DEFAULT_DESCRIBER);
  const [welcome, setWelcome] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [textEncoder, setTextEncoder] = useState(DEFAULT_MODEL.textEncoder);
  const [videoVae, setVideoVae] = useState(DEFAULT_MODEL.videoVae);
  const [audioVae, setAudioVae] = useState(DEFAULT_MODEL.audioVae);
  const [acceleration, setAcceleration] = useState<Acceleration>(DEFAULT_MODEL.acceleration);
  const enabledLoras = useLoras ? loras.filter((lora) => lora.enabled !== false) : [];
  const speedLora = hasSpeedLora(enabledLoras);
  const selectedAcceleration = speedLora ? "none" : acceleration;
  const [files, setFiles] = useState<ModelFiles>({ models: [], loras: [], textEncoders: [], vaes: [] });
  const [submitting, setSubmitting] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [formError, setFormError] = useState("");

  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<PastRun[]>([]);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState("");
  const [streamError, setStreamError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    setRun(readRun());
    setHistory(readHistory());
  }, []);

  const settings: Settings = {
    mode, maxQuality, montage, resolution, customSize, hatFix, noLipSync, margin, target, editMode, editTarget, biggestOnly, keepOutline, post,
    detailOn, detail, toneOn, tone, tonePreset, faceStyle, chunkSeconds, seed, clipSeconds, motion, steps, model, loras,
    useLoras, describer, textEncoder, videoVae, audioVae, acceleration,
  };
  const savedSettings = JSON.stringify(settings);

  useEffect(() => {
    const s = readSettings(settings);
    setMode(s.mode); setMaxQuality(s.maxQuality); setMontage(s.montage); setResolution(s.resolution); setCustomSize(s.customSize);
    setHatFix(s.hatFix); setNoLipSync(s.noLipSync); setMargin(s.margin); setTarget(s.target); setEditMode(s.editMode); setEditTarget(s.editTarget);
    setBiggestOnly(s.biggestOnly); setKeepOutline(s.keepOutline); setPost(s.post); setDetailOn(s.detailOn); setDetail(s.detail); setToneOn(s.toneOn);
    setTone(s.tone); setTonePreset(s.tonePreset); setFaceStyle(s.faceStyle); setChunkSeconds(s.chunkSeconds); setSeed(s.seed);
    setClipSeconds(s.clipSeconds); setMotion(s.motion); setSteps(s.steps); setModel(s.model); setLoras(s.loras);
    try { setWelcome(localStorage.getItem(WELCOME_KEY) !== "1"); } catch { setWelcome(true); }
    setDescriber(s.describer);
    setUseLoras(s.useLoras); setTextEncoder(s.textEncoder); setVideoVae(s.videoVae); setAudioVae(s.audioVae); setAcceleration(s.acceleration);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(SETTINGS_KEY, savedSettings);
    } catch {}
  }, [restored, savedSettings]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }, [restored, history]);

  // A finished job that ComfyUI later forgets keeps its finished status and file name.
  useEffect(() => {
    if (!job || !TERMINAL.has(job.status)) return;
    setHistory((list) => list.map((p) => p.id !== job.id || (p.status && job.status === "expired") ? p : { ...p, status: job.status, result: job.video?.name }));
  }, [job?.id, job?.status]);

  useEffect(() => setSetup(null), [mode, post, montage, maxQuality, resolution, motion, hatFix, noLipSync, model, loras, useLoras, describer, textEncoder, videoVae, audioVae, acceleration, detailOn, toneOn, faceStyle, editMode, characters.length, !!look]);

  async function refreshModels() {
    setModelsLoading(true);
    setModelsError("");
    try {
      const response = await fetch("/api/models");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not read models from ComfyUI.");
      setFiles(result);
      setDescriber((current) => installedDefault(current, DEFAULT_DESCRIBER, process.env.NEXT_PUBLIC_OPENJUTSU_DESCRIBER, result.textEncoders));
      setTextEncoder((current) => installedDefault(current, DEFAULT_MODEL.textEncoder, process.env.NEXT_PUBLIC_OPENJUTSU_H3_ENCODER, result.textEncoders));
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "Could not read models from ComfyUI.");
    } finally {
      setModelsLoading(false);
    }
  }

  function finishWelcome() {
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch {}
    setWelcome(false);
  }

  useEffect(() => {
    void refreshModels();
    fetch("/api/presets").then((response) => response.json()).then(({ tone }: { tone: TonePreset[] }) => setPresets(tone), () => {});
  }, []);

  // Orion's own copy of the chosen preset wins over the built-in or saved values once it has loaded.
  useEffect(() => {
    const saved = presets.find((p) => p.name === tonePreset);
    if (saved) setTone(toneFromPreset(saved.settings));
  }, [presets]);

  useEffect(() => {
    if (!run) return;
    const source = new EventSource(`/api/jobs/${run.id}/events?kind=${run.kind ?? "simple"}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "job") {
        setJob(event.job);
        setStreamError("");
        if (TERMINAL.has(event.job.status)) source.close();
      } else if (event.type === "status") {
        setJob((current) => current && { ...current, status: event.status, queuePosition: event.queuePosition });
      } else if (event.type === "progress" && event.node) {
        setProgress((last) => {
          const again = event.node.classType === "SamplerCustomAdvanced" && (last?.classType !== "SamplerCustomAdvanced" || (event.step ?? 0) < (last.step ?? 0));
          return { ...event.node, step: event.step, steps: event.steps, pass: (last?.pass ?? 0) + (again ? 1 : 0) };
        });
      } else if (event.type === "preview") {
        setPreview(event.url);
      } else if (event.type === "error") {
        setStreamError(event.message);
      }
    };
    // An answer other than an event stream (401, 403, 500) ends the stream for good; a dropped connection is retried.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setStreamError("Lost the connection to this job. Reload the page to try again, or go Back: the job keeps running in ComfyUI.");
    };
    return () => source.close();
  }, [run]);

  const running = !!run && !(job && TERMINAL.has(job.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  function chooseVideo(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (video) URL.revokeObjectURL(video.url);
    const url = URL.createObjectURL(file);
    setVideo({ file, url, duration: 0, width: 0, height: 0 });
    setPart({ start: 0, length: 0 });
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      setVideo((current) => (current?.url === url ? { ...current, duration, width: probe.videoWidth, height: probe.videoHeight } : current));
      setPart({ start: 0, length: duration });
    };
    probe.src = url;
  }

  function choosePart(start: number, length: number) {
    const duration = video?.duration ?? 0;
    const next = { start: Math.min(Math.max(0, start), duration - length), length };
    if (next.start !== part.start || next.length !== part.length) setPlacement([]);
    setPart(next);
    if (player.current) player.current.currentTime = next.start;
  }

  const whole = !video?.duration || (part.start === 0 && part.length >= video.duration);
  const place = whole ? "Whole" : PLACES.slice(1).find((p) => Math.abs(placeStart(p, video!.duration, part.length) - part.start) < 0.05);

  const faceFix = mode === "post" && post === "face";
  const colorFix = mode === "post" && post === "color";
  // Orion's saved presets, with the default preset first when Orion does not have it.
  const presetLabel = (name: string) => name === DEFAULT_PRESET ? t(name, "H3 柔和") : name;
  const presetOptions: TonePreset[] = presets.some((p) => p.name === DEFAULT_PRESET) ? presets : [{ name: DEFAULT_PRESET, settings: DEFAULT_TONE }, ...presets];

  function choosePreset(name: string) {
    const preset = presetOptions.find((p) => p.name === name);
    if (!preset) return;
    setTone(toneFromPreset(preset.settings));
    setTonePreset(name);
  }

  // Simple mode and Fix faces use only the first character; the others are kept for switching back.
  const single = mode === "simple" || mode === "post";
  const limit = single ? 1 : MAX_CHARACTERS;
  const shown = characters.slice(0, limit);
  const character = characters[0] ?? null;
  const onePassEach = mode === "advanced" && maxQuality && shown.length === 2;

  function addCharacters(files: File[]) {
    if (!files.length) return;
    if (single && character) {
      URL.revokeObjectURL(character.url);
      setCharacters([{ file: files[0], url: URL.createObjectURL(files[0]), role: character.role }, ...characters.slice(1)]);
      return;
    }
    const added = files.slice(0, limit - characters.length).map((file) => ({ file, url: URL.createObjectURL(file), role: "" }));
    setCharacters([...characters, ...added]);
  }

  function removeCharacter(index: number) {
    URL.revokeObjectURL(characters[index].url);
    setCharacters(characters.filter((_, i) => i !== index));
  }

  function setRole(index: number, role: string) {
    setCharacters(characters.map((c, i) => (i === index ? { ...c, role } : c)));
  }

  const canvas = typeof resolution === "object" ? [resolution.width, resolution.height] : video?.width ? canvasSize(video.width, video.height, resolution) : null;
  const outputSize = canvas ? `${canvas[0]}×${canvas[1]}` : resolution;
  const resolutionField = typeof resolution === "object" ? `${resolution.width}x${resolution.height}` : resolution;
  useEffect(() => { setPlacement([]); setPaint([]); }, [video?.url, resolutionField, whole, part.start, part.length]);
  useEffect(() => setPaint([]), [editTarget]);
  // A montage render masks with the tracks Find people saved, so it must use the frames Find people saw.
  const frames = video ? `${video.file.name}:${video.file.size} ${whole ? "whole" : `${part.start.toFixed(2)}+${part.length.toFixed(2)}`} ${typeof resolution === "object" ? resolutionField : ""}` : "";
  // A job reopened from Recent jobs may have used another video, part or size than the one loaded now.
  const same = run?.frames === frames;

  function chooseSize(side: keyof Size, value: number) {
    const snapped = Math.min(CUSTOM_SIZE.max, Math.max(CUSTOM_SIZE.min, Math.round(value / CUSTOM_SIZE.step) * CUSTOM_SIZE.step || customSize[side]));
    const size = { ...customSize, [side]: snapped };
    setCustomSize(size);
    setResolution(size);
    return snapped;
  }

  const edit = EDITS.find((e) => e.id === editMode)!;
  const clips = !video?.duration ? 0 : faceFix ? faceChunkCount(part.length || video.duration, chunkSeconds) : clipCount(part.length || video.duration, clipSeconds);
  const ready = colorFix ? detailOn || toneOn : mode === "object"
    ? editMode === "remove" || (editMode !== "add" || placement.length > 0) && (!!changeTo.trim() || !!look)
    : !!character;
  const generateKind: Kind = mode === "object" ? "object"
    : mode === "post" ? post : mode === "simple" ? "simple" : montage ? "montage" : onePassEach ? "advanced_maxq" : "advanced";
  const tab = `Tab: ${mode === "post" ? `post/${post}` : mode === "object" ? `object/${editMode}` : mode === "advanced" && montage ? "advanced/montage" : mode}`;

  function chooseLook(files: File[]) {
    if (!files[0]) return;
    if (look) URL.revokeObjectURL(look.url);
    setLook({ file: files[0], url: URL.createObjectURL(files[0]) });
  }

  async function submit(kind: Kind, review?: Review) {
    if (!video || (kind === "fit" ? !placement.length : kind !== "mask" && kind !== "people" && !ready)) return;
    setSubmitting(true);
    setCheckingSetup(true);
    setSetup(null);
    setFormError("");
    const form = new FormData();
    form.set("mode", kind);
    form.set("video", video.file);
    if (!whole) {
      form.set("start", part.start.toFixed(2));
      form.set("length", part.length.toFixed(2));
    }
    form.set("hat_fix", String(hatFix));
    form.set("no_lip_sync", String(noLipSync));
    form.set("margin", margin);
    form.set("target", target);
    if (kind === "simple" && character) {
      form.set("picture", character.file);
      form.set("role", character.role);
    }
    if (kind === "simple") {
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind === "advanced" || kind === "advanced_maxq") {
      form.set("mode", "advanced");
      for (const c of shown) {
        form.append("picture", c.file);
        form.append("role", c.role);
      }
      form.set("max_quality", String(kind === "advanced_maxq"));
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind === "fit") {
      form.set("action", action);
      form.set("placement", JSON.stringify(placement.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) }))));
      form.set("resolution", resolutionField);
    }
    if (kind === "people") {
      for (const c of shown) form.append("role", c.role);
      form.set("resolution", resolutionField);
    }
    if (kind === "montage") {
      for (const c of shown) {
        form.append("picture", c.file);
        form.append("role", c.role);
      }
      if (review) {
        form.set("tracks", review.tracks);
        form.set("labels", JSON.stringify(review.labels));
      }
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind === "face" && character) {
      form.set("picture", character.file);
      form.set("style", faceStyle);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(chunkSeconds));
    }
    if (kind === "color") {
      if (detailOn) form.set("detail", String(detail));
      if (toneOn) {
        form.set("tone_mode", tone.mode);
        for (const key of Object.keys(TONE_RANGES) as ToneValue[]) form.set(`tone_${key}`, String(tone[key]));
      }
    }
    if (kind === "object") {
      form.set("edit_mode", editMode);
      form.set("target", editTarget.trim() || edit.target);
      form.set("change_to", changeTo);
      if (look && editMode !== "remove") form.set("picture", look.file);
      form.set("biggest_only", String(biggestOnly));
      form.set("keep_outline", String(keepOutline));
      if (editMode === "change" && paint.length) form.set("paint", JSON.stringify(paint.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) }))));
      if (editMode === "add") {
        form.set("placement", JSON.stringify(placement.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) }))));
        form.set("action", action);
      }
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind !== "mask" && kind !== "color" && kind !== "people" && kind !== "fit") {
      form.set("motion", String(motion));
      form.set("steps", String(steps));
      form.set("model", model);
      form.set("text_encoder", textEncoder);
      form.set("video_vae", videoVae);
      form.set("audio_vae", audioVae);
      form.set("acceleration", selectedAcceleration);
      for (const l of enabledLoras) {
        form.append("lora", l.name);
        form.append("lora_strength", String(l.strength));
        form.append("lora_speed", String(isSpeedLora(l)));
      }
    }
    if (kind !== "mask" && kind !== "color" && kind !== "fit") form.set("describer", describer);
    const shared = { resolution, motion, hatFix, noLipSync, margin, seed, clipSeconds };
    const selectedModel = { model, loras: enabledLoras, steps, describer, textEncoder, videoVae, audioVae, acceleration: selectedAcceleration };
    let selection: SetupRequest;
    if (kind === "simple") selection = { kind, settings: { ...shared, role: character?.role ?? "", target: String(form.get("target")) }, model: selectedModel };
    else if (kind === "advanced" || kind === "advanced_maxq") selection = { kind, settings: { ...shared, roles: shown.map((c) => c.role) }, pictures: shown.length, model: selectedModel };
    else if (kind === "montage") selection = { kind, settings: { ...shared, roles: shown.map((c) => c.role) }, pictures: shown.length, review: review ?? null, model: selectedModel };
    else if (kind === "object") selection = { kind, settings: { ...shared, mode: editMode as EditMode, target: String(form.get("target")), changeTo, biggestOnly, keepOutline,
      ...(editMode === "change" ? { paint: paint.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) })) } : {}),
      ...(editMode === "add" ? { placement: placement.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) })) } : {}) }, picture: !!look && editMode !== "remove", model: selectedModel };
    else if (kind === "face") selection = { kind, settings: { style: faceStyle, seed, chunkSeconds }, model: selectedModel };
    else if (kind === "color") selection = { kind, settings: { detail: detailOn ? detail : null, tone: toneOn ? tone : null } };
    else if (kind === "mask") selection = { kind, hatFix, margin, target: String(form.get("target")) };
    else selection = kind === "people" ? { kind, resolution, describer } : { kind, resolution };

    try {
      const checked = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection) });
      const result = await checked.json();
      if (!checked.ok) throw new Error(result.error ?? "Could not check setup.");
      setSetup(result);
      if (!result.ok) return;
      setCheckingSetup(false);
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the job.");
      const next: Run = { id: body.id, kind, margin, clips: Math.max(clips, 1), clipSeconds: kind === "face" ? chunkSeconds : clipSeconds, startedAt: Date.now(), frames };
      writeRun(next);
      setHistory((list) => [next, ...list.filter((p) => p.id !== next.id)].slice(0, HISTORY_LENGTH));
      setJob(body);
      setProgress(null);
      setPreview("");
      setStreamError("");
      setRun(next);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not start the job.");
    } finally {
      setCheckingSetup(false);
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!run) return;
    setFormError("");
    try {
      const response = await fetch(`/api/jobs/${run.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not cancel the job.");
      setJob(body);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not cancel the job.");
    }
  }

  function reset() {
    setFormError("");
    setSetup(null);
    writeRun(null);
    setRun(null);
    setJob(null);
    setProgress(null);
    setPreview("");
    setStreamError("");
  }

  function reopen(past: PastRun) {
    setFormError("");
    setSetup(null);
    writeRun(past);
    setRun(past);
  }

  async function fixResult(next: Post) {
    if (!job?.video) return;
    setFormError("");
    try {
      const response = await fetch(job.video.url);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      chooseVideo([new File([blob], job.video.name, { type: blob.type || "video/mp4" })]);
    } catch {
      setFormError("Could not load the result video. Download it and choose it in Post-processing.");
      return;
    }
    reset();
    setMode("post");
    setPost(next);
  }

  if (!restored) return <main className="shell"><p className="hint" role="status">{t("Loading Openjutsu…", "正在加载 Openjutsu…")}</p></main>;
  if (welcome && !run) return <Welcome value={describer} options={files.textEncoders} onChange={setDescriber}
    loading={modelsLoading} error={modelsError} onRefresh={refreshModels} onContinue={finishWelcome} />;

  return (
    <main className="shell">
      <header className="top row">
        <div className="brand">
          <span className="mark" aria-hidden>忍</span>
          <div>
            <h1>Openjutsu</h1>
            <p>{t("Swap the people or things in any video. Open weights, on your own GPU.", "替换视频中的人物或物体。开放模型权重，在自己的 GPU 上运行。")}</p>
          </div>
        </div>
        <button className="secondary" disabled={!!run || submitting} onClick={() => setWelcome(true)}>{t("Welcome & models", "欢迎与模型")}</button>
      </header>

      <nav className="modes" aria-label={t("Mode", "模式")}>
        {MODES.map((m) => (
          <button
            key={m.id} className={`mode ${m.id === mode ? "active" : ""}`} disabled={!m.ready || !!run} aria-pressed={m.id === mode}
            onClick={() => setMode(m.id)}
          >
            <strong>{t(...m.title)}</strong>
            <span>{t(...m.text)}</span>
            {!m.ready && <em>{t("Coming soon", "即将推出")}</em>}
          </button>
        ))}
      </nav>

      {mode === "object" && !run && <nav className="segmented" aria-label={t("Object swap tools", "物体替换工具")}>
        {EDITS.map((e) => <button key={e.id} className={e.id === editMode ? "on" : ""} aria-pressed={e.id === editMode} onClick={() => {
          if (e.id !== editMode) { setEditTarget(e.target); setChangeTo(""); setAction(""); }
          setEditMode(e.id);
        }}>{t(...e.label)}</button>)}
      </nav>}

      {formError && <div className="row">
        <p className="error" role="alert">{errorText(formError)}</p>
        <CopyDetails lines={[tab, run ? jobLine(run, job) : "", `Error: ${formError}`]} />
      </div>}
      {checkingSetup && <p className="hint" role="status">{t("Checking required nodes and models…", "正在检查所需节点和模型…")}</p>}
      {setup && !setup.ok && (
        <section className="panel setup" role="alert">
          <h2>{t("Setup needs attention", "配置需要处理")}</h2>
          {setup.error && <p className="error">{errorText(setup.error)}</p>}
          {setup.packs.length > 0 && <>
            <p className="hint">{t("Install or update each custom node pack in the", "请在 Openjutsu 连接的 ComfyUI 的")} <code>custom_nodes</code> {t("folder of the ComfyUI installation Openjutsu connects to, with one subfolder per pack (for example,", "目录中安装或更新以下自定义节点包。每个包使用单独的子目录，例如")} <code>ComfyUI/custom_nodes/ComfyUI-KJNodes</code>{t(").", "。")}</p>
            <p className="hint">{t("Use ComfyUI Manager or follow the links below for installation and Python dependency instructions. If ComfyUI itself is listed, update ComfyUI. Then restart ComfyUI and try again.", "使用 ComfyUI Manager，或按下方链接的说明安装节点和 Python 依赖。如果列表中有 ComfyUI，请更新它。然后重启 ComfyUI 再试。")}</p>
            <ul>{setup.packs.map((pack) => <li key={pack.url}>
              <a href={pack.url} target="_blank" rel="noopener noreferrer">{pack.name === "ComfyUI (update required)" ? t(pack.name, "ComfyUI（需要更新）") : pack.name} ↗</a>
              {pack.nodes.length > 0 && <small>{t("Missing nodes: ", "缺少节点：")}{pack.nodes.join(", ")}</small>}
            </li>)}</ul>
          </>}
          {setup.models.length > 0 && <>
            <p className="hint">{t("Add these models to ComfyUI, or choose an installed base model or LoRA, then try again.", "请将以下模型添加到 ComfyUI，或选择已安装的基础模型或 LoRA 后重试。")}</p>
            <ul>{setup.models.map((item) => <li key={`${item.folder}/${item.name}`}>
              <code>{item.name}</code><small>ComfyUI/models/{item.folder}</small>
            </li>)}</ul>
          </>}
          <CopyDetails lines={[tab, "Setup check failed", setup.error ? `Error: ${setup.error}` : "",
            ...setup.packs.map((pack) => `Missing pack: ${pack.name} ${pack.url}${pack.nodes.length ? ` (nodes: ${pack.nodes.join(", ")})` : ""}`),
            ...setup.models.map((item) => `Missing model: ComfyUI/models/${item.folder}/${item.name}`)]} />
        </section>
      )}
      {run ? (
        <RunView
          run={run} job={job} progress={progress} preview={preview} streamError={streamError} now={now}
          before={video && same ? { url: video.url, start: whole ? 0 : part.start } : null}
          onCancel={cancel} onReset={reset} onFix={fixResult} onGenerate={!video || !same || submitting ? null : mode === "simple" && character ? () => submit("simple") : run.kind === "fit" && ready ? () => submit("object") : null}
          onUseBox={video && same ? (box) => { setPlacement([{ frame: Math.round((whole ? 0 : part.start) * 24), ...box }]); reset(); } : null}
          margin={margin} onMargin={setMargin} onRecheck={video && !submitting ? () => submit("mask") : null}
          photos={shown.map((c) => c.url)}
          onMontage={video && character && !submitting ? (tracks, labels) => submit("montage", { tracks, labels }) : null} frames={frames}
          onRetry={video && same && ready && !submitting && run.kind === generateKind && generateKind !== "montage" ? () => { reset(); submit(generateKind); } : null}
        />
      ) : mode === "object" && editMode === "picture" ? <FromPicture initialVideo={video?.file} initialPicture={look?.file} start={whole ? 0 : part.start} describer={describer} /> : (
        <>
          <section className="inputs">
            <div className="panel">
              <h2><span>1</span> {t("Source video", "源视频")}</h2>
              {video ? (
                <div className="video-pick">
                  <video
                    ref={player} src={video.url} controls muted playsInline
                    onTimeUpdate={(event) => { if (!whole && event.currentTarget.currentTime >= part.start + part.length) event.currentTarget.currentTime = part.start; }}
                  />
                  <div className="row">
                    <small>{video.file.name}{video.duration ? t(` · ${video.duration.toFixed(1)} s`, ` · ${video.duration.toFixed(1)} 秒`) : ""}</small>
                    <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="link">{t("Replace", "更换")}</DropZone>
                  </div>
                  {video.duration > MIN_SECTION_SECONDS && (
                    <>
                      <div className="setting">
                        <span>{t("Part to use", "使用片段")} <small>{t(`${timecode(part.start)}–${timecode(part.start + part.length)} (${part.length.toFixed(1)} s). Only this part is swapped.`, `${timecode(part.start)}–${timecode(part.start + part.length)}（${part.length.toFixed(1)} 秒）。仅替换这段视频。`)}</small></span>
                        <div className="segmented">
                          {PLACES.map((p) => (
                            <button key={p} className={p === place ? "on" : ""} onClick={() => p === "Whole" ? choosePart(0, video.duration) : choosePart(placeStart(p, video.duration, part.length), part.length)}>{t(p, placeLabels[p])}</button>
                          ))}
                        </div>
                      </div>
                      <label className="setting">
                        <span>{t("Length", "时长")} <small>{t(`${part.length.toFixed(1)} s`, `${part.length.toFixed(1)} 秒`)}</small></span>
                        <input type="range" min={MIN_SECTION_SECONDS} max={video.duration} step={0.5} value={part.length} onChange={(event) => choosePart(part.start, Number(event.target.value))} />
                      </label>
                      <label className="setting">
                        <span>{t("Starts at", "起始时间")} <small>{timecode(part.start)}</small></span>
                        <input type="range" min={0} max={video.duration - part.length} step={0.1} value={part.start} disabled={whole} onChange={(event) => choosePart(Number(event.target.value), part.length)} />
                      </label>
                    </>
                  )}
                </div>
              ) : (
                <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="big">
                  <strong>{t("Drop a video", "拖入视频")}</strong>
                  <span>{t("or click to browse. Its camera, cuts, motion and soundtrack are kept.", "也可点击选择文件。保留原视频的运镜、剪辑、动作和音轨。")}</span>
                </DropZone>
              )}
            </div>

            <div className="panel">
              <h2><span>2</span> {mode === "object" ? t("What to change", "修改目标") : colorFix ? t("Colour fix", "色彩修正") : faceFix ? t("Whose face", "人脸照片") : mode === "simple" ? t("Character", "角色") : t("Characters", "角色照片")}</h2>
              {mode === "post" && (
                <div className="segmented">
                  {POSTS.map((p) => (
                    <button key={p} className={p === post ? "on" : ""} onClick={() => setPost(p)}>{t(...KIND_LABELS[p])}</button>
                  ))}
                </div>
              )}
              {mode === "advanced" && (<>
                <div className="segmented">
                  <button className={montage ? "" : "on"} onClick={() => setMontage(false)}>{t("Standard", "标准")}</button>
                  <button className={montage ? "on" : ""} onClick={() => setMontage(true)}>{t("Montage", "蒙太奇")}</button>
                </div>
                {montage && (
                  <p className="hint">
                    {t("For edited clips where different people take turns within one shot, with no hard cut between them: whip pans, selfie handovers, travel and “vibe” montages. Generate tracks everyone over the whole video, matches them to the photos and makes the video in one go. To check who becomes which photo first, use Find people. Give every photo a role with a look after “ - ” (“the dancer - white polo, jeans”) so the people can be told apart. Use Standard for everything else.", "适用于同一镜头中多个人轮流出镜、没有硬切的剪辑，例如快速摇镜、自拍接力、旅行或氛围混剪。生成时会跟踪整段视频中的人物、匹配照片并一次生成。可先使用「查找人物」确认对应关系。请为每张照片填写角色，并在 “ - ” 后描述外观，例如 “the dancer - white polo, jeans”，以便区分。其他视频可使用标准模式。")}
                  </p>
                )}
              </>)}
              {colorFix ? (<>
                <label className="setting toggle">
                  <span>{t("Detail contrast", "细节对比度")} <small>{t("Softens H3's crunchy fine detail and over-sharpened skin, without blurring edges.", "柔化 H3 生成的生硬细节和过锐的皮肤，保留清晰边缘。")}</small></span>
                  <input type="checkbox" checked={detailOn} onChange={(event) => setDetailOn(event.target.checked)} />
                  <i aria-hidden />
                </label>
                {detailOn && <label className="setting">
                  <span>{t("Amount", "强度")} <small>{t(`${detail.toFixed(2)}: below 0 softens, above 0 sharpens.`, `${detail.toFixed(2)}。小于 0 时柔化，大于 0 时锐化。`)}</small></span>
                  <input type="range" min={DETAIL.min} max={DETAIL.max} step={0.01} value={detail} onChange={(event) => setDetail(Number(event.target.value))} />
                </label>}
                <label className="setting toggle">
                  <span>{t("Tone mapper", "色调映射")} <small>{t(`Orion4D DCTL Tone Mapper, a colour grade over every frame. ${DEFAULT_PRESET} softens contrast and highlights and keeps the blacks deep.`, "用 Orion4D DCTL Tone Mapper 逐帧调色。H3 柔和预设可降低对比度、柔化高光并保持深黑。")}</small></span>
                  <input type="checkbox" checked={toneOn} onChange={(event) => setToneOn(event.target.checked)} />
                  <i aria-hidden />
                </label>
                {toneOn && <div className="setting">
                  <span>{t("Preset", "预设")} <small>{t("Orion's saved presets. Change the values under Settings to make your own.", "使用 Orion 保存的预设。可在设置中调整各项数值。")}</small></span>
                  <select className="file-name" aria-label={t("Tone mapper preset", "色调映射预设")} value={tonePreset} onChange={(event) => choosePreset(event.target.value)}>
                    {!tonePreset && <option value="">{t("Custom", "自定义")}</option>}
                    {presetOptions.map((p) => <option key={p.name} value={p.name}>{presetLabel(p.name)}</option>)}
                  </select>
                </div>}
                <p className="hint">{t("No H3 run: the video is only filtered, so it keeps its frames and soundtrack. The detail contrast runs first, then the tone mapper.", "仅对原视频应用滤镜，保留画面和音轨。先调整细节对比度，再进行色调映射，无需运行 H3。")}</p>
              </>) : mode === "object" ? (
                <div className="edit">
                  <label>
                    <span>{t(...edit.what)} <small>{editMode === "add" ? t("Describe the placement, for example on the table in front of the person.", "请描述放置位置，例如人物前方的桌面上。") : t("What SAM tracks, in English.", "用英文描述 SAM 要跟踪的对象。")}{(editMode === "change" || editMode === "remove") && t(" Separate several with commas.", "多个对象用逗号分隔。")}</small></span>
                    <input value={editTarget} maxLength={100} placeholder={edit.target} onChange={(event) => setEditTarget(event.target.value)} />
                  </label>
                  <label>
                    <span>{t(...edit.toHint)}</span>
                    <input value={changeTo} maxLength={300} placeholder={t(`e.g. ${edit.to}`, `例如 ${edit.to}`)} onChange={(event) => setChangeTo(event.target.value)} />
                  </label>
                  {editMode === "add" && <label>
                    <span>{t("What happens with it", "物体如何运动")} <small>{t("Optional. Leave empty for a still object.", "可选。静止物体可留空。")}</small></span>
                    <input value={action} maxLength={300} placeholder={t("e.g. she dances the same routine in sync with the others", "例如 she dances the same routine in sync with the others")} onChange={(event) => setAction(event.target.value)} />
                  </label>}
                  {editMode !== "remove" && (look ? (
                    <div className="character look">
                      <img src={look.url} alt={t("Reference picture", "参考图")} />
                      <button className="remove" onClick={() => { URL.revokeObjectURL(look.url); setLook(null); }} aria-label={t("Remove picture", "移除参考图")}>×</button>
                    </div>
                  ) : (
                    <DropZone accept="image/*" onFiles={chooseLook} className="add">
                      <strong>+</strong>
                      <span>{editMode === "add" ? t("Picture of the object (optional)", "物体参考图（可选）") : editMode === "background" ? t("Picture of the place (optional)", "背景参考图（可选）") : t("Picture of the new look (optional)", "新外观参考图（可选）")}</span>
                    </DropZone>
                  ))}
                  <p className="hint">
                    {editMode === "change" && t("Only what SAM tracks is regenerated: hair, a top, a car. A picture of an outfit, hairstyle or product is copied onto it.", "仅重新生成 SAM 跟踪到的对象，如头发、上衣或汽车。可用服装、发型或商品图片来指定新外观。")}
                    {editMode === "add" && t("A new object is generated inside your placement area while the scene continues. Keep the supporting surface visible and describe where the object rests.", "在指定区域内生成新物体，同时延续原场景。请让承托物体的表面保持可见，并描述物体的放置位置。")}
                    {editMode === "remove" && t("What SAM tracks is erased and filled with what is around it. The camera, people and sound stay.", "移除 SAM 跟踪的对象，根据周围画面填补。保留运镜、人物和声音。")}
                    {editMode === "background" && t("Everything except what SAM tracks becomes the new place; the camera movement stays.", "保留 SAM 跟踪的对象，其余画面换成新场景，沿用原视频运镜。")}
                  </p>
                  {editMode === "change" && video && canvas && <details>
                    <summary>{t("Paint edit area (optional)", "涂画编辑区域（可选）")}</summary>
                    <ObjectPlacement key={`${video.url}:${resolutionField}:paint`} src={video.url}
                      start={whole ? 0 : part.start} end={whole ? video.duration : part.start + part.length}
                      width={canvas[0]} height={canvas[1]} mode="paint" points={paint} onChange={setPaint} />
                  </details>}
                  {editMode === "add" && video && canvas && <ObjectPlacement key={`${video.url}:${resolutionField}`} src={video.url}
                    start={whole ? 0 : part.start} end={whole ? video.duration : part.start + part.length} width={canvas[0]} height={canvas[1]} points={placement} onChange={setPlacement} />}
                </div>
              ) : (<>
              <div className="characters">
                {shown.map((c, i) => (
                  <div className="character" key={c.url}>
                    <img src={c.url} alt={t(`Character ${i + 1}`, `角色 ${i + 1}`)} />
                    <button className="remove" onClick={() => removeCharacter(i)} aria-label={t(`Remove character ${i + 1}`, `移除角色 ${i + 1}`)}>×</button>
                    {mode !== "post" && <label>
                      <span>{t("Who do they replace? (optional)", "替换谁？（可选）")}</span>
                      <input
                        value={c.role}
                        maxLength={200}
                        placeholder={i === 0 ? t("e.g. the singer - red dress", "例如 the singer - red dress") : t("e.g. the drummer - black cap", "例如 the drummer - black cap")}
                        onChange={(event) => setRole(i, event.target.value)}
                      />
                    </label>}
                  </div>
                ))}
                {shown.length < limit && (
                  <DropZone accept="image/*" onFiles={addCharacters} multiple={mode === "advanced"} className="add">
                    <strong>+</strong>
                    <span>{t("Drop a photo", "拖入照片")}</span>
                  </DropZone>
                )}
              </div>
              {faceFix ? (<>
                <div className="segmented">
                  {(Object.keys(FACE_STYLE_TEXT) as FaceStyle[]).map((f) => (
                    <button key={f} className={f === faceStyle ? "on" : ""} onClick={() => setFaceStyle(f)}>{t(...FACE_STYLE_TEXT[f].label)}</button>
                  ))}
                </div>
                <p className="hint">
                  {t(...FACE_STYLE_TEXT[faceStyle].hint)}
                  {faceStyle !== "swap" && t(" Use the photo the video was made with. Faces taller than a fifth of the frame are left alone.", "请用生成视频时所用的照片。高度超过画面五分之一的人脸会保留原样。")}
                </p>
              </>) : mode === "simple" ? (
                <p className="hint">
                  {t("The character replaces the main person in the video, the one who fills the most of the frame. Everyone else stays. Mirrors and reflections do not work yet. To name them for the prompt, use a role (“the singer”), not clothes; their look can go after “ - ” (“the singer - red dress”).", "角色将替换视频里画面占比最大的主要人物，其余人保持原样。暂不支持镜像和反射。提示词可先写角色身份（如 “the singer”），再在 “ - ” 后写外观（如 “the singer - red dress”）。")}
                </p>
              ) : (
                <p className="hint">
                  {t(`Up to ${MAX_CHARACTERS} characters. In every clip each tracked person is matched to a role; people without a character (extras, passers-by) stay as they are. Mirrors and reflections do not work yet. Name roles (“the drummer”), not clothes, and add how they look after “ - ” to help the matching (“the drummer - man in a cap”). Blank roles go to the people with the most screen time.`,
                    `最多 ${MAX_CHARACTERS} 个角色。每段视频都会将跟踪到的人物与角色匹配，没有匹配的群众演员或路人会保持原样。暂不支持镜像和反射。请先写角色身份（如 “the drummer”），再在 “ - ” 后补充外观（如 “the drummer - man in a cap”）。留空的角色会分配给出镜时间最长的人物。`)}
                </p>
              )}
              </>)}
            </div>
          </section>

          {colorFix ? toneOn && (
            <section className="panel settings">
              <h2><span>3</span> {t("Settings", "设置")} <small>{tonePreset ? presetLabel(tonePreset) : t("Custom", "自定义")}</small></h2>
              <div className="setting">
                <span>{t("Tone mapper mode", "色调映射模式")}</span>
                <div className="segmented">
                  {TONE_MODES.map((m) => (
                    <button key={m} className={m === tone.mode ? "on" : ""} onClick={() => { setTone({ ...tone, mode: m }); setTonePreset(""); }}>{t(m, TONE_MODE_LABELS[m])}</button>
                  ))}
                </div>
              </div>
              {(Object.keys(TONE_RANGES) as ToneValue[]).map((key) => (
                <label className="setting" key={key}>
                  <span>{t(TONE_RANGES[key].label, toneLabels[TONE_RANGES[key].label] ?? TONE_RANGES[key].label)} <small>{tone[key].toFixed(2)}</small></span>
                  <input
                    type="range" min={TONE_RANGES[key].min} max={TONE_RANGES[key].max} step={TONE_RANGES[key].step} value={tone[key]}
                    onChange={(event) => { setTone({ ...tone, [key]: Number(event.target.value) }); setTonePreset(""); }}
                  />
                </label>
              ))}
              <p className="hint">{t("Strength mixes the grade with the original: 0.2 is 20% of it. Pick the preset again to undo your changes.", "混合强度控制调色结果的占比，0.2 表示 20%。重新选择预设可恢复原设置。")}</p>
            </section>
          ) : (
          <section className="panel settings">
            <h2><span>3</span> {t("Settings", "设置")}</h2>
            {mode !== "post" && <div className="setting">
              <span>{t("Resolution", "分辨率")} <small>{typeof resolution === "object" ? t("Width × height. The video is scaled and centre-cropped to this shape.", "宽 × 高。将视频缩放并居中裁剪到指定尺寸。") : t(`${canvas ? `${canvas[0]} × ${canvas[1]} for this video` : "Short edge of the video"}. The shape follows the source.`, `${canvas ? `当前视频为 ${canvas[0]} × ${canvas[1]}` : "按视频短边设置分辨率"}。沿用原视频的宽高比。`)}</small></span>
              <div className="segmented">
                {RESOLUTIONS.map((r) => (
                  <button key={r} className={r === resolution ? "on" : ""} onClick={() => setResolution(r)}>{r}</button>
                ))}
                <button className={typeof resolution === "object" ? "on" : ""} onClick={() => setResolution(customSize)}>{t("Custom", "自定义")}</button>
              </div>
              {typeof resolution === "object" && (
                <div className="custom-size">
                  {(["width", "height"] as const).map((side) => (
                    <label key={side}>
                      {side === "height" && "×"}
                      <input
                        className="steps-input" type="number" aria-label={t(`Custom ${side} in pixels`, side === "width" ? "自定义宽度（像素）" : "自定义高度（像素）")} min={CUSTOM_SIZE.min} max={CUSTOM_SIZE.max} step={CUSTOM_SIZE.step}
                        defaultValue={resolution[side]} onBlur={(event) => { event.target.value = String(chooseSize(side, Number(event.target.value))); }}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>}
            {mode === "object" && (editMode === "change" || editMode === "remove") && (
              <label className="setting toggle">
                <span>{t("Only the biggest one", "仅处理最大目标")} <small>{t("Off: every match SAM finds changes (everyone's hair). On: only the one that fills the most of the frame.", "关闭时会更改 SAM 匹配到的所有目标（例如所有人的头发）。开启时只更改画面中占比最大的目标。")}</small></span>
                <input type="checkbox" checked={biggestOnly} onChange={(event) => setBiggestOnly(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode === "object" && editMode === "change" && (
              <label className="setting toggle">
                <span>{t("Keep original outline", "保留原轮廓")} <small>{t("On: the face, hands and arms around it stay exact, but the new look keeps the old shape (sleeves, length). Off: the shape can change (long hair to a bob, pants to a skirt), but edges near the face and hands may be lost.", "开启时保留周围的脸、手和手臂细节，新外观沿用原轮廓（如袖型和长度）。关闭时可以改变形状（如长发改短发、长裤改裙子），脸和手附近的边缘可能受影响。")}</small></span>
                <input type="checkbox" checked={keepOutline} onChange={(event) => setKeepOutline(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode === "simple" && (
              <div className="setting">
                <span>{t("What to replace", "替换目标")} <small>{t("What SAM tracks, in English: person, cat, dog, or a short description such as “black and white cat”. The biggest match is replaced.", "用英文填写 SAM 要跟踪的对象，如 person、cat、dog 或 “black and white cat”。仅替换画面占比最大的匹配对象。")}</small></span>
                <input className="target-input" aria-label={t("What to replace", "替换目标")} placeholder={DEFAULT_TARGET} value={target} onChange={(event) => setTarget(event.target.value)} />
              </div>
            )}
            {(mode === "simple" || mode === "advanced") && <label className="setting toggle">
              <span>{t("Hat fix", "帽子修复")} <small>{t(`Also replaces hats${mode === "advanced" ? " worn by the people being replaced" : ""} (about 45 s more per clip).`, "同时替换目标人物佩戴的帽子，每段约多耗时 45 秒。")}</small></span>
              <input type="checkbox" checked={hatFix} onChange={(event) => setHatFix(event.target.checked)} />
              <i aria-hidden />
            </label>}
            {(mode === "simple" || mode === "advanced") && <label className="setting toggle">
              <span>{t("No lip-sync", "关闭口型同步")} <small>{t(`For songs the people in the video do not sing or talk along to, so the new ${mode === "advanced" ? "people do" : "person does"} not lip-sync them (about 30 s more per clip).`, "当原人物没有跟着背景音乐唱歌或说话时，可关闭新角色的口型同步。每段约多耗时 30 秒。")}</small></span>
              <input type="checkbox" checked={noLipSync} onChange={(event) => setNoLipSync(event.target.checked)} />
              <i aria-hidden />
            </label>}
            {mode === "advanced" && !montage && (
              <label className="setting toggle">
                <span>{t("One pass per person", "逐人生成")} <small>{t(`Each character gets their own H3 pass with only their photo, so about twice the generation time.${shown.length === 2 ? "" : " Needs exactly two characters."}`, `H3 仅使用各角色的照片分别生成，耗时约为两倍。${shown.length === 2 ? "" : "此模式需要正好两个角色。"}`)}</small></span>
                <input type="checkbox" checked={onePassEach} disabled={shown.length !== 2} onChange={(event) => setMaxQuality(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode !== "post" && <div className="setting">
              <span>{t("Mask margin", "遮罩边距")} <small>{mode === "object"
                ? editMode === "background" ? t("How far the new place reaches into the edge of what stays.", "控制新背景向保留对象的边缘延伸多少。") : t("Room around it for a bigger new shape and its shadow.", "为较大的新轮廓及其阴影留出空间。")
                : t(`Room around the person for a differently built character.${mode === "simple" ? " Check mask shows it." : ""}`, `为体型不同的新角色在原人物周围预留空间。${mode === "simple" ? "可通过「检查遮罩」预览。" : ""}`)}</small></span>
              <MarginPicker value={margin} onChange={setMargin} />
            </div>}
            <details>
              <summary>{t("Advanced", "高级设置")}</summary>
              <div className="setting">
                <span>{t("Seed", "种子")} <small>{t("Change it for a new take.", "更改种子可以生成不同的结果。")}</small></span>
                <div className="seed">
                  <input type="number" min={0} max={MAX_SEED} value={seed} onChange={(event) => setSeed(Math.min(MAX_SEED, Math.max(0, Math.floor(Number(event.target.value) || 0))))} />
                  <button onClick={() => setSeed(Math.floor(Math.random() * MAX_SEED))} aria-label={t("Random seed", "随机种子")}>🎲</button>
                </div>
              </div>
              {faceFix ? (
                <div className="setting">
                  <span>{t("Chunk length", "分块时长")} <small>{t(`${chunkSeconds.toFixed(1)} s of face per H3 generation; chunks overlap by 1 s and are crossfaded.`, `H3 每次生成人脸 ${chunkSeconds.toFixed(1)} 秒。相邻片段重叠 1 秒并渐变融合。`)}</small></span>
                  <input type="range" min={CHUNK_SECONDS.min} max={CHUNK_SECONDS.max} step={0.5} value={chunkSeconds} onChange={(event) => setChunkSeconds(Number(event.target.value))} />
                </div>
              ) : (
                <div className="setting">
                  <span>{t("Clip length", "片段时长")} <small>{t(`${clipSeconds.toFixed(1)} s per H3 generation`, `H3 每次生成 ${clipSeconds.toFixed(1)} 秒`)}</small></span>
                  <input type="range" min={CLIP_SECONDS.min} max={CLIP_SECONDS.max} step={0.5} value={clipSeconds} onChange={(event) => setClipSeconds(Number(event.target.value))} />
                </div>
              )}
              {mode !== "post" && <div className="setting">
                <span>{t("Motion reference", "动作参考")} <small>{t("Size of the grey figures H3 copies the motion from. Bigger follows the source poses a bit more closely; sampling takes about a third longer at 768 px and about 2.4× as long at 1376 px.", "供 H3 模仿动作的灰色人偶尺寸。尺寸越大，越贴合原视频姿势。768 像素约多耗时三分之一，1376 像素约耗时 2.4 倍。")}</small></span>
                <div className="segmented">
                  {MOTION_SIZES.map((m) => (
                    <button key={m} className={m === motion ? "on" : ""} onClick={() => setMotion(m)}>{t(`${m} px`, `${m} 像素`)}</button>
                  ))}
                </div>
              </div>}
              <div className="setting">
                <span>{t("Steps", "采样步数")} <small>{t("6 with the DMAD speed LoRA; without a speed LoRA, 20 or more.", "使用 DMAD 加速 LoRA 时设为 6 步。未使用加速 LoRA 时至少设为 20 步。")}</small></span>
                <input
                  className="steps-input" type="number" min={STEPS.min} max={STEPS.max} value={steps}
                  onChange={(event) => setSteps(Math.min(STEPS.max, Math.max(STEPS.min, Math.floor(Number(event.target.value) || STEPS.min))))}
                />
              </div>
              <div className="setting">
                <span>{t("Base model", "基础模型")} <small>{t("The H3 diffusion model in ComfyUI's models/diffusion_models.", "ComfyUI 的 models/diffusion_models 目录中的 H3 扩散模型。")}</small></span>
                <FilePicker label={t("Base model", "基础模型")} value={model} options={files.models} onChange={setModel} />
              </div>
              <div className="setting">
                <span>{t("Visual describer", "视觉描述模型")} <small>{t("Reads pictures and video frames to write prompts. Use a vision-language model in models/text_encoders.", "读取图片和视频帧，生成提示词。请使用 models/text_encoders 目录中的视觉语言模型。")}</small></span>
                <FilePicker label={t("Visual describer", "视觉描述模型")} value={describer} options={files.textEncoders} onChange={setDescriber} />
              </div>
              <div className="setting">
                <span>{t("H3 text encoder", "H3 文本编码器")} <small>{t("Choose your MiniMax H3 Qwen3-VL 32B quantization from models/text_encoders.", "从 models/text_encoders 中选择 MiniMax H3 使用的 Qwen3-VL 32B 量化版本。")}</small></span>
                <FilePicker label={t("H3 text encoder", "H3 文本编码器")} value={textEncoder} options={files.textEncoders} onChange={setTextEncoder} />
              </div>
              <div className="setting">
                <span>{t("Video VAE", "视频 VAE")} <small>{t("Choose a MiniMax H3 video VAE from models/vae.", "从 models/vae 中选择 MiniMax H3 视频 VAE。")}</small></span>
                <FilePicker label={t("Video VAE", "视频 VAE")} value={videoVae} options={files.vaes} onChange={setVideoVae} />
              </div>
              <div className="setting">
                <span>{t("Audio VAE", "音频 VAE")} <small>{t("Choose a MiniMax H3 audio VAE from models/vae.", "从 models/vae 中选择 MiniMax H3 音频 VAE。")}</small></span>
                <FilePicker label={t("Audio VAE", "音频 VAE")} value={audioVae} options={files.vaes} onChange={setAudioVae} />
              </div>
              <label className="setting toggle">
                <span>{t("Use LoRAs", "使用 LoRA")} <small>{t("Turn off to use the base model alone. Without a speed LoRA, use 20 or more steps.", "关闭后只使用基础模型。未使用加速 LoRA 时至少设为 20 步。")}</small></span>
                <input type="checkbox" checked={useLoras} onChange={(event) => setUseLoras(event.target.checked)} />
                <i />
              </label>
              {useLoras && <div className="setting loras">
                <span>{t("LoRAs", "LoRA")} <small>{t("Applied in order to the base model.", "按列表顺序应用于基础模型。")}</small></span>
                <div className="lora-list">
                  {loras.map((l, i) => (
                    <div className="lora-entry" key={i}>
                      <div className="lora">
                        <FilePicker label={`LoRA ${i + 1}`} value={l.name} options={files.loras} onChange={(name) => setLoras(loras.map((x, j) => (j === i ? { ...x, name } : x)))} />
                        <input
                          type="number" aria-label={t(`LoRA ${i + 1} strength`, `LoRA ${i + 1} 强度`)} min={STRENGTH.min} max={STRENGTH.max} step={0.05} value={l.strength}
                          onChange={(event) => setLoras(loras.map((x, j) => (j === i ? { ...x, strength: Math.min(STRENGTH.max, Math.max(STRENGTH.min, Number(event.target.value) || 0)) } : x)))}
                        />
                        <button className="secondary" onClick={() => setLoras(loras.filter((_, j) => j !== i))} aria-label={t(`Remove LoRA ${i + 1}`, `移除 LoRA ${i + 1}`)}>×</button>
                      </div>
                      <label className="setting toggle">
                        <span>{isSpeedLora(l) ? t("Use speed LoRA", "启用加速 LoRA") : t("Use this LoRA", "启用此 LoRA")}<small>{t("Turn off to skip this LoRA and keep its settings.", "关闭后跳过此 LoRA，并保留它的配置。")}</small></span>
                        <input type="checkbox" aria-label={t(`Use LoRA ${i + 1}`, `启用 LoRA ${i + 1}`)} checked={l.enabled !== false}
                          onChange={(event) => setLoras(loras.map((x, j) => j === i ? { ...x, enabled: event.target.checked } : x))} />
                        <i />
                      </label>
                      {!isSpeedLora({ ...l, speed: false }) && <label className="setting toggle">
                        <span>{t("Speed LoRA", "加速 LoRA")} <small>{t("Mark renamed or other few-step LoRAs here.", "将改过文件名或其他少步数 LoRA 标记为加速 LoRA。")}</small></span>
                        <input type="checkbox" aria-label={t(`LoRA ${i + 1} is a speed LoRA`, `将 LoRA ${i + 1} 标记为加速 LoRA`)} checked={l.speed === true}
                          onChange={(event) => setLoras(loras.map((x, j) => j === i ? { ...x, speed: event.target.checked } : x))} />
                        <i />
                      </label>}
                    </div>
                  ))}
                  {loras.length < MAX_LORAS && (
                    <button className="secondary" onClick={() => setLoras([...loras, { name: files.loras[0] ?? "", strength: 1 }])}>{t("Add LoRA", "添加 LoRA")}</button>
                  )}
                </div>
              </div>}
              <div className="setting">
                <span>{t("Acceleration", "加速方式")} <small>{speedLora ? t("Turn off the speed LoRA to use Spectrum.", "关闭加速 LoRA 后可使用 Spectrum。") : t("Spectrum skips some H3 evaluations and can change the result. Requires ComfyUI-Spectrum-MiniMax-H3; use 20 or more steps.", "Spectrum 跳过部分 H3 计算，可能影响结果。需要 ComfyUI-Spectrum-MiniMax-H3，采样步数至少设为 20。")}</small></span>
                <select className="file-name" aria-label={t("Acceleration", "加速方式")} value={selectedAcceleration} disabled={speedLora} onChange={(event) => setAcceleration(event.target.value as Acceleration)}>
                  <option value="none">{t("Off", "关闭")}</option>
                  <option value="spectrum">Spectrum</option>
                </select>
              </div>
            </details>
          </section>
          )}

          <div className="go">
            <div className="row">
              {mode === "simple" && <button className="secondary" disabled={!video || submitting} onClick={() => submit("mask")}>{t("Check mask", "检查遮罩")}</button>}
              {mode === "object" && editMode === "add" && <button className="secondary" disabled={!video || !placement.length || submitting} onClick={() => submit("fit")}>{t("Check fit", "检查范围")}</button>}
              {mode === "advanced" && montage ? (<>
                <button className="secondary" disabled={!video || !character || submitting} onClick={() => submit("people")}>{t("Find people", "查找人物")}</button>
                <button className="primary" disabled={!video || !character || submitting} onClick={() => submit("montage")}>{submitting ? checkingSetup ? t("Checking setup…", "正在检查配置…") : t("Uploading…", "正在上传…") : t("Generate", "生成")}</button>
              </>) : (
                <button className="primary" disabled={!video || !ready || submitting} onClick={() => submit(generateKind)}>
                  {submitting ? checkingSetup ? t("Checking setup…", "正在检查配置…") : t("Uploading…", "正在上传…") : t("Generate", "生成")}
                </button>
              )}
            </div>
            <small>{colorFix
              ? !video ? t("Add a video.", "请添加视频。") : ready ? t(`${(part.length || video.duration).toFixed(1)} s of video`, `视频时长 ${(part.length || video.duration).toFixed(1)} 秒`) : t("Turn on detail contrast, the tone mapper or both.", "请启用细节对比度或色调映射。")
              : clips && ready
              ? mode === "advanced" && montage ? t(`${clips > 1 ? "About " : ""}${clips} clip${clips > 1 ? "s" : ""} or more at ${outputSize}; Find people (about 3 minutes per 18 s) lets you check the picks first.`, `${outputSize}，至少 ${clips > 1 ? "约 " : ""}${clips} 段。可先「查找人物」确认替换对象，每 18 秒视频约需 3 分钟。`)
              : faceFix ? t(`Up to ${clips} chunk${clips > 1 ? "s" : ""} of face`, `最多处理 ${clips} 段人脸`)
              : t(`${clips > 1 ? "About " : ""}${clips} clip${clips > 1 ? "s" : ""} at ${outputSize}`, `${outputSize}，${clips > 1 ? "约 " : ""}${clips} 段`)
              : mode === "object" && editMode === "add" && video && !placement.length ? t("Draw where the new object should go.", "请画出新物体的放置区域。")
              : t(`Add a video and ${mode === "object" ? editMode === "add" ? "describe the object to add" : "say what it becomes" : faceFix ? "the photo of the person" : mode === "simple" ? "a character photo" : "character photos"}.`,
                mode === "object" ? (editMode === "add" ? "请添加视频并描述要添加的物体。" : "请添加视频并描述修改后的样子。") : faceFix ? "请添加视频和人物照片。" : "请添加视频和角色照片。")}</small>
          </div>

          {history.length > 0 && (
            <section className="history">
              <div className="row">
                <h2>{t("Recent jobs", "近期任务")}</h2>
                <button className="link" onClick={() => setHistory([])}>{t("Clear", "清空")}</button>
              </div>
              <ul>
                {history.map((p) => (
                  <li key={p.id}>
                    <button disabled={submitting} onClick={() => reopen(p)}>
                      <span>{t(...KIND_LABELS[p.kind])}</span>
                      <small>{new Date(p.startedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                      <small className={p.status}>{t(...(STATUS_LABELS[p.status ?? ""] ?? ["Not finished", "未完成"]))}</small>
                      <small className="file">{p.result}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function RunView({ run, job, progress, preview, streamError, now, before, onCancel, onReset, onFix, onGenerate, onUseBox, margin, onMargin, onRecheck, photos, onMontage, frames, onRetry }: {
  run: Run; job: PublicJob | null; progress: Progress | null; preview: string; streamError: string; now: number;
  before: { url: string; start: number } | null;
  onCancel: () => void; onReset: () => void; onFix: (post: Post) => void; onGenerate: (() => void) | null;
  onUseBox: ((box: NonNullable<FitSummary["needed"]>) => void) | null;
  margin: Margin; onMargin: (margin: Margin) => void; onRecheck: (() => void) | null;
  photos: string[]; onMontage: ((tracks: string, labels: Label[]) => void) | null; frames: string; onRetry: (() => void) | null;
}) {
  const t = useT();
  const errorText = useErrorText();
  const status = job?.status ?? "queued";
  const clips = Math.max(run.clips, progress?.clip ?? 1);
  const people = run.kind === "people";
  const mask = run.kind === "mask" || run.kind === "fit" || people;

  if (people && status === "succeeded" && job?.data) {
    return (
      <PersonList
        url={job.data} photos={photos} onBack={onReset}
        onGenerate={run.frames === frames ? onMontage : null}
      />
    );
  }

  if (run.kind === "mask" && status === "succeeded" && job?.video) {
    return (
      <MaskCheck
        url={job.video.url} clipSeconds={run.clipSeconds} checked={run.margin ?? "normal"} margin={margin}
        onMargin={onMargin} onRecheck={onRecheck} onGenerate={onGenerate} onBack={onReset}
      />
    );
  }

  if (run.kind === "fit" && status === "succeeded" && job?.video) {
    return <FitCheck url={job.video.url} data={job.data} onUseBox={onUseBox} onGenerate={onGenerate} onBack={onReset} />;
  }

  if (status === "succeeded" && job?.video) {
    return (
      <section className="panel result">
        {before ? <Compare before={before} after={job.video.url} /> : <video src={job.video.url} controls autoPlay playsInline />}
        {run.kind === "montage" && job.data && <KeptNote url={job.data} />}
        <div className="row">
          <a className="primary" href={`${job.video.url}?download`} download={job.video.name}>{t("Download MP4", "下载 MP4")}</a>
          {POSTS.filter((p) => p !== run.kind).map((p) => <button key={p} className="secondary" onClick={() => onFix(p)}>{t(...KIND_LABELS[p])}</button>)}
          <button className="secondary" onClick={onReset}>{run.kind === "object" ? t("New edit", "继续编辑") : run.kind === "face" || run.kind === "color" ? t("Fix another", "处理其他视频") : t("New swap", "开始新的替换")}</button>
        </div>
      </section>
    );
  }

  if (TERMINAL.has(status)) {
    const outputFolder = `output/${run.kind === "object" ? "h3_oneclick_edit" : run.kind === "face" ? "openjutsu_face" : run.kind === "color" ? "openjutsu_color" : "h3_oneclick_swap"}`;
    return (
      <section className="panel">
        <h2>{status === "canceled" ? t(...STATUS_LABELS.canceled) : status === "succeeded" ? t("Finished without a video", "任务结束，未生成视频") : status === "expired" ? t("Job no longer available", "任务已失效") : t("Something went wrong", "处理失败")}</h2>
        {job?.error && <p className="error">{errorText(job.error)}</p>}
        {status === "expired" && <p className="hint">{t(`ComfyUI no longer knows this job, for example after a restart. Finished videos are in ComfyUI's ${outputFolder} folder.`, `ComfyUI 已找不到此任务，可能是服务重启所致。已完成的视频位于 ComfyUI 的 ${outputFolder} 目录。`)}</p>}
        <div className="row">
          {status !== "succeeded" && onRetry && <button className="primary" onClick={onRetry}>{t("Retry", "重试")}</button>}
          {(status === "failed" || status === "expired") && <CopyDetails lines={[jobLine(run, job), job?.error ? `Error: ${job.error}` : "", streamError && `Stream error: ${streamError}`]} />}
          <button className="secondary" onClick={onReset}>{t("Back", "返回")}</button>
        </div>
      </section>
    );
  }

  const face = run.kind === "face";
  const color = run.kind === "color";
  const sampling = progress?.classType === "SamplerCustomAdvanced";
  const chunk = Math.min(progress?.pass ?? 0, run.clips);
  let fraction = 0;
  if (color) fraction = COLOR_SHARE[progress?.classType ?? ""] ?? 0.05;
  else if (face) fraction = sampling ? 0.1 + 0.85 * (chunk - 1 + (progress!.steps ? (progress!.step ?? 0) / progress!.steps : 0)) / run.clips : chunk ? 0.97 : 0.05;
  else if (mask) fraction = progress?.classType === "SAM3_VideoTrack" && progress.steps ? (progress.step ?? 0) / progress.steps : 0;
  else if (progress?.classType === "MiniMaxH3ChainAssemble") fraction = 0.99;
  else if (progress?.clip) fraction = (progress.clip - 1 + clipShare(progress)) / clips;

  return (
    <section className="panel progress">
      <div className="row">
        <h2>{status === "queued" ? t(`Queued${job?.queuePosition ? ` (#${job.queuePosition})` : ""}`, `排队中${job?.queuePosition ? `（第 ${job.queuePosition} 位）` : ""}`) : people ? t("Finding people", "正在查找人物") : run.kind === "fit" ? t("Checking the fit", "正在检查范围") : mask ? t("Checking the mask", "正在检查遮罩") : color ? t("Fixing the colours", "正在修正色彩")
          : face ? (sampling ? t(`Chunk ${chunk} of up to ${run.clips}`, `第 ${chunk} 段，最多 ${run.clips} 段`) : chunk ? t("Pasting the face back", "正在贴回人脸") : t("Tracking the face", "正在跟踪人脸"))
          : progress?.clip ? t(`Clip ${progress.clip} of ${clips > 1 || run.kind === "montage" ? "about " : ""}${clips}`, `第 ${progress.clip} 段，共 ${clips > 1 || run.kind === "montage" ? "约 " : ""}${clips} 段`) : t("Preparing", "准备中")}</h2>
        <span className="time">{elapsed(now - run.startedAt)}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
      <p className="node">
        {progress ? t(progress.title, nodeLabel(progress.title)) : status === "queued" ? t("Waiting for ComfyUI…", "正在等待 ComfyUI…") : t("Working…", "处理中…")}
        {progress?.steps ? t(` · step ${progress.step ?? 0}/${progress.steps}`, ` · 步骤 ${progress.step ?? 0}/${progress.steps}`) : ""}
      </p>
      {preview && <img className="preview" src={preview} alt={t("Mask preview: white areas are regenerated", "遮罩预览，白色为重新生成的区域")} />}
      {streamError && <div className="row">
        <p className="error">{errorText(streamError)}</p>
        <CopyDetails lines={[jobLine(run, job), `Stream error: ${streamError}`]} />
      </div>}
      <p className="hint">{people ? t("SAM tracks everyone over the whole video, then Qwen matches each person to a role.", "SAM 跟踪整段视频中的所有人物，Qwen 随后为每个人匹配角色。") : mask ? t("SAM tracks the whole video once, about a minute per 3 s of video.", "SAM 一次跟踪整段视频，每 3 秒视频约需 1 分钟。") : color ? t("Every frame goes through the filters, then the video is saved with its soundtrack.", "滤镜会逐帧处理，随后将视频和音轨一起保存。") : face ? t("The face is tracked over the whole video, then each chunk is regenerated; nothing is saved until the end.", "先跟踪整段视频的人脸，再逐段重新生成，全部完成后统一保存。") : t("Each clip is saved as it finishes, so a rerun with the same inputs resumes where it stopped.", "每段完成后立即保存。使用相同输入重试时，会从上次中断处继续。")}{t(" You can close this page and come back.", "可关闭此页面，稍后再回来查看。")}</p>
      <div className="row">
        <button className="secondary" onClick={onCancel}>{t("Cancel", "取消")}</button>
        <button className="secondary" onClick={onReset}>{t("Back", "返回")}</button>
      </div>
    </section>
  );
}

// The result plays with its own controls; the source follows it from the start of the part used, clipped to the left of the divider.
function Compare({ before, after }: { before: { url: string; start: number }; after: string }) {
  const t = useT();
  const result = useRef<HTMLVideoElement>(null);
  const source = useRef<HTMLVideoElement>(null);
  const [split, setSplit] = useState(50);
  const [ratio, setRatio] = useState(16 / 9);
  const [paused, setPaused] = useState(true);

  function follow(drift = 0) {
    const r = result.current, s = source.current;
    if (!r || !s) return;
    const target = r.currentTime + before.start;
    if (Math.abs(s.currentTime - target) > drift) s.currentTime = target;
  }

  function play() {
    const s = source.current;
    if (!s || !result.current) return;
    s.playbackRate = result.current.playbackRate;
    follow();
    s.play().catch(() => {});
    setPaused(false);
  }

  function pause() {
    source.current?.pause();
    follow();
    setPaused(true);
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.parentElement!.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
  }

  return (
    <div className={`compare ${paused ? "paused" : ""}`} style={{ "--split": `${split}%`, "--ratio": ratio } as CSSProperties}>
      <video
        ref={result} src={after} controls autoPlay playsInline
        onLoadedMetadata={(event) => event.currentTarget.videoHeight && setRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)}
        onPlay={play} onPause={pause} onSeeking={() => follow()} onTimeUpdate={() => follow(0.1)}
        onRateChange={(event) => { if (source.current) source.current.playbackRate = event.currentTarget.playbackRate; }}
      />
      <video ref={source} className="before" src={before.url} muted playsInline preload="auto" aria-hidden onLoadedMetadata={() => follow()} />
      <span className="compare-label">{t("Before", "原视频")}</span>
      <span className="compare-label after">{t("After", "处理后")}</span>
      <div
        className="compare-line" role="slider" tabIndex={0} aria-label={t("Before and after divider", "处理前后对比分隔线")}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag(event); }}
        onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && drag(event)}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
          if (!step) return;
          event.preventDefault();
          setSplit((current) => Math.min(100, Math.max(0, current + step)));
        }}
      />
    </div>
  );
}

function MaskCheck({ url, clipSeconds, checked, margin, onMargin, onRecheck, onGenerate, onBack }: {
  url: string; clipSeconds: number; checked: Margin; margin: Margin; onMargin: (margin: Margin) => void;
  onRecheck: (() => void) | null; onGenerate: (() => void) | null; onBack: () => void;
}) {
  const t = useT();
  const player = useRef<HTMLVideoElement>(null);
  const [frames, setFrames] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const starts = frames ? clipStarts(frames / 24, clipSeconds) : [0];
  const currentClip = starts.filter((start) => start <= frame).length;

  function seek(target: number) {
    const v = player.current;
    if (!v || !frames) return;
    v.pause();
    setPlaying(false);
    const next = Math.max(0, Math.min(frames - 1, target));
    setFrame(next);
    v.currentTime = (next + 0.5) / 24;
  }

  function toggle() {
    const v = player.current;
    if (!v) return;
    if (playing) v.pause();
    else v.play();
    setPlaying(!playing);
  }

  return (
    <section className="panel mask-check">
      <h2>{t("Check the mask", "检查遮罩")}</h2>
      <video
        ref={player} src={url} muted playsInline preload="auto"
        onLoadedMetadata={(event) => setFrames(Number.isFinite(event.currentTarget.duration) ? Math.round(event.currentTarget.duration * 24) : 0)}
        onTimeUpdate={(event) => playing && setFrame(Math.min(frames - 1, Math.floor(event.currentTarget.currentTime * 24)))}
        onEnded={() => setPlaying(false)}
      />
      <input className="scrub" type="range" min={0} max={Math.max(frames - 1, 0)} value={frame} aria-label={t("Frame", "帧")} onChange={(event) => seek(Number(event.target.value))} />
      <div className="row">
        <div className="steps">
          <button className="secondary" onClick={() => seek(frame - 1)} aria-label={t("Previous frame", "上一帧")}>◀</button>
          <button className="secondary" onClick={toggle}>{playing ? t("Pause", "暂停") : t("Play", "播放")}</button>
          <button className="secondary" onClick={() => seek(frame + 1)} aria-label={t("Next frame", "下一帧")}>▶</button>
        </div>
        <small>{t(`Frame ${frame + 1} / ${frames} · ${(frame / 24).toFixed(2)} s · clip ${currentClip} of ${starts.length > 1 ? "about " : ""}${starts.length}`,
          `第 ${frame + 1} 帧 / 共 ${frames} 帧 · ${(frame / 24).toFixed(2)} 秒 · 第 ${currentClip} 段 / 共 ${starts.length > 1 ? "约 " : ""}${starts.length} 段`)}</small>
      </div>
      <p className="hint legend">
        <i className="swatch cyan" /> {t("regenerated", "重新生成区域")} <i className="swatch orange" /> {t("tracked person · right: the grey mannequin H3 copies the motion from. Anything outside the cyan area stays as it is, so the new character should fit inside it.", "跟踪到的人物 · 右侧灰色人偶是 H3 的动作参考。青色区域之外保留原样，请确保新角色能放入青色区域。")}
      </p>
      <p className="hint">{t("The check tracks the whole video at once and the render tracks each clip, so they can differ slightly. Clip numbers here are an estimate: the render also ends clips on hard cuts.", "检查时一次跟踪整段视频，生成时逐段跟踪，结果可能略有不同。这里的片段数是估算值，生成时还会在硬切处分段。")}</p>
      <div className="setting">
        <span>{t("Mask margin", "遮罩边距")} <small>{t(`${margin === checked ? `Showing ${checked}.` : `Showing ${checked}; check again to see ${margin}.`} Tight keeps more background, loose gives a bigger character more room.`,
          `当前预览使用「${MARGIN_LABELS[checked]}」边距。${margin === checked ? "" : `重新检查可预览「${MARGIN_LABELS[margin]}」。`}边距越窄，保留的背景越多；边距越宽，越适合体型较大的角色。`)}</small></span>
        <MarginPicker value={margin} onChange={onMargin} />
      </div>
      <div className="row">
        {margin !== checked && <button className="primary" disabled={!onRecheck} onClick={() => onRecheck?.()}>{t("Check again", "重新检查")}</button>}
        <button className={margin === checked ? "primary" : "secondary"} disabled={!onGenerate} onClick={() => onGenerate?.()}>
          {margin === checked ? t("Looks good, generate", "确认并生成") : t(`Generate with ${margin}`, `使用${MARGIN_LABELS[margin]}边距生成`)}
        </button>
        <button className="secondary" onClick={onBack}>{t("Back to settings", "返回设置")}</button>
      </div>
      {!onGenerate && <p className="hint">{t("To generate, load the video this check used and add a character photo in the settings.", "要生成视频，请载入本次检查使用的视频，并在设置中添加角色照片。")}</p>}
    </section>
  );
}

// Where the routine of the person the add copies leaves the box, before generating.
function FitCheck({ url, data, onUseBox, onGenerate, onBack }: {
  url: string; data: string | null; onUseBox: ((box: NonNullable<FitSummary["needed"]>) => void) | null; onGenerate: (() => void) | null; onBack: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [summary, setSummary] = useState<FitSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (data) fetch(data).then((response) => response.json()).then(setSummary, () => setError("Could not read what the fit check found."));
  }, [data]);

  const misses = summary?.outside ?? [];
  return (
    <section className="panel mask-check">
      <h2>{t("Check the fit", "检查范围")}</h2>
      <video src={url} controls loop autoPlay muted playsInline />
      <p className="hint legend">
        <i className="swatch green" /> {t("predicted motion inside the edit area", "预测动作在编辑区域内")} <i className="swatch red" /> {t("outside it: possible clipping. Yellow: edit boundary.", "预测动作超出区域，可能被裁掉。黄色为编辑边界。")}
      </p>
      {error && <p className="error">{errorText(error)}</p>}
      {summary && <p>{!summary.person ? t("No one to copy was found in this part, so there is nothing to check the box against.", "这段视频里没有找到可模仿动作的人物，无法检查放置框。")
        : misses.length ? t(`${summary.moving ? "Their predicted motion leaves the moving edit area" : "Their routine leaves the box"} at ${misses.map((o) => `${timecode(o.start / 24)}–${timecode(o.end / 24)} (${o.sides.join(", ")})`).join(", ")}.`,
          `${summary.moving ? "预测动作超出移动的编辑区域" : "动作超出放置框"}：${misses.map((o) => `${timecode(o.start / 24)}–${timecode(o.end / 24)}（${o.sides.map((side) => SIDE_LABELS[side]).join("、")}）`).join("，")}。`)
        : summary.moving ? t("Their predicted motion stays inside the moving edit area.", "预测动作始终在移动的编辑区域内。") : t("Their whole routine fits inside your box.", "完整动作都在放置框内。")}</p>}
      <p className="hint">{summary?.moving ? t("The yellow boundary follows the copied routine and is the same moving edit area used for generation. Your box sets placement and scale. H3 can move differently, so this remains a guide.", "黄色边界跟随参考动作移动，也是生成时使用的编辑区域。放置框决定位置和大小。H3 生成的动作可能有出入，预览供参考。") : t("The check moves the person nearest your box into it, as tall as the box and standing on its bottom edge. H3 follows a routine loosely, so it is a guide, not a promise. A box much wider than one person can also bring back a copy of the dancer.", "预览会将离放置框最近的人物放入框内，缩放至与框等高，脚踩底边。H3 生成的动作可能有出入，预览供参考。框过宽时，还可能生成舞者的副本。")}</p>
      <div className="row">
        {summary?.needed && misses.length > 0 && <button className="primary" disabled={!onUseBox} onClick={() => onUseBox?.(summary.needed!)}>{t("Use a box that fits", "使用合适的框")}</button>}
        <button className={misses.length ? "secondary" : "primary"} disabled={!onGenerate} onClick={() => onGenerate?.()}>{t("Generate", "生成")}</button>
        <button className="secondary" onClick={onBack}>{t("Back to settings", "返回设置")}</button>
      </div>
      {!onGenerate && <p className="hint">{t("To generate, load the video and part this check used and fill in the Add settings.", "要生成视频，请载入本次检查使用的视频和片段，并填写「添加」设置。")}</p>}
    </section>
  );
}

// A montage without review keeps brief or small appearances as they are; say so instead of passing the swap off as complete.
function KeptNote({ url }: { url: string }) {
  const t = useT();
  const [kept, setKept] = useState<Kept[]>([]);
  useEffect(() => {
    fetch(url).then((response) => response.json()).then((data: { kept: Kept[] }) => setKept(data.kept), () => setKept([]));
  }, [url]);
  if (!kept.length) return null;
  return (
    <p className="hint">
      {t(`Left as they are, too ${kept.every((k) => k.small) ? "small" : "brief or small"} for H3 to draw: ${kept.map((k) => `photo ${k.photo}'s person at ${timecode(k.start / 24)}–${timecode(k.end / 24)}`).join(", ")}. Use Find people to pick them anyway.`,
        `以下人物因${kept.every((k) => k.small) ? "画面占比太小" : "出镜太短或画面占比太小"}，已保留原样：${kept.map((k) => `照片 ${k.photo} 对应的人物（${timecode(k.start / 24)}–${timecode(k.end / 24)}）`).join("、")}。如需替换，可通过「查找人物」手动选择。`)}
    </p>
  );
}

function PersonList({ url, photos, onBack, onGenerate }: {
  url: string; photos: string[]; onBack: () => void; onGenerate: ((tracks: string, labels: Label[]) => void) | null;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [found, setFound] = useState<{ tracks: string | null; list: Appearance[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(url).then((response) => response.json()).then((people: People) => setFound({ tracks: people.tracks, list: appearances(people) }),
      () => setError("Could not read what Find people found."));
  }, [url]);

  const labels = found ? renderLabels(found.list) : [];

  function pick(index: number, photo: number) {
    setFound((current) => current && { ...current, list: current.list.map((a, i) => (i === index ? { ...a, pick: photo } : a)) });
  }

  return (
    <section className="panel">
      <h2>{t("People", "人物")} {found && <small>{t(`${found.list.length} appearance${found.list.length === 1 ? "" : "s"}`, `${found.list.length} 次出镜`)}</small>}</h2>
      <p className="hint">
        {t("Everyone SAM tracked, in order of appearance, matched to the photos. Check each one and pick the photo they become, or Keep to leave them as they are. The whole video is then made in one go, with one H3 pass per photo on screen.", "按出镜顺序列出 SAM 跟踪到的人物及匹配的照片。请逐一确认并选择替换照片，也可选「保留原样」。整段视频会一次生成，画面中的每张角色照片各运行一次 H3。")}
      </p>
      {error && <p className="error">{errorText(error)}</p>}
      {!found && !error && <p className="hint">{t("Loading…", "加载中…")}</p>}
      <div className="people-list">
        {found?.list.map((a, i) => (
          <div className="person" key={`${a.track}:${a.start}`}>
            <img src={a.image} alt={t(`Appearance ${i + 1}`, `第 ${i + 1} 次出镜`)} />
            <small>
              {timecode(a.on[0][0] / 24)}–{timecode(a.on.at(-1)![1] / 24)} · {a.role ? t(`looks like photo ${a.role}`, `与照片 ${a.role} 相似`) : t("none of the photos", "与所有照片均不匹配")}
              {a.small ? t(" · small in the frame", " · 画面占比较小") : ""}
            </small>
            <div className="segmented photo-pick">
              {photos.map((photo, k) => (
                <button key={k} className={a.pick === k + 1 ? "on" : ""} onClick={() => pick(i, k + 1)} aria-label={t(`Photo ${k + 1}`, `照片 ${k + 1}`)}>
                  <img src={photo} alt="" />
                </button>
              ))}
              <button className={a.pick ? "" : "on"} onClick={() => pick(i, 0)}>{t("Keep", "保留原样")}</button>
            </div>
          </div>
        ))}
      </div>
      {found && !found.list.length && <p className="hint">{t("Nobody found.", "未找到人物。")}</p>}
      {found && !onGenerate && <p className="hint">{t("The video, the part to use or the custom size changed since Find people, or a photo is missing. Go back and find the people again.", "视频、选用的片段或自定义尺寸已改变，或缺少角色照片。请返回并重新查找人物。")}</p>}
      <div className="row">
        <button className="primary" disabled={!onGenerate || !found?.tracks || !labels.length} onClick={() => onGenerate?.(found!.tracks!, labels)}>
          {labels.length ? t("Generate", "生成") : t("Pick a photo to generate", "请选择照片再生成")}
        </button>
        <button className="secondary" onClick={onBack}>{t("Back to settings", "返回设置")}</button>
      </div>
    </section>
  );
}
