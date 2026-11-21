# OrbitFrame

OrbitFrame 是一个运行在浏览器中的 3D 模型查看与 GIF 导出工具。它使用 Three.js 加载模型，提供可交互预览，并以固定时间步长离屏渲染，将结果编码为可下载的 GIF。

项目同时包含可直接运行的响应式 Demo 和可作为库调用的 TypeScript API。

## 功能概览

- 加载并预览 GLB、glTF、OBJ、USD、USDZ 模型。
- 支持随模型提供关联资源：glTF 的 BIN/纹理、OBJ 的 MTL/纹理，以及独立 USD 的外部资源。
- 自动进行场景归一化、相机取景、灯光布置、地面阴影和轨道控制。
- 导出 GIF 时支持尺寸、帧率、时长、色彩数、透明背景、循环和 Floyd–Steinberg 抖动。
- 内置六种循环友好的运动轨迹：模型转台、相机环绕、倾斜环绕、往返摆动、多轴轻摆与螺旋环绕。
- 提供取消、进度回调、资源上限、URL 策略和结构化错误码。
- 在 Worker 中进行 GIF 编码；渲染与编码按帧流式衔接，不保留整段 RGBA 帧序列。

## 本地运行

要求：Node.js 和 npm。首次运行时安装依赖：

```bash
npm install
npm run dev
```

Vite 会在终端输出本地访问地址，通常为 `http://127.0.0.1:5173`。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 使用 API

先将模型加载为可交互的查看器，再从该查看器导出 GIF：

```ts
import { export3DToGIF, import3DToHTML } from 'orbitframe';

const viewer = await import3DToHTML(
  {
    file: modelFile,
    resources: [mtlFile, ...textureFiles]
  },
  {
    container: document.querySelector<HTMLElement>('#viewer')!,
    background: '#eceeef',
    bottomAlign: true,
    lightPreset: 'studio'
  }
);

const result = await export3DToGIF(viewer, {
  width: 512,
  height: 512,
  fps: 15,
  duration: 4,
  motion: { type: 'camera-orbit', turns: 1 },
  onProgress: (progress) => console.log(progress.percent)
});

previewImage.src = result.url;
downloadLink.href = result.url;
downloadLink.download = 'model.gif';

// 不再使用时释放 Object URL 和 WebGL 资源。
result.dispose();
viewer.dispose();
```

也可以直接向 `export3DToGIF` 传入模型输入。此时 OrbitFrame 会创建隐藏的临时查看器，导出结束后自动释放它：

```ts
const result = await export3DToGIF(modelFile, {
  width: 640,
  height: 640,
  background: 'transparent',
  motion: { type: 'model-turntable', turns: 1 }
});
```

## 输入格式与资源包

`import3DToHTML` 和 `export3DToGIF` 都接受 `ModelInput`。常用形式如下：

| 输入形式 | 适用场景 |
| --- | --- |
| `File` / `Blob` | 单一模型文件 |
| HTTPS URL 字符串 | 从允许的远程地址加载模型 |
| `{ file, resources }` | 模型及其关联 BIN、MTL、纹理等文件 |
| `{ type: 'arrayBuffer', data, filename }` | 内存中的二进制模型 |
| `{ type: 'bundle', entryFile, relatedFiles }` | 明确声明入口文件与关联文件 |

支持格式如下：

| 格式 | 支持内容 |
| --- | --- |
| GLB | glTF 2.0 二进制模型、内嵌资源 |
| glTF | 单文件 data URI，或同包/HTTPS 的 BIN 与图片资源 |
| OBJ | 几何体、同包 MTL 与常见浏览器可解码纹理 |
| USD | USDA 文本、USDC crate；外部资源需通过 `resources` 提供 |
| USDZ | 包含 USDA 或 USDC 根层及归档资源的 USDZ 文件 |

格式识别会检查扩展名、MIME、文件头和内容，单靠正确的扩展名不能通过验证。Draco 与 KTX2 解码器尚未内置；需要它们的模型会返回对应错误码。

## 查看器配置

`import3DToHTML(input, config)` 的 `config.container` 为必填项。常用配置：

| 配置 | 说明 |
| --- | --- |
| `background` | CSS 颜色，或 `'transparent'` |
| `bottomAlign` | 是否让模型底部对齐地面，默认 `true` |
| `groundShadow` | 是否显示地面阴影，默认 `true` |
| `lightPreset` | `'studio'`、`'soft'` 或 `'dramatic'` |
| `pixelRatio` | 渲染像素比；默认使用设备像素比，最高为 2 |
| `signal` | 用于取消加载的 `AbortSignal` |
| `onError` | 接收结构化错误对象的回调 |
| `urlPolicy` | 控制远程 URL 的协议、主机、同源和超时策略 |

