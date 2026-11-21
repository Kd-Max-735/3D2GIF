import { OrbitFrameError, abortError } from '../errors';
import type { ModelInput, SupportedFormat, UrlPolicy } from '../schema/types';

const EXTENSIONS: Record<string, SupportedFormat> = {
  glb: 'glb', gltf: 'gltf', obj: 'obj', usd: 'usd', usda: 'usd', usdc: 'usd', usdz: 'usdz'
};

const MIME_FORMATS: Record<string, SupportedFormat> = {
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'application/gltf+json': 'gltf',
  'model/obj': 'obj',
  'text/plain': 'obj',
  'model/vnd.usd': 'usd',
  'model/vnd.usdz+zip': 'usdz'
};

export interface ResolvedInput {
  file: File;
  resources: File[];
  format: SupportedFormat;
  sourceUrl?: string;
}

function isInputPackage(input: ModelInput): input is Extract<ModelInput, { file: File }> {
  return !(input instanceof Blob) && typeof input === 'object' && 'file' in input && input.file instanceof File;
}

function extension(name: string): SupportedFormat | undefined {
  const value = name.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONS[value];
}

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export async function sniffFormat(file: Blob): Promise<SupportedFormat | undefined> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  if (startsWith(bytes, [0x67, 0x6c, 0x54, 0x46])) return 'glb';
  if (startsWith(bytes, [0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43])) return 'usd';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'usdz';
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(await file.text()) as { asset?: { version?: unknown } };
      if (typeof json.asset?.version === 'string') return 'gltf';
    } catch { /* Other text formats are checked below. */ }
  }
  if (/^#usda\s+[\d.]+/i.test(text)) return 'usd';
  if (/^(?:#.*\r?\n\s*)*(?:mtllib\s+.+|[vnogfs]\s+[-+.\d])/im.test(text)) return 'obj';
  return undefined;
}

export function validateUrl(rawUrl: string, policy: UrlPolicy = {}, base?: string): URL {
  let url: URL;
  try { url = new URL(rawUrl, base); }
  catch (cause) { throw new OrbitFrameError('URL_NOT_ALLOWED', 'Invalid model URL.', { url: rawUrl }, { cause }); }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new OrbitFrameError('URL_NOT_ALLOWED', `URL protocol is not allowed: ${url.protocol}`, { url: url.href, protocol: url.protocol });
  }
  const currentOrigin = typeof location !== 'undefined' ? location.origin : undefined;
  if (policy.sameOriginOnly && (!currentOrigin || url.origin !== currentOrigin)) {
    throw new OrbitFrameError('URL_NOT_ALLOWED', 'Cross-origin URL is not allowed by the configured policy.', { url: url.href });
  }
  if (policy.allowedHosts?.length && !policy.allowedHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) {
    throw new OrbitFrameError('URL_NOT_ALLOWED', 'URL host is not in the configured allowlist.', { url: url.href, host: url.hostname });
  }
  return url;
}

async function fetchFile(rawUrl: string, signal?: AbortSignal, policy: UrlPolicy = {}, base?: string): Promise<{ file: File; url: string }> {
  const url = validateUrl(rawUrl, policy, base);
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, policy.timeoutMs ?? 30_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (cause) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new OrbitFrameError('NETWORK_TIMEOUT', 'Model request timed out.', { url: url.href }, { cause });
    throw new OrbitFrameError('CORS_BLOCKED', 'Model request failed or was blocked by CORS.', { url: url.href }, { cause });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
  if (!response.ok) throw new OrbitFrameError('NETWORK_ERROR', `Model request failed with HTTP ${response.status}.`, { url: url.href, status: response.status });
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    throw new OrbitFrameError('UNEXPECTED_CONTENT_TYPE', `Unexpected model Content-Type: ${contentType}.`, { url: url.href, contentType });
  }
  const blob = await response.blob();
  if (signal?.aborted) throw abortError();
  const name = decodeURIComponent(url.pathname.split('/').pop() || 'model');
  return { file: new File([blob], name, { type: blob.type || contentType }), url: url.href };
}

export async function resolveInput(input: ModelInput, signal?: AbortSignal, policy: UrlPolicy = {}): Promise<ResolvedInput> {
  let file: File;
  let resources: File[] = [];
  let sourceUrl: string | undefined;
  if (typeof input === 'string' || (!(input instanceof Blob) && 'type' in input && input.type === 'url')) {
    const fetched = await fetchFile(typeof input === 'string' ? input : input.url, signal, policy);
    file = fetched.file; sourceUrl = fetched.url;
  } else if (!(input instanceof Blob) && 'type' in input && input.type === 'bundle') {
    file = input.entryFile; resources = input.relatedFiles;
  } else if (!(input instanceof Blob) && 'type' in input && input.type === 'blob') {
    file = new File([input.blob], input.filename ?? 'model', { type: input.blob.type });
  } else if (!(input instanceof Blob) && 'type' in input && input.type === 'arrayBuffer') {
    file = new File([input.data], input.filename);
  } else if (isInputPackage(input)) {
    file = input.file;
    resources = 'resources' in input ? input.resources ?? [] : [];
  } else if (input instanceof File) file = input;
  else file = new File([input], 'model', { type: input.type });

  if (signal?.aborted) throw abortError();
  const content = await sniffFormat(file);
  if (signal?.aborted) throw abortError();
  const ext = extension(file.name);
  const mime = MIME_FORMATS[file.type.toLowerCase()];
  if (!content) throw new OrbitFrameError('UNSUPPORTED_FORMAT', '无法从文件内容识别受支持的 3D 格式。', { name: file.name, mime: file.type });
  if (ext && ext !== content) throw new OrbitFrameError('FORMAT_MISMATCH', `扩展名表示 ${ext.toUpperCase()}，文件内容是 ${content.toUpperCase()}。`, { extension: ext, content });
  if (!ext && mime && mime !== content && !(mime === 'obj' && content === 'usd')) {
    throw new OrbitFrameError('FORMAT_MISMATCH', `MIME 表示 ${mime.toUpperCase()}，文件内容是 ${content.toUpperCase()}。`, { mime, content });
  }
  if (sourceUrl && content === 'gltf') {
    const json = JSON.parse(await file.text()) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
    const uris = [...(json.buffers ?? []), ...(json.images ?? [])]
      .map((item) => item.uri).filter((uri): uri is string => !!uri && !/^(?:data:|blob:)/i.test(uri));
    resources = await Promise.all([...new Set(uris)].map(async (uri) => {
      const fetched = await fetchFile(uri, signal, policy, sourceUrl);
      return new File([fetched.file], uri, { type: fetched.file.type });
    }));
  }
  return { file, resources, format: content, sourceUrl };
}
