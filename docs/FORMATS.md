# 支持格式与限制

| 输入 | V1 支持 | 验证样本 |
| --- | --- | --- |
| GLB | glTF 2.0 二进制；内嵌 Buffer、材质和纹理 | Three 官方 Flamingo GLB、多材质自生成标准 GLB |
| glTF | 通过 JSON `asset.version` 识别；支持单文件 data URI，以及同包/HTTPS 的 BIN、PNG、JPEG、WebP 等相对资源 | 自动化单文件动画样本；外部 BIN + PNG 浏览器样本 |
| OBJ | 几何体；同包 MTL 与常见浏览器图片纹理 | Three 官方 male02 OBJ + MTL + 3 JPEG |
| USD | USDA 文本和 USDC crate 二进制；`.usd`、`.usda`、`.usdc` | USDA 网格 fixture；USDC 路径由官方解析器实现 |
| USDZ | 符合 USDZ/ZIP 的 USDA 或 USDC 根层和归档内资源 | Three 官方 saeukkang USDZ |

识别会综合扩展名、MIME、GLB/USDC/ZIP 文件头、glTF JSON `asset.version` 以及 OBJ/USDA 内容。扩展名与内容冲突返回 `FORMAT_MISMATCH`；仅有正确扩展名不会被视为有效文件。

USD 与 USDZ 均使用 Three.js `USDLoader`（r185）：它分别调用 USDA parser、USDC crate parser和 USDZ 解包流程，USD 不会被当作 USDZ 解析。USDZ 按 AOUSD 规则把第一个 ZIP 条目视为根层。归档图片覆盖 PNG、JPEG 和 AVIF。

限制：这是 Three.js 的浏览器 USD 组合器，不等同完整 OpenUSD 运行时。基础 Mesh/Xform、材质、纹理、相机和骨骼路径可解析，但复杂 Composition Arc、插件 schema、程序化资产、体积、着色器网络或少见压缩/纹理格式可能不受支持。解析器没有产出可渲染几何体时返回 `EMPTY_SCENE`；解析异常保留原消息并返回 `INVALID_MODEL`。独立 USD 的外部文件必须通过 `resources` 提供，V1 不执行服务端转换。

OBJ 按文件名映射关联资源；声明了 `mtllib` 而未提供 MTL 时返回 `MISSING_EXTERNAL_RESOURCE`。纹理是否可解码仍取决于浏览器图片解码能力。

glTF 和本地资源包通过 `LoadingManager.setURLModifier()` 映射相对路径，所有 Object URL 在成功、失败与取消路径释放。当前未内置 Draco/KTX2 二进制，模型声明对应扩展时分别返回 `DRACO_DECODER_MISSING`、`KTX2_TRANSCODER_MISSING`，不会误报为损坏文件。
