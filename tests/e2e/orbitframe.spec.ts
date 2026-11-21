import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { PNG } from 'pngjs';

const fixtures = resolve('public/fixtures');

async function expectVisibleCanvas(page: Page) {
  const canvas = page.locator('#viewer canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const png = PNG.sync.read(await canvas.screenshot());
  const corner = png.data.subarray(0, 3);
  let changed = 0;
  let minX = png.width, minY = png.height, maxX = 0, maxY = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (Math.abs(png.data[i] - corner[0]) + Math.abs(png.data[i + 1] - corner[1]) + Math.abs(png.data[i + 2] - corner[2]) > 35) {
      changed++;
      const pixel = i / 4, x = pixel % png.width, y = Math.floor(pixel / png.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  expect(changed / (png.width * png.height)).toBeGreaterThan(0.001);
  expect(Math.max((maxX - minX) / png.width, (maxY - minY) / png.height)).toBeGreaterThan(0.2);
}

async function upload(page: Page, main: string, resources: string[] = []) {
  if (resources.length) await page.locator('#resource-files').setInputFiles(resources.map((name) => resolve(fixtures, name)));
  await page.locator('#model-file').setInputFiles(resolve(fixtures, main));
  await expect(page.locator('#format-badge')).not.toHaveText('未载入');
  await expectVisibleCanvas(page);
}

async function gifBytes(page: Page): Promise<Buffer> {
  const bytes = await page.locator('#result img').evaluate(async (image: HTMLImageElement) => {
    return Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer()));
  });
  return Buffer.from(bytes);
}

function firstGifFrame(bytes: Buffer): { width: number; height: number; rgba: Uint8ClampedArray } {
  const parsed = parseGIF(Uint8Array.from(bytes).buffer);
  const frame = decompressFrames(parsed, true)[0];
  return { width: parsed.lsd.width, height: parsed.lsd.height, rgba: frame.patch };
}

function foregroundStats(data: Uint8Array | Uint8ClampedArray, width: number, height: number) {
  const background = data.subarray(0, 3);
  let count = 0, luminance = 0, nearBlack = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const delta = Math.abs(data[i] - background[0]) + Math.abs(data[i + 1] - background[1]) + Math.abs(data[i + 2] - background[2]);
    if (delta <= 35) continue;
    const value = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    count++;
    luminance += value;
    if (value < 24) nearBlack++;
  }
  return { count, meanLuminance: luminance / Math.max(1, count), nearBlackRatio: nearBlack / Math.max(1, count) };
}

function gltfFixture() {
  const binary = Buffer.from(new Float32Array([
    -1, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 1, 0, 0.5, 1,
    0, 1,
    0, 0, 0, 0, 0.25, 0
  ]).buffer);
  const texture = new PNG({ width: 2, height: 2 });
  texture.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
  ]);
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ uri: 'geometry.bin', byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 8 }, { buffer: 0, byteOffset: 68, byteLength: 24 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' }
    ],
    images: [{ uri: 'textures/pixel.png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, doubleSided: true }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    animations: [{ name: 'move', samplers: [{ input: 2, output: 3 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }]
  });
  return { binary, texture: PNG.sync.write(texture), json: Buffer.from(json) };
}

test('loads real GLB, OBJ package, USD and USDZ samples', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'standard.glb');
  await expect(page.locator('#format-badge')).toHaveText('GLB');

  await page.reload();
  await upload(page, 'obj/male02.obj', ['obj/male02.mtl', 'obj/01_-_Default1noCulling.JPG', 'obj/male-02-1noCulling.JPG', 'obj/orig_02_-_Defaul1noCulling.JPG']);
  await expect(page.locator('#format-badge')).toHaveText('OBJ');

  await page.reload();
  await upload(page, 'simple.usd');
  await expect(page.locator('#format-badge')).toHaveText('USD');

  await page.reload();
  await upload(page, 'official-saeukkang.usdz');
  await expect(page.locator('#format-badge')).toHaveText('USDZ');
});

