import { OrbitFrameError } from '../errors';
import type { ModelInput } from '../schema/types';
import type { Material, Mesh, Texture } from 'three';
import type { UrlPolicy } from '../schema/types';
import { resolveInput } from './detect';
import { getLoaderAdapter, type LoadedModel } from './loaders';
import { disposeObject } from '../viewer/dispose';

export interface LoadLimits {
  maxModelBytes: number;
  maxTextureBytes: number;
  maxTotalBundleBytes: number;
  maxFiles: number;
  maxTextureDimension: number;
  maxTriangles: number;
  maxAnimations: number;
  urlPolicy?: UrlPolicy;
}

async function readGltfJson(file: File, format: 'glb' | 'gltf'): Promise<Record<string, unknown>> {
  if (format === 'gltf') return JSON.parse(await file.text()) as Record<string, unknown>;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(16, true) !== 0x4e4f534a) return {};
  const length = Math.min(view.getUint32(12, true), buffer.byteLength - 20);
  return JSON.parse(new TextDecoder().decode(buffer.slice(20, 20 + length)).replace(/[\0\s]+$/, '')) as Record<string, unknown>;
}

function textureDimensions(texture: Texture): { width: number; height: number } | undefined {
  const image = texture.image as { width?: number; height?: number } | undefined;
  return image?.width && image.height ? { width: image.width, height: image.height } : undefined;
}

function validateLoaded(loaded: LoadedModel, limits: LoadLimits): void {
  if (loaded.animations.length > limits.maxAnimations) {
    throw new OrbitFrameError('MODEL_TOO_LARGE', 'Model exceeds the animation count limit.', { count: loaded.animations.length, limit: limits.maxAnimations });
  }
  let triangles = 0;
  const textures = new Set<Texture>();
  loaded.object.traverse((node) => {
    if (!('isMesh' in node)) return;
    const mesh = node as Mesh;
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : (mesh.geometry.attributes.position?.count ?? 0) / 3;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    for (const material of materials) for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && 'isTexture' in value) textures.add(value as Texture);
    }
  });
  if (triangles > limits.maxTriangles) throw new OrbitFrameError('MODEL_TOO_LARGE', 'Model exceeds the triangle limit.', { triangles, limit: limits.maxTriangles });
  for (const texture of textures) {
    const dimensions = textureDimensions(texture);
    if (dimensions && Math.max(dimensions.width, dimensions.height) > limits.maxTextureDimension) {
      throw new OrbitFrameError('TEXTURE_TOO_LARGE', 'Texture dimensions exceed the configured limit.', { ...dimensions, limit: limits.maxTextureDimension });
    }
  }
}

async function validateGltfPayload(file: File, format: 'glb' | 'gltf', limits: LoadLimits): Promise<void> {
  const json = await readGltfJson(file, format) as {
    extensionsUsed?: string[]; extensionsRequired?: string[];
    images?: Array<{ uri?: string; bufferView?: number }>;
    bufferViews?: Array<{ byteLength?: number }>;
  };
  const extensions = new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]);
  if (extensions.has('KHR_draco_mesh_compression')) {
    throw new OrbitFrameError('DRACO_DECODER_MISSING', 'This model requires a configured Draco decoder.', undefined, undefined, { suggestions: ['Configure GLTFLoader with DRACOLoader.'] });
  }
  if (extensions.has('KHR_texture_basisu')) {
    throw new OrbitFrameError('KTX2_TRANSCODER_MISSING', 'This model requires a configured KTX2 transcoder.', undefined, undefined, { suggestions: ['Configure GLTFLoader with KTX2Loader.'] });
  }
  for (const image of json.images ?? []) {
    const embeddedBytes = image.bufferView !== undefined
      ? json.bufferViews?.[image.bufferView]?.byteLength ?? 0
      : image.uri?.startsWith('data:') ? Math.floor((image.uri.split(',')[1]?.length ?? 0) * 0.75) : 0;
    if (embeddedBytes > limits.maxTextureBytes) {
      throw new OrbitFrameError('TEXTURE_TOO_LARGE', 'Embedded texture exceeds the byte limit.', { size: embeddedBytes, limit: limits.maxTextureBytes });
    }
  }
}

export async function loadModel(
  input: ModelInput,
  limits: LoadLimits,
  signal?: AbortSignal
): Promise<LoadedModel & { resolved: Awaited<ReturnType<typeof resolveInput>> }> {
  const resolved = await resolveInput(input, signal, limits.urlPolicy);
  if (resolved.file.size > limits.maxModelBytes) {
    throw new OrbitFrameError('MODEL_TOO_LARGE', '模型文件超过大小限制。', { size: resolved.file.size, limit: limits.maxModelBytes });
  }
  if (resolved.resources.length + 1 > limits.maxFiles) {
    throw new OrbitFrameError('MODEL_TOO_LARGE', 'Resource bundle exceeds the file count limit.', { count: resolved.resources.length + 1, limit: limits.maxFiles });
  }
  const totalBytes = resolved.file.size + resolved.resources.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > limits.maxTotalBundleBytes) {
    throw new OrbitFrameError('MODEL_TOO_LARGE', 'Resource bundle exceeds the total size limit.', { size: totalBytes, limit: limits.maxTotalBundleBytes });
  }
  const oversized = resolved.resources.find((file) => /\.(png|jpe?g|webp|avif)$/i.test(file.name) && file.size > limits.maxTextureBytes);
  if (oversized) throw new OrbitFrameError('TEXTURE_TOO_LARGE', `纹理 ${oversized.name} 超过大小限制。`, { size: oversized.size, limit: limits.maxTextureBytes });
  if (resolved.format === 'glb' || resolved.format === 'gltf') await validateGltfPayload(resolved.file, resolved.format, limits);
  const loaded = await getLoaderAdapter(resolved.format).load(resolved, signal);
  try {
    if (signal?.aborted) throw new OrbitFrameError('EXPORT_ABORTED', 'Model loading cancelled.');
    validateLoaded(loaded, limits);
    return { ...loaded, resolved };
  } catch (error) {
    try { disposeObject(loaded.object); } finally { loaded.cleanup(); }
    throw error;
  }
}
