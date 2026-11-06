"use client";

import { DEFAULT_DESCRIBER } from "../lib/model.ts";
import { useErrorText, useT } from "../lib/locale-provider.tsx";

const SUGGESTIONS = [
  { name: "qwen3vl_8b_int8_convrot.safetensors", label: "Qwen3-VL 8B · INT8", size: "9.35 GB", note: "Openjutsu default", zhNote: "Openjutsu 默认模型", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors" },
  { name: "qwen3vl_4b_fp8_scaled.safetensors", label: "Qwen3-VL 4B · FP8", size: "5.24 GB", note: "Smaller Qwen alternative", zhNote: "更小的 Qwen 模型", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors" },
  { name: "gemma4_e2b_it_int8_convrot.safetensors", label: "Gemma 4 E2B · INT8", size: "5.2 GB", note: "Smaller vision alternative", zhNote: "更小的视觉模型", url: "https://huggingface.co/Comfy-Org/gemma-4/blob/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors" },
];

export function Welcome({ value, options, onChange, loading, error, onRefresh, onContinue }: {
  value: string; options: string[]; onChange: (value: string) => void; loading: boolean; error: string;
  onRefresh: () => void; onContinue: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const installed = !error && options.includes(value);
  const suggested = SUGGESTIONS.filter((model) => options.includes(model.name));
  const other = options.filter((name) => !SUGGESTIONS.some((model) => model.name === name));

  return <main className="shell welcome">
    <header className="top"><div className="brand">
      <span className="mark" aria-hidden>忍</span>
      <div><h1>Openjutsu</h1><p>{t("Open weights. Your video. Your GPU.", "用开放权重模型，在自己的显卡上编辑视频。")}</p></div>
    </div></header>

    <section className="welcome-intro">
      <p className="eyebrow">{t("BEFORE YOUR FIRST SWAP", "开始编辑前")}</p>
      <h2>{t("Welcome to Openjutsu.", "欢迎使用 Openjutsu")}</h2>
      <p>{t("Give your video a new cast, change an object or rebuild the scene. Start by choosing the model that helps Openjutsu understand what it sees.", "替换视频中的人物或物体，或者重建整个场景。先为 Openjutsu 选择一个能理解画面的模型。")}</p>
      <ol className="welcome-flow">
        <li><strong>{t("See & describe", "理解并描述画面")}</strong><span>{t("A vision-language model reads your photos and video frames, identifies people and writes prompts.", "视觉语言模型会读取照片和视频帧，识别人物并编写提示词。")}</span></li>
        <li><strong>{t("Track the edit", "跟踪编辑目标")}</strong><span>{t("SAM follows the people or things you want to change.", "SAM 会跟踪你要编辑的人物或物体。")}</span></li>
        <li><strong>{t("Make the video", "生成视频")}</strong><span>{t("MiniMax H3 uses those prompts and references to generate the result.", "MiniMax H3 根据提示词和参考素材生成视频。")}</span></li>
      </ol>
    </section>

    <section className="panel welcome-picker" aria-labelledby="describer-heading">
      <div><p className="eyebrow">{t("01 / CHOOSE YOUR VISUAL DESCRIBER", "01 / 选择视觉描述模型")}</p>
        <h2 id="describer-heading">{t("A model that can see and write.", "能看懂画面并生成文字的模型")}</h2>
        <p className="hint">{t("Use a vision-language model (VLM) with image understanding and text generation. This choice also applies to Find people.", "请选择支持图像理解和文本生成的视觉语言模型（VLM）。「查找人物」也会使用该模型。")}</p>
      </div>
      <label htmlFor="describer">{t("Visual describer", "视觉描述模型")}</label>
      <select id="describer" className="file-name" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading} aria-describedby="describer-help">
        {!options.includes(value) && <option value={value}>{value}{loading ? t(" — checking…", "（正在检查…）") : t(" — not installed", "（未安装）")}</option>}
        {suggested.length > 0 && <optgroup label={t("Suggested models installed in ComfyUI", "ComfyUI 中已安装的推荐模型")}>
          {suggested.map((model) => <option key={model.name} value={model.name}>{model.label}{model.name === DEFAULT_DESCRIBER ? t(" (default)", "（默认）") : ""}</option>)}
        </optgroup>}
        {other.length > 0 && <optgroup label={t("Other installed models — check vision support", "其他已安装模型（请确认支持视觉输入）")}>
          {other.map((name) => <option key={name} value={name}>{name}</option>)}
        </optgroup>}
      </select>
      <p id="describer-help" className="hint">{t("Other models must work with ComfyUI’s CLIPLoader and Generate Text nodes, including image and video-frame input. A file appearing here confirms it is installed; it does not confirm vision support. Text-only models and GGUF files needing a different loader cannot be used here.", "其他模型必须兼容 ComfyUI 的 CLIPLoader 和 Generate Text 节点，并支持图像和视频帧输入。出现在列表中的模型均已安装，仍需确认其是否支持视觉输入。此处无法使用纯文本模型或需要其他加载器的 GGUF 文件。")}</p>
      <p className="hint">{t("The separate MiniMax H3 text encoder stays in Model components. Choose a full vision-language model here, rather than an H3-specific encoder.", "请在这里选择完整的视觉语言模型。MiniMax H3 专用的文本编码器在「模型组件」中单独设置。")}</p>

      <div className="welcome-install">
        <strong>{t("Put the model in this folder first", "先将模型放入以下目录")}</strong>
        <code>ComfyUI\models\text_encoders</code>
        <p className="hint">{t("Use your ComfyUI installation folder. Add a compatible single-file model with its vision weights, then refresh the list. If it still does not appear, restart ComfyUI and refresh again.", "请使用你的 ComfyUI 安装目录。放入包含视觉权重的兼容单文件模型，然后刷新列表。如果列表中仍没有该模型，请重启 ComfyUI 后再刷新。")}</p>
        <div className="row"><span className="hint" role="status">{loading ? t("Reading installed models…", "正在读取已安装的模型…") : error ? t("ComfyUI model list unavailable", "无法读取 ComfyUI 模型列表") : installed ? t("Selected file is installed", "所选文件已安装") : t("Selected file is not installed", "所选文件未安装")}</span>
          <button className="secondary" disabled={loading} onClick={onRefresh}>{loading ? t("Refreshing…", "正在刷新…") : t("Refresh models", "刷新模型列表")}</button></div>
        {error && <p className="error" role="alert">{errorText(error)}</p>}
      </div>
    </section>

    <section className="panel welcome-memory" aria-labelledby="vram-heading">
      <div><p className="eyebrow">{t("02 / LEAVE ROOM FOR THE WORK", "02 / 为视频生成预留显存")}</p><h2 id="vram-heading">{t("Choose for your available VRAM.", "根据可用显存选择模型")}</h2></div>
      <p className="hint">{t("For limited VRAM, start with a smaller quantized model such as Qwen3-VL 4B FP8 or Gemma 4 E2B INT8. With more headroom, keep the Qwen3-VL 8B INT8 default. Higher precision usually needs more memory.", "显存有限时，可先使用较小的量化模型，例如 Qwen3-VL 4B FP8 或 Gemma 4 E2B INT8。显存充足时，可以使用默认的 Qwen3-VL 8B INT8。更高的精度通常需要更多显存。")}</p>
      <div className="welcome-table"><table>
        <caption>{t("Examples available as ComfyUI model files", "可在 ComfyUI 中使用的模型示例")}</caption>
        <thead><tr><th scope="col">{t("Model", "模型")}</th><th scope="col">{t("File size", "文件大小")}</th><th scope="col">{t("Use", "说明")}</th></tr></thead>
        <tbody>{SUGGESTIONS.map((model) => <tr key={model.name}>
          <th scope="row"><a href={model.url} target="_blank" rel="noreferrer">{model.label}</a></th>
          <td>{model.size}</td><td>{t(model.note, model.zhNote)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="hint">{t("File size is a rough guide to weight storage, not a VRAM requirement. Images, video frames, context and working memory need extra space. ComfyUI may offload to system RAM, which can be slower. H3 video generation has its own, larger memory needs; this choice alone does not guarantee a full swap will fit.", "文件大小仅供估算模型权重占用的存储空间。实际运行时，图像、视频帧、上下文和中间计算还需要额外空间。ComfyUI 可能会将部分数据转移到系统内存，运行速度可能因此下降。H3 生成视频需要更多显存，完整的替换流程能否运行还取决于视频生成阶段的显存占用。")}</p>
      <p className="hint">{t("Gemma needs a version with vision support. Alternative models can change prompt quality and how reliably people are matched; Openjutsu’s workflows default to Qwen3-VL 8B.", "请使用支持视觉输入的 Gemma 版本。更换模型可能影响提示词质量和人物匹配的准确性。Openjutsu 工作流默认使用 Qwen3-VL 8B。")}</p>
    </section>

    <footer className="welcome-actions">
      <div><strong>{t("Your choice stays in this browser.", "你的选择将保存在当前浏览器中。")}</strong><p className="hint">{t("Reopen Welcome & models any time to change it.", "你可以随时打开「欢迎与模型」来修改此设置。")}</p></div>
      <div className="row"><button className="secondary" onClick={onContinue}>{t("Set up later", "稍后设置")}</button>
        <button className="primary" disabled={loading || !installed} onClick={onContinue}>{t("Continue to Openjutsu →", "进入 Openjutsu →")}</button></div>
    </footer>
  </main>;
}
