# 错误码

所有错误均为 `OrbitFrameError`，包含兼容字段 `code`、`message`、可选 `details`/`cause`，并补充 `stage`、`recoverable`、可选 `suggestions`。

| 错误码 | 含义 |
| --- | --- |
| `UNSUPPORTED_FORMAT` | 内容无法识别为支持格式 |
| `FORMAT_MISMATCH` | 扩展名或 MIME 与内容冲突 |
| `INVALID_MODEL` | 格式可识别，但解析或包围盒无效 |
| `EMPTY_SCENE` | 没有可渲染几何体 |
| `MISSING_EXTERNAL_RESOURCE` | OBJ 声明的 MTL 等资源缺失 |
| `CORS_BLOCKED` / `NETWORK_TIMEOUT` / `NETWORK_ERROR` | CORS/请求失败、超时或 HTTP 错误 |
| `URL_NOT_ALLOWED` / `UNEXPECTED_CONTENT_TYPE` | URL 策略拒绝或响应类型异常 |
| `DRACO_DECODER_MISSING` / `KTX2_TRANSCODER_MISSING` | 模型需要尚未配置的解码器 |
| `MODEL_TOO_LARGE` | 主文件、资源包、文件数、三角面或动画数量超限 |
| `TEXTURE_TOO_LARGE` | 外部或内嵌纹理字节/尺寸超限 |
| `WEBGL_UNAVAILABLE` | 无法创建 WebGLRenderer |
| `WEBGL_CONTEXT_LOST` | 浏览器报告上下文丢失 |
| `RENDER_TARGET_FAILED` / `PIXEL_READ_FAILED` | 离屏目标渲染或像素读取失败 |
| `INVALID_MOTION_CONFIG` | 轨迹、圈数、时长等参数无效 |
| `NON_LOOPING_PATH` | 循环环绕轨迹不能首尾连续 |
| `GIF_ENCODER_FAILED` | Worker、量化或 GIF 编码失败 |
| `MEMORY_LIMIT_EXCEEDED` | 尺寸、帧数或预计单帧内存越界 |
| `EXPORT_ABORTED` | AbortSignal 主动取消 |

解析失败不会统一改写成“文件损坏”；底层解析消息保留在 `message`/`cause` 中。
