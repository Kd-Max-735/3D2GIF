import { OrbitFrameError, abortError } from '../errors';

interface EncoderOptions {
  width: number;
  height: number;
  delay: number;
  repeat: number;
  maxColors: number;
  transparent: boolean;
  dithering: boolean;
  signal?: AbortSignal;
}

export class WorkerGifEncoder {
  private worker: Worker;
  private frameResolvers = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private done?: { resolve(bytes: ArrayBuffer): void; reject(error: Error): void };
  private fatal?: Error;
  private disposed = false;

  constructor(private readonly options: EncoderOptions) {
    this.worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module', name: 'orbitframe-gif' });
    try {
      this.worker.onmessage = (event) => this.onMessage(event.data as { type: string; id?: number; bytes?: ArrayBuffer; message?: string });
      this.worker.onerror = (event) => this.fail(new OrbitFrameError('GIF_ENCODER_FAILED', event.message || 'GIF Worker 异常。'));
      options.signal?.addEventListener('abort', this.abort, { once: true });
      this.worker.postMessage({ type: 'start', ...options, signal: undefined });
    } catch (error) {
      options.signal?.removeEventListener('abort', this.abort);
      this.worker.terminate();
      throw new OrbitFrameError('GIF_ENCODER_FAILED', 'Failed to initialize the GIF worker.', undefined, { cause: error });
    }
  }

  private onMessage(message: { type: string; id?: number; bytes?: ArrayBuffer; message?: string }) {
    if (message.type === 'frame-done' && message.id !== undefined) {
      this.frameResolvers.get(message.id)?.resolve();
      this.frameResolvers.delete(message.id);
    } else if (message.type === 'done' && message.bytes) this.done?.resolve(message.bytes);
    else if (message.type === 'error') this.fail(new OrbitFrameError('GIF_ENCODER_FAILED', message.message || 'GIF 编码失败。'));
  }

  private fail(error: Error) {
    if (this.fatal) return;
    this.fatal = error;
    this.frameResolvers.forEach(({ reject }) => reject(error));
    this.frameResolvers.clear();
    this.done?.reject(error);
  }

  private abort = () => {
    const error = abortError();
    try { this.worker.postMessage({ type: 'cancel' }); } catch { /* Worker may already be gone. */ }
    this.fail(error);
    this.dispose();
  };

  async addFrame(id: number, pixels: Uint8Array): Promise<void> {
    if (this.options.signal?.aborted) throw abortError();
    if (this.fatal) throw this.fatal;
    const promise = new Promise<void>((resolve, reject) => this.frameResolvers.set(id, { resolve, reject }));
    try {
      this.worker.postMessage({ type: 'frame', id, pixels: pixels.buffer }, [pixels.buffer]);
    } catch (error) {
      this.frameResolvers.delete(id);
      throw new OrbitFrameError('GIF_ENCODER_FAILED', 'Failed to send a frame to the GIF worker.', undefined, { cause: error });
    }
    return promise;
  }

  finish(): Promise<ArrayBuffer> {
    if (this.options.signal?.aborted) return Promise.reject(abortError());
    if (this.fatal) return Promise.reject(this.fatal);
    return new Promise((resolve, reject) => {
      this.done = { resolve, reject };
      this.worker.postMessage({ type: 'finish' });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.signal?.removeEventListener('abort', this.abort);
    this.worker.terminate();
    const error = this.fatal ?? new OrbitFrameError('GIF_ENCODER_FAILED', 'GIF encoder disposed.');
    this.frameResolvers.forEach(({ reject }) => reject(error));
    this.frameResolvers.clear();
    this.done?.reject(error);
  }
}
