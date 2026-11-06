"use client";

import { useEffect, useRef, useState } from "react";
import { placeLabels } from "../lib/locale.ts";
import { useErrorText, useT } from "../lib/locale-provider.tsx";
import { canvasSize, CUSTOM_SIZE, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, PLACES, placeStart, RESOLUTIONS, timecode } from "../lib/simple.ts";
import { DEFAULT_MODEL, installedDefault, MAX_LORAS, STEPS, STRENGTH } from "../lib/model.ts";
import { DEFAULT_PICTURE_VIDEO, FRAME_RELIGHT_PROMPT, LIGHT_LOOKS, parsePictureVideoSettings, pictureFrames, RELIGHT_PROMPT, solarLoraFiles, type PictureVideoSettings } from "../lib/picture.ts";

const PROMPT = "change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.";
const STORAGE = "openjutsu.picture-preview";
const VIDEO_STORAGE = "openjutsu.picture-video-settings";
const DESCRIPTION_STORAGE = "openjutsu.picture-description";
const MAX_SECONDS = 15;
type Job = { id: string; stage: "prepare" | "describe" | "render" };

const lightLookLabels: Record<string, string> = {
  "Cold beam": "冷白光束",
  "Golden halo": "金色光晕",
  "Red and blue gels": "红蓝双色光",
  "Magenta club · mostly the background": "洋红夜店灯光 · 主要影响背景",
  "Teal lasers · mostly the background": "蓝绿色激光 · 主要影响背景",
  "Toxic green": "诡异荧光绿",
  "Lime and purple": "黄绿与紫色灯光",
  "Cyan orb": "青色光球",
  "Red room": "深红房间",
  "Venetian blinds": "百叶窗光影",
  "Phone glow": "手机屏幕光",
  "Firelight": "篝火光",
  "Sunset window": "窗边夕阳",
  "Evening lamp": "夜间台灯",
  "Rim backlight": "逆光轮廓",
  "Blue night": "蓝色夜景",
  "Camera flash": "相机闪光灯",
};

