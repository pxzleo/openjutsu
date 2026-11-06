# Openjutsu

[English](README.md) · 简体中文

Openjutsu 是一款开源的本地视频编辑工具。上传视频和一张角色照片，就能替换视频中的主要人物，也可以更换发型和服装、移除或添加物体、替换背景。工作流保留原视频的运镜、剪辑、动作和音轨。MiniMax H3 负责生成视频，SAM 3.1 负责追踪，视觉描述模型负责理解画面和编写提示词。应用由 Next.js 前端和 ComfyUI 工作流组成。

界面根据浏览器的语言偏好自动选择简体中文或英文，默认使用英文。

https://github.com/user-attachments/assets/2d8d763a-1764-49a6-9116-d6d1be661ff6

| 高级动作迁移 | 物体替换 |
| --- | --- |
| ![用各自的参考照片替换两个人物](docs/media/advanced_swap.jpg) | ![在指定区域生成太阳镜](docs/media/object_swap.jpg) |
| **从图片生成视频** | **后期人脸修复** |
| ![根据视频和图片制作预览，再渲染视频](docs/media/from_picture.jpg) | ![将远景人脸放大后重绘](docs/media/fix_faces.jpg) |

![用同一次图像编辑给角色调整姿势和灯光](docs/media/relight.jpg)

## 编辑模式

- **基础动作迁移**用一张参考照片替换画面中占比最大的匹配对象。默认追踪 `person`，也可以输入 `cat` 或 `black and white cat`。运行 `workflows/simple.api.json`。
- **高级动作迁移**可上传 1 至 4 张角色照片，逐镜头将追踪到的人物匹配给角色。未匹配到角色的人物保留原样。两名角色可以选用逐人渲染，每人单独运行一次 H3，耗时约为普通方式的两倍。运行 `workflows/advanced.api.json` 或 `workflows/advanced_maxq.api.json`。
- **物体替换**可更改、移除或添加物体，也可以保留人物并替换背景。更改和移除使用 SAM 追踪，可以输入 `hair, top` 一次处理多个目标。添加物体时，输入描述（如 `a chocolate cake on a plate`）和位置（如 `on the table`），框住物体及其阴影的位置。可上传外观参考图，并在多个时间点设置定位关键帧来跟随运镜。运行 `workflows/object.api.json`。
- **按图替换**在物体替换中使用。FLUX 根据原视频首帧调整参考角色的姿势和取景，同时保留参考图中的场景。先生成并检查预览，再确认图片、编辑视频描述并渲染。可选择 SolarRenderer 或原生 H3，单段最长可选 15 秒，实际时长向下对齐 H3 帧数要求。可选的重新打光提供 17 种光效和自定义提示，也可直接给视频原人物打光。模型、LoRA 和长片段补丁见[从图片生成视频工作流](workflows/picture/README.zh-CN.md)。
- **后期处理**支持人脸修复、换脸与色彩修正。人脸修复使用同一角色的参考照片重绘小脸，色彩修正可柔化细节反差并应用色调映射。人脸和色彩分别运行 `workflows/face.api.json` 与 `workflows/color.api.json`。

## 首次访问与视觉描述模型

欢迎页可选择理解图片和视频帧、生成提示词的视觉描述模型。默认用 Qwen3-VL 8B INT8，也可选择占用较小的 Qwen3-VL 4B FP8 或 Gemma 4 E2B INT8。将包含视觉权重的单文件模型放入 `ComfyUI/models/text_encoders`，然后在欢迎页刷新模型列表。其他模型须能通过 ComfyUI 的 CLIPLoader 和 Generate Text 节点接收图片或视频并生成文字。

文件大小只是下载体积。显存还要容纳图像、视频上下文和模型工作区，H3 生成也有独立的内存需求。所选模型保存在浏览器中，用于替换、视频描述和查找人物，可在欢迎页或模型组件设置里修改。你也可以先进入编辑器，提交任务时会检查所需模型。H3 文本编码器另行配置。

## 安装要求

- NVIDIA GPU。原项目在 RTX 4060 Ti 16 GB、64 GB 系统内存上验证过，H3 INT8 会从系统内存流式加载。
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 0.41.2 或更新版本，提供 MiniMax H3、SAM 3.1 和 TextGenerate。
- Node.js 22.6 或更新版本，另需 Python 运行 `comfy-api-proxy`。