test('loads multi-file glTF with external BIN and PNG resources', async ({ page }) => {
  const fixture = gltfFixture();
  await page.goto('/');
  await page.locator('#resource-files').setInputFiles([
    { name: 'geometry.bin', mimeType: 'application/octet-stream', buffer: fixture.binary },
    { name: 'pixel.png', mimeType: 'image/png', buffer: fixture.texture }
  ]);
  await page.locator('#model-file').setInputFiles({ name: 'triangle.gltf', mimeType: 'model/gltf+json', buffer: fixture.json });
  await expect(page.locator('#format-badge')).toHaveText('GLTF');
  await expect(page.locator('#stats span').last()).toContainText('1');
  await expectVisibleCanvas(page);
});

test('renders malicious resource paths as text without executable DOM', async ({ page }) => {
  await page.goto('/');
  await page.locator('#model-file').setInputFiles({
    name: 'malicious.obj', mimeType: 'model/obj',
    buffer: Buffer.from('mtllib </span><img src=x onerror="globalThis.__xss=1">\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
  });
  await expect(page.locator('.message strong')).toHaveText('MISSING_EXTERNAL_RESOURCE');
  await expect(page.locator('.message span')).toContainText('<img src=x onerror=');
  await expect(page.locator('.message img')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __xss?: number }).__xss)).toBeUndefined();
});

test('exposes the compatible Viewer API and calls export onError once', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { OrbitFrame: {
      import3DToHTML: typeof import('../../src').import3DToHTML;
      export3DToGIF: typeof import('../../src').export3DToGIF;
    } }).OrbitFrame;
    const values = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0.25, 0]);
    const bytes = new Uint8Array(values.buffer);
    let encoded = '';
    for (const byte of bytes) encoded += String.fromCharCode(byte);
    const uri = `data:application/octet-stream;base64,${btoa(encoded)}`;
    const json = JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      buffers: [{ uri, byteLength: bytes.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 8 }, { buffer: 0, byteOffset: 44, byteLength: 24 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' }
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      animations: [{ name: 'move', samplers: [{ input: 1, output: 2 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }]
    });
    const container = document.createElement('div');
    Object.assign(container.style, { width: '128px', height: '128px' });
    document.body.append(container);
    const viewer = await api.import3DToHTML({ type: 'blob', blob: new Blob([json], { type: 'model/gltf+json' }), filename: 'animated.gltf' }, { container });
    let directErrors = 0;
    let directCode = '';
    try { await api.export3DToGIF(viewer, { width: 1, onError: (error: { code: string }) => { directErrors++; directCode = error.code; } }); } catch { /* expected */ }
    let inputErrors = 0;
    try { await api.export3DToGIF(new File(['bad'], 'bad.glb'), { onError: () => { inputErrors++; } }); } catch { /* expected */ }
    const nativeCreate = URL.createObjectURL.bind(URL);
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    let createdUrls = 0, revokedUrls = 0, initErrors = 0;
    URL.createObjectURL = (object) => { createdUrls++; return nativeCreate(object); };
    URL.revokeObjectURL = (url) => { revokedUrls++; nativeRevoke(url); };
    try {
      const empty = new File([JSON.stringify({ asset: { version: '2.0' }, scenes: [], buffers: [{ uri: 'unused.bin', byteLength: 1 }] })], 'empty.gltf');
      await api.import3DToHTML({ type: 'bundle', entryFile: empty, relatedFiles: [new File([new Uint8Array([0]).buffer], 'unused.bin')] }, { container, onError: () => { initErrors++; } });
    } catch { /* expected */ }
    URL.createObjectURL = nativeCreate;
    URL.revokeObjectURL = nativeRevoke;

    const NativeWorker = Worker;
    class FaultyWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'orbitframe-gif') setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Injected worker failure' })), 0);
      }
    }
    Object.defineProperty(globalThis, 'Worker', { value: FaultyWorker, configurable: true });
    let encoderErrors = 0, encoderCode = '';
    try {
      await api.export3DToGIF(viewer, { width: 16, height: 16, fps: 1, duration: 1, onError: (error) => { encoderErrors++; encoderCode = error.code; } });
    } catch { /* expected */ }
    Object.defineProperty(globalThis, 'Worker', { value: NativeWorker, configurable: true });
    const shape = {
      aliases: viewer.canvas === viewer.element && viewer.modelRoot === viewer.model && viewer.metadata === viewer.stats,
      fields: viewer.container === container && viewer.animations.length === 1 && !!viewer.mixer,
      methods: [viewer.resetView, viewer.setBackground, viewer.playAnimation, viewer.stopAnimation, viewer.resize].every((method) => typeof method === 'function'),
      directErrors, directCode, inputErrors, initErrors, createdUrls, revokedUrls, encoderErrors, encoderCode
    };
    viewer.dispose(); container.remove();
    return shape;
  });
  expect(result).toEqual({
    aliases: true, fields: true, methods: true,
    directErrors: 1, directCode: 'MEMORY_LIMIT_EXCEEDED', inputErrors: 1,
    initErrors: 1, createdUrls: 1, revokedUrls: 1,
    encoderErrors: 1, encoderCode: 'GIF_ENCODER_FAILED'
  });
});

