import { asOrbitFrameError } from './errors';
import { loadModel } from './import';
import { createViewer } from './viewer/createViewer';
import { captureGif } from './capture/exportGif';
import type { GifExportConfig, GifExportResult, ModelInput, ViewerConfig, ViewerHandle } from './schema/types';

export * from './errors';
export * from './motion';
export * from './schema/types';

export async function import3DToHTML(input: ModelInput, config: ViewerConfig): Promise<ViewerHandle> {
  try {
    const loaded = await loadModel(input, {
      maxModelBytes: config.maxModelBytes ?? 100 * 1024 * 1024,
      maxTextureBytes: config.maxTextureBytes ?? 32 * 1024 * 1024,
      maxTotalBundleBytes: config.maxTotalBundleBytes ?? 300 * 1024 * 1024,
      maxFiles: config.maxFiles ?? 200,
      maxTextureDimension: config.maxTextureDimension ?? 8192,
      maxTriangles: config.maxTriangles ?? 3_000_000,
      maxAnimations: config.maxAnimations ?? 100,
      urlPolicy: config.urlPolicy
    }, config.signal);
    return createViewer(loaded, { format: loaded.resolved.format, name: loaded.resolved.file.name, bytes: loaded.resolved.file.size }, config);
  } catch (error) {
    const mapped = asOrbitFrameError(error);
    config.onError?.(mapped);
    throw mapped;
  }
}

export async function export3DToGIF(viewerOrInput: ViewerHandle | ModelInput, config: GifExportConfig = {}): Promise<GifExportResult> {
  if (typeof viewerOrInput === 'object' && 'renderer' in viewerOrInput && 'dispose' in viewerOrInput) return captureGif(viewerOrInput as ViewerHandle, config);
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${config.width ?? 512}px;height:${config.height ?? 512}px`;
  document.body.append(container);
  let viewer: ViewerHandle | undefined;
  try {
    config.onProgress?.({ phase: 'loading', completed: 0, total: 1, percent: 0 });
    viewer = await import3DToHTML(viewerOrInput as ModelInput, { container, ...(config.viewer ?? {}), signal: config.signal, background: config.background, onError: undefined });
    return await captureGif(viewer, { ...config, onError: undefined });
  } catch (error) {
    const mapped = asOrbitFrameError(error, 'GIF_ENCODER_FAILED');
    config.onError?.(mapped);
    throw mapped;
  } finally {
    viewer?.dispose();
    container.remove();
  }
}
