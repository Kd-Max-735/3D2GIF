/// <reference lib="webworker" />
import { GIFEncoder, applyPalette, nearestColorIndex, quantize } from 'gifenc';

type Palette = number[][];
type StartMessage = { type: 'start'; width: number; height: number; delay: number; repeat: number; maxColors: number; transparent: boolean; dithering: boolean };
type FrameMessage = { type: 'frame'; id: number; pixels: ArrayBuffer };
type FinishMessage = { type: 'finish' };
type CancelMessage = { type: 'cancel' };

let encoder: ReturnType<typeof GIFEncoder> | undefined;
let options: Omit<StartMessage, 'type'> | undefined;
let cancelled = false;

function dither(rgba: Uint8Array, palette: Palette, format: 'rgb565' | 'rgba4444'): Uint8Array {
  const { width, height } = options!;
  const work = new Float32Array(rgba);
  const indexed = new Uint8Array(width * height);
  const channels = format === 'rgba4444' ? 4 : 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const offset = pixelIndex * 4;
      const pixel = Array.from(work.subarray(offset, offset + channels)).map((value) => Math.max(0, Math.min(255, Math.round(value))));
      const index = nearestColorIndex(palette, pixel);
      indexed[pixelIndex] = index;
      const color = palette[index];
      for (let channel = 0; channel < channels; channel++) {
        const error = pixel[channel] - color[channel];
        const spread = (nx: number, ny: number, factor: number) => {
          if (nx < 0 || nx >= width || ny >= height) return;
          work[(ny * width + nx) * 4 + channel] += error * factor;
        };
        spread(x + 1, y, 7 / 16);
        spread(x - 1, y + 1, 3 / 16);
        spread(x, y + 1, 5 / 16);
        spread(x + 1, y + 1, 1 / 16);
      }
    }
  }
  return indexed;
}

self.onmessage = (event: MessageEvent<StartMessage | FrameMessage | FinishMessage | CancelMessage>) => {
  try {
    const message = event.data;
    if (message.type === 'start') {
      options = message;
      encoder = GIFEncoder();
      cancelled = false;
      self.postMessage({ type: 'ready' });
      return;
    }
    if (message.type === 'cancel') {
      cancelled = true;
      encoder = undefined;
      return;
    }
    if (!encoder || !options || cancelled) return;
    if (message.type === 'frame') {
      const rgba = new Uint8Array(message.pixels);
      const format = options.transparent ? 'rgba4444' : 'rgb565';
      const palette = quantize(rgba, options.maxColors, options.transparent ? { format, oneBitAlpha: true } : { format });
      const indexed = options.dithering ? dither(rgba, palette, format) : applyPalette(rgba, palette, format);
      const transparentIndex = options.transparent ? Math.max(0, palette.findIndex((color) => color[3] === 0)) : 0;
      encoder.writeFrame(indexed, options.width, options.height, {
        palette,
        delay: options.delay,
        repeat: options.repeat,
        transparent: options.transparent,
        transparentIndex,
        dispose: options.transparent ? 2 : 1
      });
      self.postMessage({ type: 'frame-done', id: message.id });
      return;
    }
    if (message.type === 'finish') {
      encoder.finish();
      const bytes = encoder.bytes();
      self.postMessage({ type: 'done', bytes: bytes.buffer }, [bytes.buffer]);
      encoder = undefined;
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

export {};