test('exports deterministic GIF metadata, preview and download', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'multi-material.glb');
  await page.locator('#width').fill('128');
  await page.locator('#height').fill('96');
  await page.locator('#duration').fill('1');
  await page.locator('#fps').fill('6');
  await page.locator('#colors').fill('64');
  await page.locator('#generate').click();
  await expect(page.locator('#result img')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#progress-value')).toHaveText('100%');
  await expect(page.locator('#download')).not.toHaveClass(/disabled/);
  const firstHash = await page.locator('#result img').evaluate(async (image: HTMLImageElement) => {
    const digest = await crypto.subtle.digest('SHA-256', await (await fetch(image.src)).arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  });
  await page.locator('#generate').click();
  await expect(page.locator('#progress-value')).toHaveText('100%');
  const secondHash = await page.locator('#result img').evaluate(async (image: HTMLImageElement) => {
    const digest = await crypto.subtle.digest('SHA-256', await (await fetch(image.src)).arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  });
  expect(secondHash).toBe(firstHash);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = decompressFrames(parsed, false);
  expect(parsed.lsd.width).toBe(128);
  expect(parsed.lsd.height).toBe(96);
  expect(frames).toHaveLength(6);
  expect(frames.reduce((sum, frame) => sum + frame.delay, 0)).toBeGreaterThanOrEqual(960);
  expect(bytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
});

test('matches preview and GIF first-frame color and luminance', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'standard.glb');
  const canvas = page.locator('#viewer canvas');
  const preview = PNG.sync.read(await canvas.screenshot());
  await page.locator('#width').fill(String(preview.width));
  await page.locator('#height').fill(String(preview.height));
  await page.locator('#duration').fill('1');
  await page.locator('#fps').fill('1');
  await page.locator('#colors').fill('256');
  await page.locator('#generate').click();
  await expect(page.locator('#result img')).toBeVisible();

  const gif = firstGifFrame(await gifBytes(page));
  expect([gif.width, gif.height]).toEqual([preview.width, preview.height]);
  const background = preview.data.subarray(0, 3);
  let count = 0, absoluteError = 0, previewLuminance = 0, gifLuminance = 0;
  for (let i = 0; i < preview.data.length; i += 4) {
    const delta = Math.abs(preview.data[i] - background[0]) + Math.abs(preview.data[i + 1] - background[1]) + Math.abs(preview.data[i + 2] - background[2]);
    if (delta <= 45) continue;
    count++;
    for (let channel = 0; channel < 3; channel++) absoluteError += Math.abs(preview.data[i + channel] - gif.rgba[i + channel]);
    previewLuminance += 0.2126 * preview.data[i] + 0.7152 * preview.data[i + 1] + 0.0722 * preview.data[i + 2];
    gifLuminance += 0.2126 * gif.rgba[i] + 0.7152 * gif.rgba[i + 1] + 0.0722 * gif.rgba[i + 2];
  }
  expect(count / (preview.width * preview.height)).toBeGreaterThan(0.01);
  expect(absoluteError / (count * 3)).toBeLessThan(20);
  expect(gifLuminance / previewLuminance).toBeGreaterThan(0.88);
  expect(gifLuminance / previewLuminance).toBeLessThan(1.12);
});