### 自定义节点

将用到的节点包装入 `ComfyUI/custom_nodes`，安装依赖后重启 ComfyUI。ComfyUI Manager 可按名称找到表格中的前三项。各模式需要的节点包和排查步骤见[自定义节点安装说明（英文）](CUSTOM_NODES_REPORT.md)。

| 节点包 | 用途 |
| --- | --- |
| [SolarRenderer](https://github.com/Enderfga/SolarRenderer/tree/main/comfyui) | 从图片生成视频的 LoRA 加载、条件设置和四步采样 |
| [ComfyUI-MiniMaxH3-Context-Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop) 0.7.3+ | 片段循环、断点保存和视频拼接 |
| [ComfyUI-Fantastic-MiniMaxH3-PromptBuilder](https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder) | 带遮罩的视频编辑潜空间 |
| [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | 遮罩扩展和模糊、显存清理 |
| [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) | 生成 Metric3D 法线图 |
| [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | 视频加载 |
| [comfyui-h3-oneclick-swap](https://github.com/D3voz/comfyui-h3-oneclick-swap) | 替换计划、人物与角色遮罩、灰色人形参考、镜头切分、追踪标注和人脸修复分段 |
| [ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) | 追踪和裁剪人脸、生成遮罩、贴回原画面 |
| [ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack) | 加载人脸修复所需的 SAM 模型 |
| [comfyui-image-detail-contrast](https://github.com/D3voz/comfyui-image-detail-contrast) | 调整细节反差 |
| [Orion4D_FXMax](https://github.com/orion4d/Orion4D_FXMax) | DCTL 色调映射及预设 |
| [comfyui-websocket-reconnect-fix](https://github.com/D3voz/comfyui-websocket-reconnect-fix) | 代理重连后恢复实时进度 |

上传任务前，Openjutsu 会对照 ComfyUI 已注册节点和模型文件列表检查启用的工作流步骤。缺少节点时会给出安装链接，缺少模型时会显示存放目录。Python 依赖、模型完整性和剩余显存需要另外检查。

### 模型

| `ComfyUI/models` 下的目录 | 文件 |
| --- | --- |
| `diffusion_models` | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| `loras` | `minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors` |
| `text_encoders` | `qwen3vl_32b_minimax_h3_int4_convrot.safetensors`（H3 文本编码器） |
| `text_encoders` | `qwen3vl_8b_int8_convrot.safetensors`（默认视觉描述模型） |
| `vae` | `minimax_h3_video_vae_int8_convrot.safetensors`、`minimax_h3_audio_vae_fp32.safetensors` |
| `checkpoints` | `sam3.1_multiplex_fp16.safetensors` |
| `ultralytics/bbox`、`ultralytics/segm` | 分别为 `face_yolov8m.pt`、`person_yolov8m-seg.pt`，用于人脸处理。[Bingsu/adetailer](https://huggingface.co/Bingsu/adetailer) |
| `sams` | `sam_vit_b_01ec64.pth`，用于人脸处理 |
| `insightface/models` | `buffalo_l`，用于人脸处理，InsightFace 首次运行时会下载 |

按图替换使用 SolarRenderer 时，将 rank-384 的 [四步 LoRA](https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_4step_lora.safetensors) 和 [控制 LoRA](https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_control_lora.safetensors)，或 [rank-64 的配套 LoRA](https://huggingface.co/mdevoz/SolarRendererRank64)，一起放入 `ComfyUI/models/loras` 或其子目录。刷新页面后在渲染设置中选择。完整模型和节点要求见[从图片生成视频工作流](workflows/picture/README.zh-CN.md)。

## 本地启动

Windows 用户可以双击 `start_openjutsu.bat`。脚本等待 ComfyUI 启动，首次运行会安装应用依赖并在 `.venv-proxy` 中安装 `comfy-api-proxy` 0.1.6。每次运行都会修补代理的实时进度、构建应用，然后打开代理和应用两个窗口，并在浏览器中打开页面。关闭这两个窗口即可停止 Openjutsu。

手动启动时，先获取仓库并进入项目根目录，将 `.env.example` 复制为 `.env.local`。然后按以下步骤启动。

1. 启动 ComfyUI，默认地址是 `127.0.0.1:8188`。在 Windows 上先设置 `AIOHTTP_NOSENDFILE=1`，防止拖动视频进度条后的分段请求卡住 ComfyUI 的 `/view` 下载接口。PowerShell 命令如下。

   ```powershell
   $env:AIOHTTP_NOSENDFILE = "1"
   ```

2. 在同一个 Python 环境中安装、修补并启动代理。代理在 `127.0.0.1:8189` 提供 Comfy API v2。默认上传上限为 100 MB，下例将其设为 500 MB。

   ```sh
   python -m pip install comfy-api-proxy==0.1.6
   python patch_proxy.py
   comfy-api-proxy run --max-upload-mb 500
   ```

3. 在另一个终端中安装并启动应用。开发时可用 `npm run dev`。

   ```sh
   npm ci
   npm run build
   npm start
   ```

4. 打开 <http://127.0.0.1:3000>。

### 环境变量

| 变量 | 本地配置 |
| --- | --- |
| `COMFY_BASE_URL` | 代理地址，默认 `http://127.0.0.1:8189`。 |
| `COMFY_API_KEY` | 使用本地代理时留空。云部署时使用所属工作区的密钥，仅保存在服务端。 |
| `COMFYUI_URL` | ComfyUI 的直连地址，留空时用 `http://127.0.0.1:8188`。节点、模型、预设列表和按图替换通过此地址访问 ComfyUI。 |
| `NEXT_PUBLIC_OPENJUTSU_DESCRIBER` | 可选，填写已安装的备用视觉描述模型文件名。 |
| `NEXT_PUBLIC_OPENJUTSU_H3_ENCODER` | 可选，填写已安装的备用 H3 文本编码器文件名。 |
| `OPENJUTSU_PASSWORD` | 默认仅允许本机访问。对外部署或通过隧道访问时，设置至少 12 个字符的密码并使用 HTTPS。 |

修改两个 `NEXT_PUBLIC_` 模型变量后需重新构建。预设文件缺失且备用文件可用时，界面会选择已配置的文件。SolarRenderer 的 rank-384 文件不齐全时，也会切换到已安装的完整 rank-64 配套文件。

应用每次上传最多接收 512 MB（包括参考图片），还受代理的上传上限约束。每个应用进程可同时处理 3 次任务上传，超过后需稍等重试。任务结束后会清理代理上的上传文件，ComfyUI 的 `input/` 中仍保留文件。视频生成在 ComfyUI 内运行，关闭网页后可继续。

## 使用说明

### 动作迁移与物体替换

- 在源视频下选择整段，或选定时长并把片段放到开头、中间、结尾，再微调起始时间。预览、遮罩和音轨都使用同一片段，缩短片段通常可减少渲染时间。
- 基础模式可先检查遮罩。青色为 H3 重绘区域，橙色为追踪到的人物，右侧灰色人形用于引导动作。人物被截断或背景改变太多时，可调整遮罩边距并重新检查。帽子修复把帽子也纳入遮罩。
- 角色名称优先用 `the singer` 一类角色称呼。服装文字写进 H3 提示词可能影响生成服装。高级模式可写成 `the drummer - man in a cap`，分隔符后的外观只用于匹配人物。留空可由视觉描述模型生成称呼。
- 高级模式的蒙太奇适用于人物轮流出现、却没有硬切的片段。可先查找人物，再逐个检查每次出场对应的照片。出场少于 12 帧或画面占比小于 2% 的人物片段会保留原样，并列在结果页。重启 ComfyUI 或更改视频、片段或尺寸后，需重新查找人物。
- 背景音乐里有人声、画面人物没有跟唱时，可关闭口型同步。H3 会以静音进行生成，成片仍保留原音轨。生成的表情和嘴形仍可能有差异。
- 镜面、窗户等反射中的人物可能保留原样，H3 也可能从反射中复制原发型、服装和体型。
- 物体替换的更换模式可在追踪对象周围额外涂绘编辑区域。涂绘会随 SAM 追踪框的位置和尺寸变化，并与原遮罩合并。新增物体使用手动画框和关键帧。更换源视频、片段或分辨率会清除定位框。这两项功能需要提供 `H3PaintedEditArea` 和 `H3ObjectPlacementMask` 的新版 `comfyui-h3-oneclick-swap`。
- 默认渲染分辨率为 736p。原项目在 RTX 4060 Ti 上渲染 6 秒 480p 片段约需 6 至 13 分钟，1080p 的耗时约为 736p 的 2.5 倍。自定义宽高各可设 256 至 2048 像素，按 32 像素对齐，视频会缩放并居中裁剪。自定义尺寸需要 H3 Swap Plan 节点的 `short_edge` 输入。
- 高级模式的动作参考默认 512 px，可切换 768 或 1376 px。更高分辨率可能改善姿势和位置跟随，也会延长采样。相同输入可从上次完成的片段续跑，换随机种子可生成新版本。
- 基础模型默认用 H3 pruned INT8，配 DMAD 加速 LoRA 和 6 步采样。多个 LoRA 按顺序应用，可独立开关。关闭加速 LoRA 时可保留风格 LoRA，并将采样步数设为至少 20。Spectrum 加速需要 [ComfyUI-Spectrum-MiniMax-H3](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3)，需要关闭加速 LoRA，且可能改变输出。

### 人脸和色彩后期处理

- **人脸修复（Fix faces）**使用已生成的视频和原角色参考照片，按身份定位同一人。**还原照片（Match the photo）**更贴近参考脸，表情和嘴部动作由 H3 重绘。**跟随口型（Follow the mouth）**更侧重保留视频中的嘴部动作和表情。两种修复都保留高度超过画面五分之一的脸，只有这类脸的片段会跳过。
- **换脸（Replace face）**同样位于 **后期处理 → 人脸修复** 下。上传原视频和新的人脸照片，工作流从视频追踪主要人脸，生成并贴回画面，包含近景。切换镜头后，追踪对象可能变成另一个人。
- **色彩修正（Fix colours）**使用 Image Detail Contrast 和 DCTL Tone Mapper 处理成片。默认细节反差为 −0.20，色调映射用 `H3 soft` 预设（Reinhard，强度 20%）。修改预设参数只影响当前任务。人脸和色彩后期处理都按 24 fps 读取视频。

## 部署到 Comfy Developer Platform

原项目尚未验证云部署。先打包已装好自定义节点和模型的 ComfyUI。

```sh
pip install comfy-cli
comfy setup --where cloud
cd /path/to/ComfyUI
comfy build init --name openjutsu --models-dir ./models --custom-nodes-dir ./custom_nodes
comfy build status
comfy build push --release --target linux/nvidia
comfy deploy refs compute
```

用发布的 Build 创建部署，将 `COMFY_BASE_URL` 指向部署地址，并设置工作区的 `COMFY_API_KEY`。默认 `npm start` 只监听本机。若要监听网络地址，在设置登录密码后启动。

```sh
npm run build
OPENJUTSU_PASSWORD='<strong password>' npx next start --hostname 0.0.0.0
```

在浏览器中以 `openjutsu` 和所设密码登录。上传、任务控制、进度和下载共用这套认证，持有密码的用户共享任务访问权限。客户端输错 5 次后会被限速，分散到不同客户端的 20 次失败也会触发全局限速。通过反向代理时使用 HTTPS，保留公开的 Host 和协议，并让代理正确设置 `X-Forwarded-For`。应用端口由 `PORT` 指定，默认 3000。

实时进度需要主机允许长连接，长任务还受部署的请求时限约束。续跑依赖 ComfyUI 的 `output/` 下保存的片段，新建的无服务器实例需要访问这些断点才能续跑。完成后可停止部署以结束 GPU 计费。

## 开发与许可

工作流的生成脚本位于 `workflows/build/`。重建和节点接线说明见[英文 README](README.md#how-it-works)，`npm test` 检查工作流裁剪和 TypeScript 类型。

项目使用 [MIT 许可](LICENSE)。模型权重各有独立许可。InsightFace 的 `buffalo_l` 仅限非商业研究使用，Bingsu/adetailer 的 Ultralytics YOLO 权重采用 AGPL-3.0。
