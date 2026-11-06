# 从图片生成视频的工作流

[English](README.md) · 简体中文 · [项目说明](../../README.zh-CN.md)

本目录中的 JSON 是 ComfyUI API 格式工作流。可将文件拖入 ComfyUI，或通过 **文件 → 打开** 导入。

在 Openjutsu 中打开 **物体替换 → 按图替换**，选择源视频和角色图，生成预览。对照视频原始帧检查 FLUX 预览，可修改提示词再生成。确认后选择使用此图片，设置视频时长、输出分辨率、动作参考分辨率、模型、LoRA、采样步数和随机种子，然后渲染视频。预览与渲染分开提交，渲染读取保存的预览图。两个阶段都通过 `COMFYUI_URL` 直连 ComfyUI。返回此页签或刷新页面后，可以继续查看进行中的任务和已选预览。

| 工作流 | 用途 |
| --- | --- |
| `from_picture_prepare_flux3.api.json` | 用 FLUX 3 制作并保存首帧图。 |
| `from_picture_motion_flux3.api.json` | 用 FLUX 制作首帧图，再生成 Metric3D 法线图并渲染 H3 视频。 |
| `from_picture_solar_flux3.api.json` | 用 FLUX 制作首帧图，再通过 Metric3D 法线图以及 SolarRenderer 的四步、控制 LoRA 渲染视频。 |
| `from_picture_describe_flux3.api.json` | 由视觉描述模型描述源片段发生的事，再根据首帧图改写。 |

## 视频描述

法线图引导人物动作，但其中的手持物只有形状，脸部表情也会丢失。确认使用预览图时，视觉描述模型（默认 Qwen3-VL 8B）先以每秒两帧查看源片段，描述动作、手持物、嘴部动作、表情、视线、其他人物和运镜，略去原人物的外观及光线。随后它根据预览图的人物和场景改写描述，保留动作和手持物，去掉新角色无法做出的发型或衣物相关动作，并用行为指代其他人物。直接给视频原人物打光时，使用第一轮描述。

渲染前可以编辑这段文字，它将放在提示词的 `detailed_description` 开头。可删去原角色的外貌或原场景残留，也可以清空描述。调整视频时长后应重新生成描述。原项目在 RTX 4060 Ti 16 GB 上测得，模型已加载时两轮约需 15 秒，包含加载时约需 40 秒。

## SolarRenderer