为避免异常资源消耗，默认限制为：主文件 100 MiB、资源包 300 MiB、最多 200 个文件、单纹理 32 MiB 或 8192 像素、300 万三角面、100 个动画。

返回的 `ViewerHandle` 包含 `canvas`、`scene`、`camera`、`controls`、`animations` 和模型统计信息，并提供以下方法：

- `render()`：立即重绘。
- `resize(width?, height?)`：调整渲染尺寸。
- `resetView()`：恢复初始取景与模型姿态。
- `setBackground(value)`：设置背景颜色或透明背景。
- `playAnimation(nameOrIndex?)` / `stopAnimation()`：控制模型动画。
- `dispose()`：释放查看器占用的事件、Object URL、纹理、几何体、Renderer 与 WebGL 上下文；可重复调用。

## GIF 导出配置

`export3DToGIF(viewerOrInput, config)` 的默认输出为 512×512、15 FPS、4 秒、60 帧、256 色、浅灰背景、无限循环和模型水平转台。

| 配置 | 范围或说明 |
| --- | --- |
| `width` / `height` | 16–2048 像素 |
| `fps` | 1–60 |
| `duration` | 大于 0 且不超过 120 秒 |
| `frameCount` | 1–1800；指定后优先于 `duration` |
| `background` | CSS 颜色或 `'transparent'` |
| `maxColors` | 2–256；`quality` 是兼容别名 |
| `dithering` | 是否启用 Floyd–Steinberg 抖动 |
| `loop` / `repeat` | 循环控制；`loop: false` 表示不循环 |
| `motion` | 轨迹类型与参数 |
| `signal` | 用于取消导出的 `AbortSignal` |
| `onProgress` | 返回 `loading`、`rendering`、`encoding`、`done` 阶段进度 |
| `onError` | 接收一次结构化错误对象的回调 |

`motion.type` 可选值：

- `model-turntable`
- `camera-orbit`
- `camera-tilt-orbit`
- `ping-pong`
- `multi-axis-sway`
- `spiral-orbit`

完整环绕类型的 `turns` 必须为正整数，确保 GIF 首尾帧连续。导出结果包含 `blob`、可用于 `<img>` 或下载链接的 `url`、输出尺寸、帧数、实际时长、帧率、文件大小，以及用于释放 URL 的 `dispose()`。

## 错误与取消

所有已知失败会以 `OrbitFrameError` 抛出，其中包含 `code`、`message`、`stage`、`recoverable`、可选 `suggestions`、`details` 与底层 `cause`。常见错误包括格式不支持、格式与内容不匹配、关联资源缺失、网络或 CORS 失败、模型或纹理超限、WebGL 不可用、导出内存超限与 GIF 编码失败。

使用 `AbortController` 可以在加载或导出期间取消操作：

```ts
const controller = new AbortController();

const exporting = export3DToGIF(viewer, { signal: controller.signal });
controller.abort();

await exporting; // 以 code 为 EXPORT_ABORTED 的错误结束
```

完整错误码和处理建议见 [错误码文档](docs/ERRORS.md)。

## 开发与验证

```bash
# TypeScript 类型检查
npm run typecheck

# 单元测试
npm test

# 构建 Demo、库文件与类型声明
npm run build

# Chromium 端到端测试（首次执行前安装浏览器）
npx playwright install chromium
npm run test:browser

# 完整验证
npm run test:all
```

端到端测试覆盖 Chrome/Chromium。其他浏览器属于目标环境，但尚未在自动化流程中验证，具体能力与限制见 [浏览器兼容性](docs/BROWSER_COMPATIBILITY.md)。

## 项目结构

```text
src/
├── import/   # 输入识别、URL 策略、资源解析与加载器
├── viewer/   # Three.js 场景、相机、灯光、交互与释放
├── motion/   # GIF 运动轨迹
├── capture/  # 离屏逐帧渲染与像素读取
├── gif/      # Worker GIF 编码与量化
├── schema/   # 公共 TypeScript 类型与 JSON Schema
└── demo/     # Vite 演示页面
```

## 相关文档

- [API 参考](docs/API.md)
- [支持格式与限制](docs/FORMATS.md)
- [错误码](docs/ERRORS.md)
- [浏览器兼容性](docs/BROWSER_COMPATIBILITY.md)
- [性能说明](docs/PERFORMANCE.md)
- [测试报告](docs/TEST_REPORT.md)