test('loads USD external textures and reports a missing texture', async ({ page }) => {
  const texture = new PNG({ width: 2, height: 2 });
  texture.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
  ]);
  const usd = await readFile(resolve(fixtures, 'textured.usda'));

  await page.goto('/');
  await page.locator('#resource-files').setInputFiles({ name: 'Image_0.png', mimeType: 'image/png', buffer: PNG.sync.write(texture) });
  await page.locator('#model-file').setInputFiles({ name: 'textured.usda', mimeType: 'model/vnd.usd', buffer: usd });
  await expect(page.locator('#format-badge')).toHaveText('USD');
  await expect(page.locator('#stats span').last()).toContainText('1');
  const rendered = PNG.sync.read(await page.locator('#viewer canvas').screenshot());
  let red = 0, green = 0;
  for (let i = 0; i < rendered.data.length; i += 4) {
    if (rendered.data[i] > rendered.data[i + 1] * 1.35 && rendered.data[i] > rendered.data[i + 2] * 1.35) red++;
    if (rendered.data[i + 1] > rendered.data[i] * 1.35 && rendered.data[i + 1] > rendered.data[i + 2] * 1.35) green++;
  }
  expect(red).toBeGreaterThan(20);
  expect(green).toBeGreaterThan(20);

  await page.reload();
  await page.locator('#model-file').setInputFiles({ name: 'textured.usda', mimeType: 'model/vnd.usd', buffer: usd });
  await expect(page.locator('.message strong')).toHaveText('MISSING_EXTERNAL_RESOURCE');
  await expect(page.locator('.message span')).toContainText('Image_0.png');
  await expect(page.locator('#viewer canvas')).toHaveCount(0);
});

test('keeps metallic detail visible in preview and GIF', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'metal.usda');
  const preview = PNG.sync.read(await page.locator('#viewer canvas').screenshot());
  const previewStats = foregroundStats(preview.data, preview.width, preview.height);
  expect(previewStats.count / (preview.width * preview.height)).toBeGreaterThan(0.01);
  expect(previewStats.meanLuminance).toBeGreaterThan(45);
  expect(previewStats.nearBlackRatio).toBeLessThan(0.55);

  await page.locator('#width').fill('160');
  await page.locator('#height').fill('160');
  await page.locator('#duration').fill('1');
  await page.locator('#fps').fill('1');
  await page.locator('#generate').click();
  await expect(page.locator('#result img')).toBeVisible();
  const gif = firstGifFrame(await gifBytes(page));
  const gifStats = foregroundStats(gif.rgba, gif.width, gif.height);
  expect(gifStats.count / (gif.width * gif.height)).toBeGreaterThan(0.01);
  expect(gifStats.meanLuminance).toBeGreaterThan(45);
  expect(gifStats.nearBlackRatio).toBeLessThan(0.55);
});

