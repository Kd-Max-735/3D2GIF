export type OrbitFrameErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FORMAT_MISMATCH'
  | 'INVALID_MODEL'
  | 'EMPTY_SCENE'
  | 'MISSING_EXTERNAL_RESOURCE'
  | 'CORS_BLOCKED'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'URL_NOT_ALLOWED'
  | 'UNEXPECTED_CONTENT_TYPE'
  | 'DRACO_DECODER_MISSING'
  | 'KTX2_TRANSCODER_MISSING'
  | 'MODEL_TOO_LARGE'
  | 'TEXTURE_TOO_LARGE'
  | 'WEBGL_UNAVAILABLE'
  | 'WEBGL_CONTEXT_LOST'
  | 'RENDER_TARGET_FAILED'
  | 'PIXEL_READ_FAILED'
  | 'INVALID_MOTION_CONFIG'
  | 'NON_LOOPING_PATH'
  | 'GIF_ENCODER_FAILED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'EXPORT_ABORTED';

export type OrbitFrameStage = 'input' | 'network' | 'parse' | 'validate' | 'viewer' | 'motion' | 'render' | 'encode' | 'cancel' | 'unknown';

const STAGES: Partial<Record<OrbitFrameErrorCode, OrbitFrameStage>> = {
  CORS_BLOCKED: 'network', NETWORK_TIMEOUT: 'network', NETWORK_ERROR: 'network', URL_NOT_ALLOWED: 'network', UNEXPECTED_CONTENT_TYPE: 'network',
  UNSUPPORTED_FORMAT: 'input', FORMAT_MISMATCH: 'input', MODEL_TOO_LARGE: 'validate', TEXTURE_TOO_LARGE: 'validate',
  DRACO_DECODER_MISSING: 'parse', KTX2_TRANSCODER_MISSING: 'parse', INVALID_MODEL: 'parse', MISSING_EXTERNAL_RESOURCE: 'parse',
  WEBGL_UNAVAILABLE: 'viewer', WEBGL_CONTEXT_LOST: 'viewer', EMPTY_SCENE: 'validate', RENDER_TARGET_FAILED: 'render', PIXEL_READ_FAILED: 'render',
  INVALID_MOTION_CONFIG: 'motion', NON_LOOPING_PATH: 'motion', GIF_ENCODER_FAILED: 'encode', MEMORY_LIMIT_EXCEEDED: 'validate', EXPORT_ABORTED: 'cancel'
};

export class OrbitFrameError extends Error {
  readonly name = 'OrbitFrameError';
  readonly stage: OrbitFrameStage;
  readonly recoverable: boolean;
  readonly suggestions?: string[];

  constructor(
    public readonly code: OrbitFrameErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
    metadata?: { stage?: OrbitFrameStage; recoverable?: boolean; suggestions?: string[] }
  ) {
    super(message, options);
    this.stage = metadata?.stage ?? STAGES[code] ?? 'unknown';
    this.recoverable = metadata?.recoverable ?? !['WEBGL_UNAVAILABLE', 'MEMORY_LIMIT_EXCEEDED'].includes(code);
    this.suggestions = metadata?.suggestions;
  }
}

export function abortError(): OrbitFrameError {
  return new OrbitFrameError('EXPORT_ABORTED', '操作已取消。');
}

export function asOrbitFrameError(error: unknown, fallback: OrbitFrameErrorCode = 'INVALID_MODEL'): OrbitFrameError {
  if (error instanceof OrbitFrameError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new OrbitFrameError(fallback, message || '未知错误。', undefined, { cause: error });
}
