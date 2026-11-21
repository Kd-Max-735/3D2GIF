import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModel, type LoadLimits } from '../../src/import';

if (typeof ProgressEvent === 'undefined') {
  vi.stubGlobal('ProgressEvent', class extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    constructor(type: string, init: ProgressEventInit = {}) {
      super(type);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  });
}

const limits: LoadLimits = {
  maxModelBytes: 1024 * 1024,
  maxTextureBytes: 1024 * 1024,
  maxTotalBundleBytes: 2 * 1024 * 1024,
  maxFiles: 10,
  maxTextureDimension: 1024,
  maxTriangles: 100,
  maxAnimations: 10
};

function animatedTriangle(uri: string): { json: string; bytes: Uint8Array } {
  const floats = new Float32Array([
    -1, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 1,
    0, 0, 0, 0, 0.25, 0
  ]);
  const bytes = new Uint8Array(floats.buffer);
  return {
    bytes,
    json: JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ uri, byteLength: bytes.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 8 }, { buffer: 0, byteOffset: 44, byteLength: 24 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' }
      ],
      animations: [{ name: 'move', samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }]
    })
  };
}

afterEach(() => vi.restoreAllMocks());

describe('glTF loading', () => {
  it('loads a single-file glTF and preserves animations', async () => {
    const data = animatedTriangle('');
    const uri = `data:application/octet-stream;base64,${Buffer.from(data.bytes).toString('base64')}`;
    const file = new File([animatedTriangle(uri).json], 'triangle.gltf', { type: 'model/gltf+json' });
    const loaded = await loadModel(file, limits);
    expect(loaded.animations.map((clip) => clip.name)).toEqual(['move']);
    expect(loaded.object.getObjectByProperty('isMesh', true)).toBeTruthy();
    loaded.cleanup();
  });

  it('loads a multi-file glTF and revokes all Object URLs', async () => {
    const data = animatedTriangle('geometry.bin');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const loaded = await loadModel({ type: 'bundle', entryFile: new File([data.json], 'triangle.gltf'), relatedFiles: [new File([data.bytes.buffer as ArrayBuffer], 'geometry.bin')] }, limits);
    expect(loaded.animations).toHaveLength(1);
    loaded.cleanup();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('rejects bundle and triangle limits with structured errors', async () => {
    const data = animatedTriangle('geometry.bin');
    const bundle = { type: 'bundle' as const, entryFile: new File([data.json], 'triangle.gltf'), relatedFiles: [new File([data.bytes.buffer as ArrayBuffer], 'geometry.bin')] };
    await expect(loadModel(bundle, { ...limits, maxFiles: 1 })).rejects.toMatchObject({ code: 'MODEL_TOO_LARGE', stage: 'validate' });
    await expect(loadModel(bundle, { ...limits, maxTriangles: 0 })).rejects.toMatchObject({ code: 'MODEL_TOO_LARGE', stage: 'validate' });
  });

  it('reports missing Draco and KTX2 configuration precisely', async () => {
    for (const [extension, code] of [['KHR_draco_mesh_compression', 'DRACO_DECODER_MISSING'], ['KHR_texture_basisu', 'KTX2_TRANSCODER_MISSING']] as const) {
      const file = new File([JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: [extension] })], 'compressed.gltf');
      await expect(loadModel(file, limits)).rejects.toMatchObject({ code });
    }
  });
});
