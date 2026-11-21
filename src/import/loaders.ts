import { Group, LoadingManager, Object3D, type AnimationClip } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { OrbitFrameError, asOrbitFrameError } from '../errors';
import type { ResolvedInput } from './detect';
import type { SupportedFormat } from '../schema/types';

export interface LoadedModel {
  object: Object3D;
  animations: AnimationClip[];
  cleanup(): void;
}

export interface LoaderAdapter {
  readonly format: SupportedFormat;
  load(input: ResolvedInput, signal?: AbortSignal): Promise<LoadedModel>;
}

function normalizedResourcePath(path: string): string {
  return decodeURIComponent(path).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').toLowerCase();
}

function resourceManager(files: File[], strictMissing = false) {
  const manager = new LoadingManager();
  const urls = new Map<string, string>();
  const objectUrls = new Set<string>();
  for (const file of files) {
    const url = URL.createObjectURL(file);
    objectUrls.add(url);
    const paths = [file.name, file.webkitRelativePath].filter(Boolean);
    for (const path of paths) {
      const normalized = normalizedResourcePath(path);
      urls.set(normalized, url);
      urls.set(normalized.split('/').pop()!, url);
    }
  }
  manager.setURLModifier((requested) => {
    if (/^blob:/i.test(requested)) return requested;
    if (/^data:/i.test(requested)) {
      if (/^data:text\/html/i.test(requested)) throw new OrbitFrameError('URL_NOT_ALLOWED', 'Unsafe data URL in model resource.', { url: requested.slice(0, 128) });
      return requested;
    }
    const clean = normalizedResourcePath(requested);
    const resolved = urls.get(clean) ?? urls.get(clean.split('/').pop()!);
    if (resolved) return resolved;
    if (strictMissing) {
      throw new OrbitFrameError(
        'MISSING_EXTERNAL_RESOURCE',
        `Model references a missing external resource: ${requested}`,
        { references: [requested] }
      );
    }
    return requested;
  });
  return {
    manager,
    cleanup: () => objectUrls.forEach((url) => URL.revokeObjectURL(url))
  };
}

function ensureNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new OrbitFrameError('EXPORT_ABORTED', '模型加载已取消。');
}

const glbAdapter: LoaderAdapter = {
  format: 'glb',
  async load(input, signal) {
    ensureNotAborted(signal);
    const resources = resourceManager(input.resources);
    const buffer = await input.file.arrayBuffer();
    ensureNotAborted(signal);
    try {
      const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
        new GLTFLoader(resources.manager).parse(buffer, '', resolve, reject);
      });
      return { object: gltf.scene ?? gltf.scenes[0] ?? new Group(), animations: gltf.animations, cleanup: resources.cleanup };
    } catch (error) {
      resources.cleanup();
      throw asOrbitFrameError(error, 'INVALID_MODEL');
    }
  }
};

const gltfAdapter: LoaderAdapter = {
  format: 'gltf',
  async load(input, signal) {
    ensureNotAborted(signal);
    const resources = resourceManager(input.resources, true);
    try {
      const source = await input.file.text();
      ensureNotAborted(signal);
      const json = JSON.parse(source) as { extensionsUsed?: string[]; extensionsRequired?: string[] };
      const extensions = new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]);
      if (extensions.has('KHR_draco_mesh_compression')) {
        throw new OrbitFrameError('DRACO_DECODER_MISSING', 'This glTF requires a configured Draco decoder.', undefined, undefined, { suggestions: ['Configure GLTFLoader with DRACOLoader.'] });
      }
      if (extensions.has('KHR_texture_basisu')) {
        throw new OrbitFrameError('KTX2_TRANSCODER_MISSING', 'This glTF requires a configured KTX2 transcoder.', undefined, undefined, { suggestions: ['Configure GLTFLoader with KTX2Loader.'] });
      }
      const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
        new GLTFLoader(resources.manager).parse(source, '', resolve, reject);
      });
      return { object: gltf.scene ?? gltf.scenes[0] ?? new Group(), animations: gltf.animations, cleanup: resources.cleanup };
    } catch (error) {
      resources.cleanup();
      throw asOrbitFrameError(error, 'INVALID_MODEL');
    }
  }
};

const objAdapter: LoaderAdapter = {
  format: 'obj',
  async load(input, signal) {
    const resources = resourceManager(input.resources);
    const text = await input.file.text();
    ensureNotAborted(signal);
    try {
      const loader = new OBJLoader(resources.manager);
      const references = [...text.matchAll(/^\s*mtllib\s+(.+)$/gim)].map((match) => match[1].trim());
      if (references.length) {
        const mtl = input.resources.find((file) => references.some((name) => file.name.toLowerCase() === name.toLowerCase() || file.name.toLowerCase().endsWith(`/${name.toLowerCase()}`)));
        if (!mtl) throw new OrbitFrameError('MISSING_EXTERNAL_RESOURCE', `OBJ 引用的材质文件缺失：${references.join(', ')}。`, { references });
        const materials = new MTLLoader(resources.manager).parse(await mtl.text(), '');
        materials.preload();
        loader.setMaterials(materials);
      }
      const object = loader.parse(text);
      return { object, animations: [], cleanup: resources.cleanup };
    } catch (error) {
      resources.cleanup();
      throw asOrbitFrameError(error, error instanceof OrbitFrameError ? error.code : 'INVALID_MODEL');
    }
  }
};

const usdAdapter: LoaderAdapter = {
  format: 'usd',
  async load(input, signal) {
    const resources = resourceManager(input.resources, true);
    const buffer = await input.file.arrayBuffer();
    ensureNotAborted(signal);
    try {
      const loader = new USDLoader(resources.manager);
      const isUsda = new TextDecoder().decode(buffer.slice(0, 16)).trimStart().startsWith('#usda');
      const source: ArrayBuffer | string = isUsda ? new TextDecoder().decode(buffer) : buffer;
      const object = await new Promise<Object3D>((resolve, reject) => {
        let parsed: Object3D;
        try {
          parsed = loader.parse(source, '', resolve, reject);
          if (!parsed) reject(new Error('USD 解析器未返回场景。'));
        } catch (error) { reject(error); }
      });
      return { object, animations: [], cleanup: resources.cleanup };
    } catch (error) {
      resources.cleanup();
      throw asOrbitFrameError(error, 'INVALID_MODEL');
    }
  }
};

const usdzAdapter: LoaderAdapter = { ...usdAdapter, format: 'usdz' };

const adapters: Record<SupportedFormat, LoaderAdapter> = {
  glb: glbAdapter,
  gltf: gltfAdapter,
  obj: objAdapter,
  usd: usdAdapter,
  usdz: usdzAdapter
};

export function getLoaderAdapter(format: SupportedFormat): LoaderAdapter {
  return adapters[format];
}