export function FromPicture({ initialVideo, initialPicture, start: initialStart = 0, describer }: { initialVideo?: File; initialPicture?: File; start?: number; describer: string }) {
  const t = useT();
  const errorText = useErrorText();
  const [video, setVideo] = useState<File | null>(initialVideo ?? null);
  const [picture, setPicture] = useState<File | null>(initialPicture ?? null);
  const [videoUrl, setVideoUrl] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");
  const [size, setSize] = useState<[number, number] | null>(null);
  const [start, setStart] = useState(initialStart);
  const [duration, setDuration] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  const [seed, setSeed] = useState(0);
  const [prompt, setPrompt] = useState(PROMPT);
  const [look, setLook] = useState(-1);
  const [ownLight, setOwnLight] = useState("Light the new photo with ");
  const [relightPrompt, setRelightPrompt] = useState(RELIGHT_PROMPT);
  const [ownPerson, setOwnPerson] = useState(false);
  const [framePrompt, setFramePrompt] = useState(FRAME_RELIGHT_PROMPT);
  const [keepCrop, setKeepCrop] = useState(false);
  const [denoise, setDenoise] = useState(0.9);
  const [job, setJob] = useState<Job | null>(null);
  const [prepared, setPrepared] = useState("");
  const [preview, setPreview] = useState<{ url: string; frame: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const [description, setDescription] = useState("");
  const [settings, setSettings] = useState<PictureVideoSettings>(() => structuredClone(DEFAULT_PICTURE_VIDEO));
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [files, setFiles] = useState<{ models: string[]; loras: string[]; textEncoders: string[]; vaes: string[] }>({ models: [], loras: [], textEncoders: [], vaes: [] });
  const [modelError, setModelError] = useState("");
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const busy = submitting || !!job;
  const relight = look >= 0;
  const light = look === LIGHT_LOOKS.length ? ownLight : LIGHT_LOOKS[look]?.light ?? "";
  const ready = !!video && (ownPerson || !!picture) && !!size && (relight ? !!light.trim() : !ownPerson);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
      if (typeof saved?.prepared === "string") setPrepared(saved.prepared);
      setApproved(saved?.approved === true || saved?.job?.stage === "render");
      setDescription(localStorage.getItem(DESCRIPTION_STORAGE) ?? "");
      if (typeof saved?.job?.id === "string" && ["prepare", "describe", "render"].includes(saved.job.stage)) {
        setJob(saved.job);
        if (saved.job.stage !== "prepare" && saved.prepared) {
          const base = `/api/picture?id=${encodeURIComponent(saved.prepared)}`;
          setPreview({ url: `${base}&media=result`, frame: `${base}&media=frame` });
        }
      }
      else if (typeof saved?.prepared === "string" && saved.prepared) setJob({ id: saved.prepared, stage: "prepare" });
    } catch {}
    try { setSettings(parsePictureVideoSettings(JSON.parse(localStorage.getItem(VIDEO_STORAGE) ?? "{}"))); } catch {}
    setSettingsLoaded(true);
    fetch("/api/models").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const loras: string[] = data.loras ?? [];
      const encoders: string[] = data.textEncoders ?? [];
      setFiles({ models: data.models ?? [], loras, textEncoders: encoders, vaes: data.vaes ?? [] });
      setSettings((current) => {
        const defaults = solarLoraFiles(current.solarRank), installed = solarLoraFiles(current.solarRank, loras);
        const savedDefaults = solarLoraFiles(current.solarRank, [current.solarFourStep, current.solarControl]);
        const textEncoder = installedDefault(current.textEncoder, DEFAULT_MODEL.textEncoder, process.env.NEXT_PUBLIC_OPENJUTSU_H3_ENCODER, encoders);
        const rank64 = solarLoraFiles(64, loras);
        if (current.solarRank === 384 && current.solarFourStep === savedDefaults.solarFourStep && current.solarControl === savedDefaults.solarControl
          && !Object.values(installed).every((file) => loras.includes(file)) && Object.values(rank64).every((file) => loras.includes(file))) {
          return { ...current, textEncoder, solarRank: 64, ...rank64 };
        }
        return { ...current, textEncoder, solarFourStep: current.solarFourStep === defaults.solarFourStep ? installed.solarFourStep : current.solarFourStep,
          solarControl: current.solarControl === defaults.solarControl ? installed.solarControl : current.solarControl };
      });
    }).catch((error) => setModelError(error.message));
  }, []);
  useEffect(() => {
    if (settingsLoaded) try { localStorage.setItem(VIDEO_STORAGE, JSON.stringify(settings)); } catch {}
  }, [settings, settingsLoaded]);
  useEffect(() => {
    if (!video) return;
    const url = URL.createObjectURL(video); setVideoUrl(url); setSize(null);
    return () => URL.revokeObjectURL(url);
  }, [video]);
  useEffect(() => {
    if (!picture) return;
    const url = URL.createObjectURL(picture); setPictureUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  function remember(next: Job | null, image: string, accepted: boolean) {
    try { localStorage.setItem(STORAGE, JSON.stringify({ job: next, prepared: image, approved: accepted })); } catch {}
  }
  function keepDescription(text: string) {
    setDescription(text);
    try { localStorage.setItem(DESCRIPTION_STORAGE, text); } catch {}
  }
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/picture?id=${encodeURIComponent(job!.id)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "Could not read the job.");
          if ([400, 404, 422].includes(response.status)) { setJob(null); remember(null, prepared, job!.stage !== "prepare"); }
          else timer = setTimeout(poll, 5000);
          return;
        }
        setError("");
        if (data.status !== "ready") { timer = setTimeout(poll, 2000); return; }
        if (job!.stage === "prepare") {
          setPrepared(job!.id); setPreview({ url: data.url, frame: data.frame }); setSize([data.width, data.height]); remember(null, job!.id, approved);
        } else if (job!.stage === "describe") { keepDescription(data.text); remember(null, prepared, true); }
        else { setResult(data.url); remember(job, prepared, true); }
        setJob(null);
      } catch {
        if (!controller.signal.aborted) { setError("Connection interrupted. Retrying…"); timer = setTimeout(poll, 5000); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job, prepared]);

  // The part is start + the video length; only a new start changes the pose frame.
  function choosePart(nextStart: number, length: number, total = duration) {
    const begin = Math.min(Math.max(0, nextStart), total - length);
    if (begin !== start) { invalidate(); setStart(begin); }
    setSettings((current) => ({ ...current, seconds: length }));
    if (player.current) player.current.currentTime = begin;
  }
  function invalidate() {
    setPrepared(""); setPreview(null); setApproved(false); setResult(""); setError(""); remember(null, "", false); keepDescription("");
  }
  async function prepare(nextSeed: number) {
    if (!ready || !video || !size) return;
    setSubmitting(true); invalidate(); setSeed(nextSeed);
    try {
      const form = new FormData();
      form.set("video", video); form.set("start", String(start)); form.set("seed", String(nextSeed));
      form.set("width", String(size[0])); form.set("height", String(size[1])); form.set("prompt", ownPerson ? framePrompt : relight ? relightPrompt : prompt);
      if (ownPerson) { form.set("relight", "frame"); form.set("denoise", String(keepCrop ? denoise : 1)); } else if (picture) form.set("picture", picture);
      if (relight) form.set("light", light);
      const response = await fetch("/api/picture", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "prepare" }; remember(next, "", false); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }
  // The describer watches the part, then rewrites what happens for the prepared picture; H3 gets the result as text.
  async function describe() {
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepared, describe: true, seconds: settings.seconds, describer }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "describe" }; remember(next, prepared, true); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }
  async function render() {
    if (!prepared || !preview || !approved) return;
    setSubmitting(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepared, settings, description }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "render" }; remember(next, prepared, true); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }

  function picker(label: string, value: string, options: string[], onChange: (value: string) => void) {
    return <label><span>{label}</span>{options.length
      ? <select className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{[...new Set([value, ...options])].map((name) => <option key={name} value={name}>{name || t("Choose a file", "选择文件")}</option>)}</select>
      : <input className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
  }
  const canvas = typeof settings.resolution === "string" ? canvasSize(size?.[0] ?? 768, size?.[1] ?? 1376, settings.resolution) : [settings.resolution.width, settings.resolution.height];
  const frames = pictureFrames(settings.seconds);
  const whole = duration <= MAX_SECONDS && start === 0 && settings.seconds >= duration;
  const place = whole ? "Whole" : PLACES.slice(1).find((p) => Math.abs(placeStart(p, duration, settings.seconds) - start) < 0.05);
  const lookExample = LIGHT_LOOKS[look];
  const relightPromptLabel = t("FLUX relight prompt · {look} is the light", "FLUX 布光提示词（{look} 代表灯光设置）");

  return <div className="picture-pipeline">
    <p className="hint">{t("Prepare the character in the video's starting pose with FLUX. Review the image first, then render its motion while keeping the picture's background.", "用 FLUX 生成摆出视频起始姿势的人物。确认预览图后，保留图中的背景并渲染人物动作。")}</p>
    {!approved && <div className="inputs">
      <section className="panel">
        <h2><span>1</span> {t("Character and source video", "人物与源视频")}</h2>
        <label>{t("Source video", "源视频")}<input type="file" accept="video/*,.mkv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { invalidate(); setVideo(file); setStart(0); setDuration(0); } }} /></label>
        {videoUrl && <video ref={player} src={videoUrl} controls preload="metadata"
          onLoadedMetadata={(event) => { const { videoWidth, videoHeight, duration: total } = event.currentTarget; setSize([videoWidth, videoHeight]); setDuration(total); choosePart(start, Math.min(settings.seconds, total, MAX_SECONDS), total); }}
          onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= start + settings.seconds) event.currentTarget.currentTime = start; }} />}
        {duration > MIN_SECTION_SECONDS && <>
          <div className="setting">
            <span>{t("Part to use", "使用片段")} <small>{timecode(start)}–{timecode(start + settings.seconds)}{t(` (${settings.seconds.toFixed(1)} s). Its first frame sets the pose; up to ${MAX_SECONDS} s.`, `（${settings.seconds.toFixed(1)} 秒）。以首帧为姿势参考，最长 ${MAX_SECONDS} 秒。`)}</small></span>
            <div className="segmented">
              {PLACES.filter((p) => p !== "Whole" || duration <= MAX_SECONDS).map((p) => (
                <button key={p} className={p === place ? "on" : ""} disabled={busy} onClick={() => p === "Whole" ? choosePart(0, duration) : choosePart(placeStart(p, duration, settings.seconds), settings.seconds)}>{t(p, placeLabels[p])}</button>
              ))}
            </div>
          </div>
          <label className="setting">
            <span>{t("Length", "时长")} <small>{settings.seconds.toFixed(1)}{t(" s", " 秒")}</small></span>
            <input type="range" min={MIN_SECTION_SECONDS} max={Math.min(duration, MAX_SECONDS)} step={0.5} value={settings.seconds} disabled={busy} onChange={(event) => choosePart(start, Number(event.target.value))} />
          </label>
          <label className="setting">
            <span>{t("Starts at", "起始时间")} <small>{timecode(start)}</small></span>
            <input type="range" min={0} max={duration - settings.seconds} step={0.1} value={start} disabled={busy || whole} onChange={(event) => choosePart(Number(event.target.value), settings.seconds)} />
          </label>
        </>}
        <label className="setting toggle"><span>{t("Relight the video's own person", "为视频中的原人物重新布光")} <small>{t("No new character: only the light changes.", "保留原人物，只调整光线。")}</small></span><input type="checkbox" checked={ownPerson} disabled={busy} onChange={(event) => { invalidate(); setOwnPerson(event.target.checked); if (event.target.checked && look < 0) setLook(0); }} /><i /></label>
        {!ownPerson && <>
          <label>{t("Character picture · image 1", "人物参考图 · 图 1")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { invalidate(); setPicture(file); } }} /></label>
          {pictureUrl && <img className="picture-reference" src={pictureUrl} alt={t("Character and background reference", "人物与背景参考图")} />}
        </>}
        <small>{ownPerson
          ? t("The part's first frame is the picture FLUX relights. Choose the render settings after reviewing the prepared image.", "FLUX 会为片段的首帧重新布光。确认预览图后，再选择渲染设置。")
          : t("The part's first frame is image 2. Choose the render settings after reviewing the prepared image.", "片段的首帧作为图 2。确认预览图后，再选择渲染设置。")}</small>
      </section>
      <section className="panel">
        <h2><span>2</span> {t("Prepare the first frame", "生成首帧预览")}</h2>
        <p className="hint">{ownPerson
          ? t("FLUX relights the frame itself: the same person, pose, framing and setting under a new light.", "FLUX 会调整这一帧的光线，同时保留人物、姿势、构图和场景。")
          : t("Image 1 supplies the character and background. Image 2 supplies the pose and body cut.", "图 1 提供人物和背景，图 2 提供姿势和人物取景范围。")}</p>
        <p className="hint">{t("Missing the FLUX model files? ", "缺少 FLUX 模型文件？")}<a href="https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy" target="_blank" rel="noopener noreferrer">{t("Download FLUX 3 Image Klein files", "下载 FLUX 3 Image Klein 文件")}</a>{t(".", "。")}</p>
        <p className="hint"><strong>{t("Prompt upsampler required.", "需要提示词扩写模型。")}</strong>{t(" This workflow needs the ", "工作流在生成图片前会用 ")}<a href="https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/blob/main/text_encoders/qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors" target="_blank" rel="noopener noreferrer">{t("Qwen3.5 9B FLUX prompt upsampler", "Qwen3.5 9B FLUX 提示词扩写模型")}</a>{t(" to expand the edit prompt before image generation. Download it into ", " 扩写编辑提示词。请将模型下载到 ")}<code>ComfyUI/models/text_encoders</code>{t(".", "。")}</p>
        <label>{t("Relight", "重新布光")}<select className="file-name" value={look} disabled={busy} onChange={(event) => { invalidate(); setLook(Number(event.target.value)); }}>
          {!ownPerson && <option value={-1}>{t("Off · keep the picture's light", "关闭 · 保留图片原有光线")}</option>}
          {LIGHT_LOOKS.map((item, index) => <option key={item.name} value={index}>{t(item.name, lightLookLabels[item.name] ?? item.name)}</option>)}
          <option value={LIGHT_LOOKS.length}>{t("My own light", "自定义灯光")}</option>
        </select></label>
        {lookExample && <figure style={{ margin: 0, display: "grid", gap: 6 }}><img className="picture-reference" src={lookExample.image} alt={t(`${lookExample.name} example`, `${lightLookLabels[lookExample.name] ?? lookExample.name}示例`)} style={{ width: 200 }} /><small>{t("Example on one portrait. Your picture and seed will differ.", "此处以一张人像为例。实际效果因图片和随机种子而异。")}</small></figure>}
        {relight && !ownPerson && <p className="hint">{t("Poses and relights the character in one FLUX pass at 3 MP, about 2 minutes. FLUX sees only image 1; image 2 reaches it as a written pose, so nothing of the video's person leaks in. The light usually changes the background too. Results vary a lot by seed; try two or three.", "FLUX 会在一次生成中调整人物姿势和光线，输出约 300 万像素，用时约 2 分钟。FLUX 直接读取图 1，并使用图 2 的文字姿势描述，避免混入视频原人物的外观。调整光线通常也会影响背景。不同种子的效果可能差异较大，可以试两三个。")}</p>}
        {look === LIGHT_LOOKS.length && <label>{t("Your light", "自定义灯光描述")}<textarea className="report" rows={3} value={ownLight} disabled={busy} onChange={(event) => { invalidate(); setOwnLight(event.target.value); }} /></label>}
        {ownPerson && <label>{t("Framing", "构图")}<select className="file-name" value={keepCrop ? "keep" : "free"} disabled={busy} onChange={(event) => { invalidate(); setKeepCrop(event.target.value === "keep"); }}>
          <option value="free">{t("FLUX may recompose · strongest light, may zoom out", "允许 FLUX 重新构图 · 光效最强，可能拉远镜头")}</option>
          <option value="keep">{t("Keep the frame's crop · starts from the frame", "保留原帧取景 · 以原帧为基础")}</option>
        </select></label>}
        {ownPerson && keepCrop && <label className="setting">
          <span>{t("Denoise", "降噪强度")} <small>{denoise.toFixed(2)}{t(". Lower keeps more of the frame; near 1 FLUX may zoom out again.", "。值越低，保留的原画面越多。接近 1 时，FLUX 可能拉远镜头。")}</small></span>
          <input type="range" min={0.8} max={0.99} step={0.01} value={denoise} disabled={busy} onChange={(event) => { invalidate(); setDenoise(Number(event.target.value)); }} />
        </label>}
        {ownPerson
          ? <label>{relightPromptLabel}<textarea className="report" rows={4} value={framePrompt} disabled={busy} onChange={(event) => { invalidate(); setFramePrompt(event.target.value); }} /></label>
          : relight
          ? <label>{relightPromptLabel}<textarea className="report" rows={6} value={relightPrompt} disabled={busy} onChange={(event) => { invalidate(); setRelightPrompt(event.target.value); }} /></label>
          : <label>{t("FLUX edit prompt", "FLUX 编辑提示词")}<textarea className="report" rows={6} value={prompt} disabled={busy} onChange={(event) => { invalidate(); setPrompt(event.target.value); }} /></label>}
        <label>{t("Seed", "随机种子")}<input className="target-input" type="number" min={0} max={MAX_SEED} step={1} value={seed} disabled={busy} onChange={(event) => { invalidate(); setSeed(Number(event.target.value)); }} /></label>
        <button className="primary" disabled={busy || !ready} onClick={() => prepare(seed)}>{t("Generate preview image", "生成预览图")}</button>
        <p className="hint">{t("This step only generates an image. After reviewing it, choose the video settings and press Render video.", "这一步只生成图片。确认预览图后，选择视频设置，再点击「渲染视频」。")}</p>
      </section>
    </div>}
    {busy && <p role="status">{submitting ? t("Submitting…", "正在提交…") : job?.stage === "prepare" ? t("FLUX is preparing the image…", "FLUX 正在生成预览图…") : job?.stage === "describe" ? t("Describing the video…", "正在生成视频描述…") : t("Generating normals and rendering the video…", "正在生成法线贴图并渲染视频…")}</p>}
    {error && <p className="error" role="alert">{errorText(error)}</p>}
    {preview && !approved && <section className="panel">
      <h2><span>3</span> {t("Review before rendering", "渲染前确认")}</h2>
      <div className="inputs picture-comparison">
        <figure><figcaption>{ownPerson ? t("Source frame", "源视频帧") : t("Source frame · image 2", "源视频帧 · 图 2")}</figcaption><img src={preview.frame} alt={t("Raw source video frame used for pose and body cut", "用作姿势和人物取景参考的源视频帧")} /></figure>
        <figure><figcaption>{t("FLUX prepared image", "FLUX 预览图")}</figcaption><img src={preview.url} alt={t("FLUX generated character in the source pose", "FLUX 生成的人物，姿势来自源视频")} /></figure>
      </div>
      <p className="hint">{t("Check the pose, framing, character and background. The video will use this exact prepared image.", "请检查姿势、构图、人物和背景。生成视频时会直接使用这张图片。")}</p>
      <div className="row">
        <a href={preview.url} download="prepared-frame.png">{t("Download image", "下载图片")}</a>
        <button className="secondary" disabled={busy || !ready} onClick={() => prepare((seed + 1) % (MAX_SEED + 1))}>{t("Generate another image", "再生成一张")}</button>
        <button className="primary" disabled={busy} onClick={() => { setApproved(true); remember(null, prepared, true); if (!description) void describe(); }}>{t("Use this image", "使用这张图片")}</button>
      </div>
    </section>}
    {preview && approved && <section className="panel">
      <h2><span>4</span> {t("Video render settings", "视频渲染设置")}</h2>
      <div className="row"><img className="picture-reference" src={preview.url} alt={t("Approved FLUX image for the video", "已确认用于生成视频的 FLUX 图片")} style={{ width: 120, maxHeight: 180 }} /><button className="secondary" disabled={busy} onClick={() => { setApproved(false); remember(null, prepared, false); }}>{t("Back to image review", "返回图片确认")}</button></div>
      <p className="hint">{t("The approved image is reused without running FLUX again. Native H3 and SolarRenderer render one clip, up to 15 seconds, without a context loop.", "渲染时会直接使用已确认的图片。原生 H3 和 SolarRenderer 均渲染单个片段，最长 15 秒，无需循环处理上下文。")}</p>
      <label>{t("Video description · H3 reads it with the normal-map video", "视频描述 · H3 会同时读取此描述和法线贴图视频")}<textarea className="report" rows={6} value={description} disabled={busy} onChange={(event) => keepDescription(event.target.value)} /></label>
      <small>{t("The visual describer (", "视觉描述模型（")}<code>{describer}</code>{t(") watches the part, two frames a second, and writes its actions, held objects and expressions; with a character picture it then rewrites them for the prepared image. Remove anything about the video person's looks, clothes or setting. Leave it empty to render without it.", "）每秒读取片段中的两帧，描述动作、手持物体和表情。如果提供了人物参考图，模型还会根据预览图改写这些描述。请删去关于视频原人物外貌、服装和场景的描述。留空也可以渲染。")}</small>
      <div className="row"><button className="secondary" disabled={busy} onClick={describe}>{t("Describe again", "重新生成描述")}</button><small>{t("Describe again after changing the video length.", "调整视频时长后，请重新生成描述。")}</small></div>
      {modelError && <p className="error" role="alert">{errorText(modelError)}</p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="inputs">
          <div className="panel">
            <label>{t("Video renderer", "视频渲染器")}<select className="file-name" value={settings.renderer} onChange={(event) => setSettings({ ...settings, renderer: event.target.value as PictureVideoSettings["renderer"], steps: event.target.value === "solar" ? 4 : 6 })}><option value="solar">SolarRenderer</option><option value="h3">{t("H3 · native", "H3 · 原生")}</option></select></label>
            <label>{t("Video length (seconds)", "视频时长（秒）")}<input className="steps-input" type="number" min={(settings.renderer === "solar" ? 22 : 5) / 24} max={duration ? Math.min(MAX_SECONDS, duration - start) : MAX_SECONDS} step={0.1} value={settings.seconds} onChange={(event) => setSettings({ ...settings, seconds: Number(event.target.value) })} /></label>
            <small>{t(`H3 rounds down to a valid clip length: ${frames} frames / ${(frames / 24).toFixed(3)} s at 24 fps.`, `H3 会将时长向下取整到有效帧数。按每秒 24 帧计算，${frames} 帧对应 ${(frames / 24).toFixed(3)} 秒。`)}</small>
            {settings.renderer === "solar" && settings.seconds > 6 && <p className="hint" role="note"><strong>{t("Longer render time:", "渲染耗时可能明显增加。")}</strong>{t(" SolarRenderer clips longer than 6 seconds can take considerably longer to render, especially at higher resolutions.", "使用 SolarRenderer 渲染超过 6 秒的片段时，分辨率越高，耗时增加越明显。")}</p>}
            <label>{t("Video resolution", "视频分辨率")}<select className="file-name" value={typeof settings.resolution === "string" ? settings.resolution : "custom"} onChange={(event) => setSettings({ ...settings, resolution: event.target.value === "custom" ? { width: canvas[0], height: canvas[1] } : event.target.value as PictureVideoSettings["resolution"] })}>{RESOLUTIONS.map((value) => <option key={value}>{value}</option>)}<option value="custom">{t("Custom", "自定义")}</option></select></label>
            {typeof settings.resolution === "object" && <div className="row">{(["width", "height"] as const).map((side) => <label key={side}>{t(`Custom ${side}`, side === "width" ? "自定义宽度" : "自定义高度")}<input className="steps-input" type="number" min={CUSTOM_SIZE.min} max={CUSTOM_SIZE.max} step={CUSTOM_SIZE.step} value={typeof settings.resolution === "object" ? settings.resolution[side] : 0} onChange={(event) => setSettings({ ...settings, resolution: { width: canvas[0], height: canvas[1], [side]: Number(event.target.value) } })} /></label>)}</div>}
            <small>{t(`Video canvas: ${canvas[0]}×${canvas[1]}.`, `视频尺寸为 ${canvas[0]}×${canvas[1]}。`)}</small>
            <label>{t("Motion reference resolution", "动作参考分辨率")}<select className="file-name" value={settings.motion} onChange={(event) => setSettings({ ...settings, motion: Number(event.target.value) as PictureVideoSettings["motion"] })}><option value={0}>{t("Match video", "与视频一致")}</option>{MOTION_SIZES.map((value) => <option key={value} value={value}>{value}{t(" px", " 像素")}</option>)}</select></label>
            <small>{t("The motion/mask resolution control uses a normal-map guide here. Its size is separate from the output video.", "此处的动作或遮罩分辨率用于法线贴图参考，独立于输出视频的分辨率。")}</small>
            <label>{t("Video seed", "视频随机种子")}<input className="steps-input" type="number" min={0} max={MAX_SEED} step={1} value={settings.seed} onChange={(event) => setSettings({ ...settings, seed: Number(event.target.value) })} /></label>
            <label>{t("Steps", "采样步数")}<input className="steps-input" type="number" min={STEPS.min} max={settings.renderer === "solar" ? 50 : STEPS.max} value={settings.steps} onChange={(event) => setSettings({ ...settings, steps: Number(event.target.value) })} /></label>
            <small>{settings.renderer === "solar"
              ? t("Use 4 with the SolarRenderer four-step and control LoRAs.", "搭配 SolarRenderer 四步 LoRA 和控制 LoRA 时，请设为 4 步。")
              : t("Use 6 with DMAD; without a speed LoRA, use 20 or more.", "使用 DMAD 时请设为 6 步。未使用加速 LoRA 时，请设为 20 步或更多。")}</small>
          </div>
          <div className="panel">
            <p className="hint">{t("Choose models and VAEs compatible with MiniMax H3.", "请选择与 MiniMax H3 兼容的模型和 VAE。")}</p>
            {picker(t("Base model", "基础模型"), settings.model, files.models, (model) => setSettings({ ...settings, model }))}
            {picker(t("H3 text encoder", "H3 文本编码器"), settings.textEncoder, files.textEncoders, (textEncoder) => setSettings({ ...settings, textEncoder }))}
            {picker(t("Video VAE", "视频 VAE"), settings.videoVae, files.vaes, (videoVae) => setSettings({ ...settings, videoVae }))}
            {settings.renderer === "h3" && picker(t("Audio VAE", "音频 VAE"), settings.audioVae, files.vaes, (audioVae) => setSettings({ ...settings, audioVae }))}
            {settings.renderer === "solar" ? <>
              <label>{t("SolarRenderer LoRA rank", "SolarRenderer LoRA 的秩")}<select className="file-name" value={settings.solarRank} onChange={(event) => { const solarRank = Number(event.target.value) as 384 | 64; setSettings({ ...settings, solarRank, ...solarLoraFiles(solarRank, files.loras) }); }}><option value={384}>{t("Rank 384 · original", "秩 384 · 原版")}</option><option value={64}>{t("Rank 64 · compressed", "秩 64 · 压缩版")}</option></select></label>
              {picker(t("SolarRenderer four-step LoRA", "SolarRenderer 四步 LoRA"), settings.solarFourStep, files.loras, (solarFourStep) => setSettings({ ...settings, solarFourStep }))}
              {picker(t("SolarRenderer control LoRA", "SolarRenderer 控制 LoRA"), settings.solarControl, files.loras, (solarControl) => setSettings({ ...settings, solarControl }))}
              <p className="hint">{t("Both LoRAs are required and run at strength 1. Select their paths inside ", "两个 LoRA 都需要使用，强度均为 1。请在 ")}<code>ComfyUI/models/loras</code>{t("; subfolders such as ", " 中选择对应的文件，也支持 ")}<code>solar/</code>{t(" are supported.", " 等子目录。")}</p>
              <p className="hint">{t("Rank 384: from ", "要使用秩 384 的版本，请从 ")}<a href="https://huggingface.co/Enderfga/SolarRenderer" target="_blank" rel="noopener noreferrer">SolarRenderer</a>{t(", download ", " 下载 ")}<a href="https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_4step_lora.safetensors" target="_blank" rel="noopener noreferrer">solarrenderer_4step_lora.safetensors</a>{t(" and ", " 和 ")}<a href="https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_control_lora.safetensors" target="_blank" rel="noopener noreferrer">solarrenderer_control_lora.safetensors</a>{t(".", "。")}</p>
              <p className="hint">{t("For rank 64, download the four-step and control files from ", "要使用秩 64 的版本，请从 ")}<a href="https://huggingface.co/mdevoz/SolarRendererRank64" target="_blank" rel="noopener noreferrer">SolarRendererRank64</a>{t(", then select them above.", " 下载四步和控制 LoRA 文件，然后在上方选择。")}</p>
              <p className="hint">{t("Requires the ", "需要安装 ")}<a href="https://github.com/Enderfga/SolarRenderer/tree/main/comfyui" target="_blank" rel="noopener noreferrer">{t("SolarRenderer custom nodes", "SolarRenderer 自定义节点")}</a>{t(". Restart ComfyUI after installing them, and reload this page after adding LoRA files.", "。安装后请重启 ComfyUI，添加 LoRA 文件后请刷新此页面。")}</p>
            </> : <>
            <label className="setting toggle"><span>{t("Use LoRAs", "启用 LoRA")}</span><input type="checkbox" checked={settings.useLoras} onChange={(event) => setSettings({ ...settings, useLoras: event.target.checked })} /><i /></label>
            {settings.useLoras && <>{settings.loras.map((lora, index) => <div className="panel" key={index}>
              {picker(`LoRA ${index + 1}`, lora.name, files.loras, (name) => setSettings({ ...settings, loras: settings.loras.map((item, i) => i === index ? { ...item, name } : item) }))}
              <label>{t(`LoRA ${index + 1} strength`, `LoRA ${index + 1} 强度`)}<input className="steps-input" type="number" min={STRENGTH.min} max={STRENGTH.max} step={0.05} value={lora.strength} onChange={(event) => setSettings({ ...settings, loras: settings.loras.map((item, i) => i === index ? { ...item, strength: Number(event.target.value) } : item) })} /></label>
              <label className="setting toggle"><span>{t(`Use LoRA ${index + 1}`, `启用 LoRA ${index + 1}`)}</span><input type="checkbox" checked={lora.enabled} onChange={(event) => setSettings({ ...settings, loras: settings.loras.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item) })} /><i /></label>
              <button className="secondary" onClick={() => setSettings({ ...settings, loras: settings.loras.filter((_, i) => i !== index) })}>{t(`Remove LoRA ${index + 1}`, `移除 LoRA ${index + 1}`)}</button>
            </div>)}<button className="secondary" disabled={settings.loras.length >= MAX_LORAS} onClick={() => setSettings({ ...settings, loras: [...settings.loras, { name: files.loras[0] ?? "", strength: 1, enabled: true }] })}>{t("Add LoRA", "添加 LoRA")}</button></>}
            </>}
          </div>
        </div>
      </fieldset>
      <button className="primary" disabled={busy} onClick={render}>{t("Render video", "渲染视频")}</button>
    </section>}
    {result && <section className="panel"><h2>{t("Video result", "生成结果")}</h2><video src={result} controls /><a href={result} download="picture-motion.mp4">{t("Download video", "下载视频")}</a></section>}
  </div>;
}