test('supports transparent output and cancellation', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'standard.glb');
  await page.locator('#transparent').check();
  await page.locator('#width').fill('96'); await page.locator('#height').fill('96');
  await page.locator('#duration').fill('0.5'); await page.locator('#fps').fill('4');
  await page.locator('#generate').click();
  await expect(page.locator('#result img')).toBeVisible();
  const hasTransparency = await page.locator('#result img').evaluate(async (image: HTMLImageElement) => {
    const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
    for (let i = 0; i < bytes.length - 4; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) return (bytes[i + 3] & 1) === 1;
    return false;
  });
  expect(hasTransparency).toBe(true);
  await page.locator('#duration').fill('30'); await page.locator('#fps').fill('30');
  await page.locator('#generate').click();
  await expect(page.locator('#cancel')).toBeEnabled();
  await page.locator('#cancel').click();
  await expect(page.locator('.message.warning strong')).toHaveText('EXPORT_ABORTED');
  await expect(page.locator('#cancel')).toBeDisabled();
});

test('surfaces an injected GIF worker failure', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    class FaultyWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'orbitframe-gif') setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Injected worker failure' })), 0);
      }
    }
    Object.defineProperty(globalThis, 'Worker', { value: FaultyWorker });
  });
  await page.goto('/');
  await upload(page, 'standard.glb');
  await page.locator('#generate').click();
  await expect(page.locator('.message strong')).toHaveText('GIF_ENCODER_FAILED');
  await expect(page.locator('#cancel')).toBeDisabled();
});

test('reports distinct invalid, missing resource, empty and mismatch errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('#model-file').setInputFiles(resolve(fixtures, 'missing-material.obj'));
  await expect(page.locator('.message strong')).toHaveText('MISSING_EXTERNAL_RESOURCE');
  await page.locator('#model-file').setInputFiles(resolve(fixtures, 'empty.glb'));
  await expect(page.locator('.message strong').first()).toHaveText('EMPTY_SCENE');
  await page.locator('#model-file').setInputFiles(resolve(fixtures, 'mismatch.obj'));
  await expect(page.locator('.message strong').first()).toHaveText('FORMAT_MISMATCH');
  await page.locator('#model-file').setInputFiles(resolve(fixtures, 'corrupt.glb'));
  await expect(page.locator('.message strong').first()).toHaveText('UNSUPPORTED_FORMAT');
});

test('completes the 512x512 60-frame acceptance workload', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'standard.glb');
  const started = Date.now();
  await page.locator('#generate').click();
  await expect(page.locator('#result img')).toBeVisible({ timeout: 120_000 });
  expect(Date.now() - started).toBeLessThan(120_000);
  await expect(page.locator('#result-size')).toContainText('512×512');
});

test('renders all six paths and releases repeated viewer loads', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'extreme-tall.glb');
  await upload(page, 'extreme-flat.glb');
  await page.locator('#width').fill('64'); await page.locator('#height').fill('64');
  await page.locator('#duration').fill('0.5'); await page.locator('#fps').fill('4');
  for (const motion of ['model-turntable', 'camera-orbit', 'camera-tilt-orbit', 'ping-pong', 'multi-axis-sway', 'spiral-orbit']) {
    await page.locator('#motion').selectOption(motion);
    await page.locator('#generate').click();
    await expect(page.locator('#progress-value')).toHaveText('100%');
    await expect(page.locator('#result img')).toBeVisible();
  }
  await page.evaluate(() => (globalThis as typeof globalThis & { gc?: () => void }).gc?.());
  const before = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  for (let i = 0; i < 20; i++) {
    await page.locator('#model-file').setInputFiles([]);
    await page.locator('#model-file').setInputFiles(resolve(fixtures, 'standard.glb'));
    await expect(page.locator('#format-badge')).toHaveText('GLB');
  }
  await page.evaluate(() => (globalThis as typeof globalThis & { gc?: () => void }).gc?.());
  const after = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  if (before && after) expect(after - before).toBeLessThan(64 * 1024 * 1024);
});

test('visual baseline has no overlap on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await upload(page, 'origin-offset.glb');
  await expect(page).toHaveScreenshot('desktop-loaded.png', { fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('mobile-loaded.png', { fullPage: true });
});
