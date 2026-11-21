import type { AnimationClip, AnimationMixer, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type SupportedFormat = 'glb' | 'gltf' | 'obj' | 'usd' | 'usdz';

export interface InputPackage {
  file: File;
  resources?: File[];
}

export type ModelInput =
  | File
  | Blob
  | string
  | InputPackage
  | { type: 'file'; file: File }
  | { type: 'blob'; blob: Blob; filename?: string }
  | { type: 'url'; url: string }
  | { type: 'arrayBuffer'; data: ArrayBuffer; filename: string }
  | { type: 'bundle'; entryFile: File; relatedFiles: File[] };

export interface UrlPolicy {
  allowHttp?: boolean;
  sameOriginOnly?: boolean;
  allowedHosts?: string[];
  timeoutMs?: number;
}

export interface ModelStats {
  format: SupportedFormat;
  name: string;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: number;
  sourceBytes: number;
  dimensions: { x: number; y: number; z: number };
}

export type LightPreset = 'studio' | 'soft' | 'dramatic';

export interface ViewerConfig {
  container: HTMLElement;
  background?: string | 'transparent';
  bottomAlign?: boolean;
  groundShadow?: boolean;
  lightPreset?: LightPreset;
  maxModelBytes?: number;
  maxTextureBytes?: number;
  maxTotalBundleBytes?: number;
  maxFiles?: number;
  maxTextureDimension?: number;
  maxTriangles?: number;
  maxAnimations?: number;
  urlPolicy?: UrlPolicy;
  pixelRatio?: number;
  signal?: AbortSignal;
  onError?: (error: OrbitFrameErrorLike) => void;
}

export interface ViewerHandle {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly element: HTMLCanvasElement;
  readonly scene: Scene;
  readonly modelRoot: Object3D;
  readonly model: Object3D;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  readonly animations: AnimationClip[];
  readonly mixer?: AnimationMixer;
  readonly metadata: ModelStats;
  readonly stats: ModelStats;
  readonly disposed: boolean;
  render(): void;
  resetView(): void;
  reset(): void;
  resize(width?: number, height?: number): void;
  setBackground(value: string | 'transparent'): void;
  playAnimation(nameOrIndex?: string | number): void;
  stopAnimation(): void;
  dispose(): void;
}

export type MotionKind =
  | 'model-turntable'
  | 'camera-orbit'
  | 'camera-tilt-orbit'
  | 'ping-pong'
  | 'multi-axis-sway'
  | 'spiral-orbit';

export interface MotionConfig {
  type: MotionKind;
  direction?: 1 | -1;
  turns?: number;
  angle?: number;
  amplitude?: number;
  tilt?: number;
  height?: number;
}

export interface GifExportConfig {
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  frameCount?: number;
  repeat?: number;
  loop?: boolean;
  background?: string | 'transparent';
  maxColors?: number;
  quality?: number;
  dithering?: boolean;
  motion?: MotionConfig;
  signal?: AbortSignal;
  onProgress?: (progress: GifExportProgress) => void;
  onError?: (error: OrbitFrameErrorLike) => void;
  viewer?: Omit<ViewerConfig, 'container'>;
}

export interface GifExportProgress {
  phase: 'loading' | 'rendering' | 'encoding' | 'done';
  completed: number;
  total: number;
  percent: number;
}

export interface GifExportResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  frameCount: number;
  duration: number;
  fps: number;
  fileSize: number;
  dispose(): void;
}

export interface OrbitFrameErrorLike {
  code: string;
  message: string;
  stage?: string;
  recoverable?: boolean;
  suggestions?: string[];
  details?: Record<string, unknown>;
  cause?: unknown;
}
