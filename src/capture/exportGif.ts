import {
  Color,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget
} from 'three';
import { OrbitFrameError, abortError, asOrbitFrameError } from '../errors';
import { WorkerGifEncoder } from '../gif/WorkerGifEncoder';
import { createMotionRunner } from '../motion';
import type { GifExportConfig, GifExportResult, ViewerHandle } from '../schema/types';

const DEFAULT_MOTION = { type: 'model-turntable' as const, direction: 1 as const, turns: 1 };

function integer(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new OrbitFrameError('MEMORY_LIMIT_EXCEEDED', `${label} 必须在 ${min} 到 ${max} 之间。`, { value });
  return value;
}

function flipRows(source: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(source.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) output.set(source.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return output;
}

function setBackground(scene: Scene, background: string | 'transparent') {
  scene.background = background === 'transparent' ? null : new Color(background);
}

function createSRGBOutputPass(input: WebGLRenderTarget) {
  const material = new ShaderMaterial({
    uniforms: { inputTexture: { value: input.texture } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D inputTexture;
      varying vec2 vUv;
      void main() {
        vec4 linear = texture2D(inputTexture, vUv);
        vec3 srgb = mix(
          pow(linear.rgb, vec3(0.41666)) * 1.055 - vec3(0.055),
          linear.rgb * 12.92,
          vec3(lessThanEqual(linear.rgb, vec3(0.0031308)))
        );
        gl_FragColor = vec4(srgb, linear.a);
      }
    `,
    depthTest: false,
    depthWrite: false
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  return { scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), dispose: () => { geometry.dispose(); material.dispose(); } };
}

export async function captureGif(viewer: ViewerHandle, config: GifExportConfig = {}): Promise<GifExportResult> {
  try {
    return await captureGifInternal(viewer, config);
  } catch (error) {
    const mapped = asOrbitFrameError(error, 'GIF_ENCODER_FAILED');
    config.onError?.(mapped);
    throw mapped;
  }
}

async function captureGifInternal(viewer: ViewerHandle, config: GifExportConfig): Promise<GifExportResult> {
  if (viewer.disposed) throw new OrbitFrameError('INVALID_MODEL', '查看器已释放。');
  const width = integer(config.width ?? 512, 16, 2048, '宽度');
  const height = integer(config.height ?? 512, 16, 2048, '高度');
  const fps = integer(config.fps ?? 15, 1, 60, 'FPS');
  const duration = config.duration ?? 4;
  const frameCount = integer(config.frameCount ?? Math.round(duration * fps), 1, 1800, '帧数');
  const maxColors = integer(config.maxColors ?? config.quality ?? 256, 2, 256, '颜色数');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new OrbitFrameError('INVALID_MOTION_CONFIG', '时长必须在 0 到 120 秒之间。');
  const peakEstimate = width * height * 21;
  if (peakEstimate > 256 * 1024 * 1024) throw new OrbitFrameError('MEMORY_LIMIT_EXCEEDED', '单帧工作内存预计超过 256 MiB。', { peakEstimate });
  if (config.signal?.aborted) throw abortError();

  const background = config.background ?? '#eceeef';
  const originalBackground = viewer.scene.background;
  const originalAspect = viewer.camera.aspect;
  const originalControls = viewer.controls.enabled;
  const originalRenderTarget = viewer.renderer.getRenderTarget();
  const originalClearAlpha = viewer.renderer.getClearAlpha();
  let linearTarget: WebGLRenderTarget | undefined;
  let outputTarget: WebGLRenderTarget | undefined;
  let outputPass: ReturnType<typeof createSRGBOutputPass> | undefined;
  let runner: ReturnType<typeof createMotionRunner> | undefined;
  let encoder: WorkerGifEncoder | undefined;

  try {
    try {
      linearTarget = new WebGLRenderTarget(width, height, { format: RGBAFormat, type: UnsignedByteType, depthBuffer: true, stencilBuffer: false });
      outputTarget = new WebGLRenderTarget(width, height, { format: RGBAFormat, type: UnsignedByteType, depthBuffer: false, stencilBuffer: false });
      linearTarget.texture.colorSpace = NoColorSpace;
      outputTarget.texture.colorSpace = NoColorSpace;
      linearTarget.texture.generateMipmaps = false;
      outputTarget.texture.generateMipmaps = false;
      outputPass = createSRGBOutputPass(linearTarget);
    } catch (cause) {
      throw new OrbitFrameError('RENDER_TARGET_FAILED', 'Failed to initialize GIF render targets.', undefined, { cause });
    }
    runner = createMotionRunner(viewer, config.motion ?? DEFAULT_MOTION);
    encoder = new WorkerGifEncoder({
      width, height, delay: 1000 / fps,
      repeat: config.loop === false ? -1 : (config.repeat ?? 0),
      maxColors,
      transparent: background === 'transparent',
      dithering: config.dithering ?? false,
      signal: config.signal
    });
    viewer.controls.enabled = false;
    viewer.camera.aspect = width / height;
    viewer.camera.updateProjectionMatrix();
    setBackground(viewer.scene, background);
    viewer.renderer.setClearAlpha(background === 'transparent' ? 0 : 1);
    for (let frame = 0; frame < frameCount; frame++) {
      if (config.signal?.aborted) throw abortError();
      runner.apply(frame / frameCount);
      try {
        viewer.renderer.setRenderTarget(linearTarget);
        viewer.renderer.render(viewer.scene, viewer.camera);
        viewer.renderer.setRenderTarget(outputTarget);
        viewer.renderer.render(outputPass.scene, outputPass.camera);
      } catch (cause) {
        throw new OrbitFrameError('RENDER_TARGET_FAILED', 'Failed while rendering a GIF frame.', { frame }, { cause });
      }
      const raw = new Uint8Array(width * height * 4);
      try {
        viewer.renderer.readRenderTargetPixels(outputTarget, 0, 0, width, height, raw);
      } catch (cause) {
        throw new OrbitFrameError('PIXEL_READ_FAILED', 'Failed to read GIF frame pixels.', { frame }, { cause });
      }
      if (config.signal?.aborted) throw abortError();
      const pixels = flipRows(raw, width, height);
      config.onProgress?.({ phase: 'rendering', completed: frame + 1, total: frameCount, percent: ((frame + 1) / frameCount) * 85 });
      await encoder.addFrame(frame, pixels);
      config.onProgress?.({ phase: 'encoding', completed: frame + 1, total: frameCount, percent: 85 + ((frame + 1) / frameCount) * 14 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (config.signal?.aborted) throw abortError();
    const bytes = await encoder.finish();
    if (config.signal?.aborted) throw abortError();
    const blob = new Blob([bytes], { type: 'image/gif' });
    if (config.signal?.aborted) throw abortError();
    const url = URL.createObjectURL(blob);
    config.onProgress?.({ phase: 'done', completed: frameCount, total: frameCount, percent: 100 });
    let resultDisposed = false;
    return {
      blob, url, width, height, frameCount, duration: frameCount / fps, fps, fileSize: blob.size,
      dispose() { if (!resultDisposed) { URL.revokeObjectURL(url); resultDisposed = true; } }
    };
  } finally {
    const safely = (cleanup: () => void) => { try { cleanup(); } catch { /* Cleanup must continue. */ } };
    safely(() => encoder?.dispose());
    safely(() => runner?.restore());
    safely(() => viewer.renderer.setRenderTarget(originalRenderTarget));
    safely(() => linearTarget?.dispose());
    safely(() => outputTarget?.dispose());
    safely(() => outputPass?.dispose());
    safely(() => viewer.renderer.setClearAlpha(originalClearAlpha));
    viewer.scene.background = originalBackground;
    viewer.camera.aspect = originalAspect;
    safely(() => viewer.camera.updateProjectionMatrix());
    viewer.controls.enabled = originalControls;
    safely(() => viewer.render());
  }
}
