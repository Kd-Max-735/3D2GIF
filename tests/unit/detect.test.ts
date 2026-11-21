import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveInput, sniffFormat } from '../../src/import/detect';
import { OrbitFrameError } from '../../src/errors';

const fixture = async (name: string, type = '') => {
  const bytes = await readFile(resolve('public/fixtures', name));
  return new File([bytes], basename(name), { type });
};

afterEach(() => vi.restoreAllMocks());

describe('format detection', () => {
  it.each([
    ['standard.glb', 'glb'], ['obj/male02.obj', 'obj'], ['simple.usd', 'usd'], ['official-saeukkang.usdz', 'usdz']
  ] as const)('sniffs %s as %s', async (name, format) => expect(await sniffFormat(await fixture(name))).toBe(format));

  it('rejects extension/content mismatches', async () => {
    await expect(resolveInput(await fixture('mismatch.obj'))).rejects.toMatchObject({ code: 'FORMAT_MISMATCH' } satisfies Partial<OrbitFrameError>);
  });

  it('does not accept corrupt files by extension alone', async () => {
    await expect(resolveInput(await fixture('corrupt.glb'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' } satisfies Partial<OrbitFrameError>);
  });

  it('checks MIME against actual content when no extension exists', async () => {
    const file = new File([await readFile(resolve('public/fixtures/standard.glb'))], 'upload', { type: 'model/obj' });
    await expect(resolveInput(file)).rejects.toMatchObject({ code: 'FORMAT_MISMATCH' } satisfies Partial<OrbitFrameError>);
  });

  it('recognizes glTF from asset.version instead of extension alone', async () => {
    const file = new File([JSON.stringify({ asset: { version: '2.0' }, scenes: [] })], 'model.gltf', { type: 'model/gltf+json' });
    expect(await sniffFormat(file)).toBe('gltf');
    await expect(resolveInput(file)).resolves.toMatchObject({ format: 'gltf' });
  });

  it('supports structured blob, arrayBuffer, file, and bundle inputs', async () => {
    const source = JSON.stringify({ asset: { version: '2.0' }, scenes: [] });
    const file = new File([source], 'model.gltf');
    await expect(resolveInput({ type: 'file', file })).resolves.toMatchObject({ format: 'gltf' });
    await expect(resolveInput({ type: 'blob', blob: new Blob([source]), filename: 'model.gltf' })).resolves.toMatchObject({ format: 'gltf' });
    await expect(resolveInput({ type: 'arrayBuffer', data: new TextEncoder().encode(source).buffer, filename: 'model.gltf' })).resolves.toMatchObject({ format: 'gltf' });
    await expect(resolveInput({ type: 'bundle', entryFile: file, relatedFiles: [new File(['x'], 'mesh.bin')] })).resolves.toMatchObject({ format: 'gltf', resources: [{ name: 'mesh.bin' }] });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.test/model.glb'])('rejects unsafe URL %s', async (url) => {
    await expect(resolveInput({ type: 'url', url })).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
  });

  it('passes cancellation to fetch and preserves the cancellation code', async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = resolveInput({ type: 'url', url: 'https://example.test/model.glb' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'EXPORT_ABORTED' });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns distinct timeout and unexpected Content-Type errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    await expect(resolveInput({ type: 'url', url: 'https://example.test/model.glb' }, undefined, { timeoutMs: 1 })).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(resolveInput({ type: 'url', url: 'https://example.test/model.glb' })).rejects.toMatchObject({ code: 'UNEXPECTED_CONTENT_TYPE' });
  });
});
