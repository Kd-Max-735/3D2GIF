# V1 测试报告

环境：Windows、Node.js 24.13、Chromium（Playwright）、Three.js 0.185。执行日期：2026-07-23。

自动化覆盖：

- Vitest：26 个测试，验证五格式内容识别、单/多文件 glTF 实际解析、动画保留、Object URL 回收、URL 拒绝/超时/取消、资源上限、Draco/KTX2 错误、扩展名/MIME 错配、损坏输入、六轨迹确定性与循环接缝。
- Playwright：14 个 Chromium 测试，覆盖五种格式与真实样本、glTF 外部 BIN+PNG、恶意资源路径 XSS、Viewer 新旧 API、初始化失败清理、`onError` 单次回调、OBJ/USD 同包资源、GIF 预览/下载与确定性、透明背景、取消、Worker 失败、分层错误、六轨迹实际导出、极端比例、20 次重复加载、512×512×60、桌面与移动视觉基准。
- 视觉基准：`tests/e2e/orbitframe.spec.ts-snapshots`，包含 1440×900 桌面和 390×844 移动截图。

命令：`npm run typecheck`、`npm test`、`npm run build`、`npm run test:browser`。验收不得通过删除测试或降低功能断言规避失败。

真实样本来源：Three.js 官方仓库的 Flamingo GLB、male02 OBJ 包、saeukkang USDZ；USDA 与边界 GLB fixture 保存在 `public/fixtures`，GLB 由官方 `GLTFExporter` 生成。
