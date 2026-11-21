# 浏览器兼容

V1 目标是当前稳定版 Chromium、Edge、Firefox 和 Safari。必需能力：ES2022 module、WebGL 2/可用 WebGL、Web Worker module、Blob/Object URL、File API、ResizeObserver 和 AbortController。

Playwright 自动化在 Chromium 实际通过。Edge、Firefox、WebKit/Safari、微信/企业微信、iOS/Android 图片预览、Word、PowerPoint 和其他办公软件均未验证，不能据此视为已经兼容。Safari 对 USDZ 的系统展示能力与 OrbitFrame 无关，OrbitFrame 始终通过 Three.js/WebGL 自行解析渲染。

WebGL 不可用或上下文丢失会返回对应结构化错误。浏览器不支持某个归档纹理编码时，会保留底层加载错误，不输出静态替代模型。