应用默认选择 **SolarRenderer**、四步采样和 rank-384 LoRA。安装 [SolarRenderer 官方自定义节点](https://github.com/Enderfga/SolarRenderer/tree/main/comfyui)，然后重启 ComfyUI。节点使用现有的 ComfyUI Python 环境。

从 [Enderfga/SolarRenderer](https://huggingface.co/Enderfga/SolarRenderer) 下载 [solarrenderer_4step_lora.safetensors](https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_4step_lora.safetensors) 和 [solarrenderer_control_lora.safetensors](https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_control_lora.safetensors)。也可以从 [mdevoz/SolarRendererRank64](https://huggingface.co/mdevoz/SolarRendererRank64) 下载对应的 rank-64 四步和控制文件。

将同一组文件放到 `ComfyUI/models/loras` 或子目录（如 `ComfyUI/models/loras/solar`）。刷新应用，选择 SolarRenderer LoRA 的秩，并核对四步 LoRA 和控制 LoRA 文件。选择器显示相对路径，也支持手动选用改过名的文件，设置会保留。直接将工作流导入 ComfyUI 时，两个加载节点默认使用根目录文件名，文件放在子目录时需要重新选择。

工作流依次应用四步 LoRA 和控制 LoRA，默认强度均为 1。采样使用逐帧对齐的法线图、静音条件、SolarRenderer 的四步调度和 LCM。成片使用原始音轨。SolarRenderer 无需音频 VAE，且至少需要 22 帧。SolarRenderer 和原生 H3 均可选最长 15 秒的单段渲染，无需上下文循环。超过 6 秒时，尤其在高分辨率下，SolarRenderer 的渲染时间可能明显增加。之前已保存的 H3 设置仍使用 H3。

两组 LoRA 都在 RTX 4060 Ti 16 GB 上完成过 141 帧、768×1376 的测试。该测试中，rank-64 文件更小，采样时间和峰值显存基本相同。

如果节点报告 `the held silence covers 170 frames`，请为官方 SolarRenderer 节点应用[长片段静音补丁](../../patches/solarrenderer-long-clips.patch)，再重启 ComfyUI。

```sh
git -C /path/to/ComfyUI/custom_nodes/SolarRenderer apply /path/to/openjutsu/patches/solarrenderer-long-clips.patch
```

补丁保留静音模板的首尾，并通过重复稳定的中段来延长静音。升级节点后请核对该修复是否已包含在新版本中。原项目用该补丁完成了 rank-64、768×1376 的 9 秒单段测试，帧数对齐后为 209 帧、8.708 秒，总耗时 34 分 23 秒，实测总峰值显存 15,898 MiB。更长片段仍取决于硬件。

## 在 ComfyUI 中准备首帧与重新打光

先使用 prepare 工作流。通过 **Source video** 选择源视频和 `skip_first_frames`，在 **Image 1 / character and background** 选择原始角色图片。选中片段的第一个原始帧作为图 2，直接提供姿势参考。图 1 提供角色和背景。

默认的编辑提示词可以调整。

```text
change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.
```

视觉提示词扩写模型将两张参考图和编辑要求转为更具体的编辑指令，使用性别中立的措辞。两张图片也按顺序传给 FLUX。默认画布为 768×1376，图片保存在 `ComfyUI/output/openjutsu_picture/flux3/prepared_frame_*.png`。渲染视频前可对照原始帧检查姿势与取景。

**重新打光（Relight）**默认关闭。启用后可选择 17 种光效或编写自己的描述，同一次 FLUX 处理完成姿势调整与打光。FLUX 直接收到缩放到 300 万像素的图 1，图 2 的姿势则由扩写模型转成文字，输出画布沿用图 2 的形状。光效常会改变背景，换随机种子也可能改变结果。预览保存为 `relit_frame_*.png`。

**给视频原人物打光（Relight the video's own person）**只使用源视频原始帧，保留人物、姿势和场景。默认允许 FLUX 重新构图，光效更强，也可能拉远画面。选择保留原画面裁剪范围时，从原始帧以 0.9 去噪强度开始采样，可能留下一些原始画面的痕迹。预览保存为 `relit_video_frame_*`。

## 视频渲染与模型

motion 和 solar 工作流直接将生成的预览图用于 H3 渲染。默认输出为 480×864、24 fps、141 帧，即 5.875 秒。SolarRenderer 默认四步，H3/DMAD 默认六步。源视频有音轨时会保留，否则输出静音。时长向下对齐到 `17k+5` 帧，例如 6 秒变为 141 帧（5.875 秒），15 秒变为 345 帧（14.375 秒）。设置里显示实际渲染时长。手动改工作流时，应同时调整视频加载的 `frame_load_cap` 和 H3 的 `length`。

应用可在渲染前调整模型、LoRA 开关及强度、H3 文本编码器、VAE、步数和随机种子，刷新页面后保留这些设置。默认法线图匹配输出画布，动作参考也可单独设为 512、768 或 1376 px，并按 32 像素对齐。原生 H3 可能限制较大参考图的尺寸。手动改画布时，应同时修改 **Normals match the output canvas** 和 **Prepared picture + normal motion reference**。法线图通过参考视频引导动作，图像编辑后先运行显存清理，再加载 Metric3D。

- FLUX 模型使用 `flux3_image_klein_sd_int8_convrot.safetensors`、`qwen3vl_4b_fp8_scaled.safetensors`、`flux2-vae.safetensors` 和 `qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors`。
- 两种渲染方式都需要 H3 pruned INT8 ref2va 模型、H3 文本编码器和视频 VAE。SolarRenderer 使用四步和控制 LoRA，原生 H3 使用 DMAD LoRA 和音频 VAE。文件名见[项目模型表](../../README.zh-CN.md#模型)。
- 自定义节点包括 VideoHelperSuite、用于清理显存的 KJNodes、提供 Metric3D 的 `comfyui_controlnet_aux`，以及负责处理无音轨视频的 `comfyui-h3-oneclick-swap`。motion 和 solar 工作流还需要 Metric3D-small 权重。
- H3 渲染使用 Comfy Kitchen INT8 attention，与其他视频页签一致。

在项目根目录运行以下命令可重新生成工作流文件。

```powershell
python workflows/build/openjutsu_picture_pipeline.py --video "video.mp4" --picture "character.png"
```

参数中的文件名相对于 ComfyUI 的 `input` 目录。已提交的工作流使用原项目测试视频和咖啡馆角色图，导入后改选自己的文件。
