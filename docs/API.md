# API

## `import3DToHTML(input, config): Promise<ViewerHandle>`

加载并验证输入，将其转换为 Three.js 场景树，按包围盒居中和统一缩放，然后在 `config.container` 中创建交互查看器。

输入兼容 `File`、`Blob`、HTTPS URL 字符串、`{ file, resources }`，并支持 `{ type: 'file' }`、`blob`、`url`、`arrayBuffer` 和 `{ type: 'bundle', entryFile, relatedFiles }`。

主要配置：`container`（必填）、`background`、`bottomAlign`、`groundShadow`、`lightPreset`、`pixelRatio`、`signal`、`onError`。限制默认值：主文件 100 MiB、资源包 300 MiB、200 个文件、单纹理 32 MiB/8192 像素、300 万三角面、100 个动画。URL 默认仅 HTTPS；`urlPolicy` 可配置 `allowHttp`、`sameOriginOnly`、`allowedHosts` 和 `timeoutMs`。网络 glTF 的外部资源执行相同策略。

`ViewerHandle` 暴露 `container`、`canvas`、`scene`、`modelRoot`、`camera`、`renderer`、`controls`、`animations`、可选 `mixer` 和 `metadata`，以及 `render()`、`resize(width?, height?)`、`resetView()`、`setBackground()`、`playAnimation()`、`stopAnimation()`、`dispose()`。原 `element`、`model`、`stats`、`reset()` 均保留为兼容别名。`dispose()` 幂等，并释放几何体、材质、纹理、动画、控制器、监听器、Object URL、Renderer 和 WebGL 上下文。

## `export3DToGIF(viewerOrInput, config): Promise<GifExportResult>`

可接收现有 `ViewerHandle` 或任意 `ModelInput`。直接输入时会创建不可见临时查看器，并在所有退出路径释放。

默认值：512×512、15 FPS、4 秒、60 帧、256 色、`#eceeef` 背景、无限循环、模型水平转台。若同时指定 `frameCount` 与 `duration`，帧数以 `frameCount` 为准，结果时长为 `frameCount / fps`。

配置包括 `width`、`height`、`fps`、`duration`、`frameCount`、`loop`、`repeat`、`background`（CSS 颜色或 `transparent`）、`maxColors`、`quality`（`maxColors` 的兼容别名）、`dithering`、`motion`、`signal`、`onProgress`、`onError`。

运动类型：`model-turntable`、`camera-orbit`、`camera-tilt-orbit`、`ping-pong`、`multi-axis-sway`、`spiral-orbit`。完整环绕轨迹要求整数 `turns`，避免循环断缝。

结果包含 `blob`、`url`、`width`、`height`、`frameCount`、`duration`、`fps`、`fileSize` 和幂等 `dispose()`。调用 `dispose()` 后 Object URL 失效，但 `blob` 仍可由调用方持有。

取消信号在文件/网络读取、解析前后、逐帧渲染、Worker、finish 和 Blob 阶段检查。取消会停止新帧、通知并终止 Worker、释放 RenderTarget，Promise 保持以 `EXPORT_ABORTED` 拒绝，不返回部分 GIF。失败时 `onError` 对每次调用触发一次。
