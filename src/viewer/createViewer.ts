import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Clock
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitFrameError } from '../errors';
import type { LightPreset, ModelStats, SupportedFormat, ViewerConfig, ViewerHandle } from '../schema/types';
import { disposeObject } from './dispose';
import type { LoadedModel } from '../import/loaders';

function countStats(object: Object3D, format: SupportedFormat, name: string, bytes: number, dimensions: Vector3, animations: number): ModelStats {
  let meshes = 0, triangles = 0;
  const materials = new Set<unknown>(), textures = new Set<unknown>();
  object.traverse((node) => {
    if (!('isMesh' in node)) return;
    meshes++;
    const mesh = node as Mesh;
    const geometry = mesh.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && 'isTexture' in value) textures.add(value);
      });
    });
  });
  return { format, name, meshes, triangles: Math.round(triangles), materials: materials.size, textures: textures.size, animations, sourceBytes: bytes, dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z } };
}

function addLights(scene: Scene, preset: LightPreset) {
  const group = new Group();
  group.name = 'OrbitFrameLights';
  const values = preset === 'dramatic' ? [3.4, 0.55] : preset === 'soft' ? [1.8, 1.15] : [2.5, 0.85];
  const hemi = new HemisphereLight(0xffffff, 0x5c6470, values[1]);
  const key = new DirectionalLight(0xffffff, values[0]);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const fill = new DirectionalLight(0x9dc7ff, preset === 'dramatic' ? 0.35 : 0.75);
  fill.position.set(-4, 2, -3);
  group.add(hemi, key, fill, new AmbientLight(0xffffff, 0.15));
  scene.add(group);
  scene.environmentIntensity = preset === 'dramatic' ? 0.7 : preset === 'soft' ? 0.45 : 0.55;
}

export function createViewer(loaded: LoadedModel, info: { format: SupportedFormat; name: string; bytes: number }, config: ViewerConfig): ViewerHandle {
  if (!config.container) throw new OrbitFrameError('INVALID_MODEL', 'ViewerConfig.container 是必填项。');
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  } catch (error) {
    disposeObject(loaded.object);
    loaded.cleanup();
    throw new OrbitFrameError('WEBGL_UNAVAILABLE', '当前浏览器无法创建 WebGL 渲染器。', undefined, { cause: error });
  }
  const setupCleanup: Array<() => void> = [
    () => loaded.cleanup(),
    () => disposeObject(loaded.object),
    () => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
  ];
  try {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(config.pixelRatio ?? devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', '3D 模型预览');
  config.container.replaceChildren(renderer.domElement);

  const scene = new Scene();
  if (config.background !== 'transparent') scene.background = new Color(config.background ?? '#eceeef');
  addLights(scene, config.lightPreset ?? 'studio');

  loaded.object.updateMatrixWorld(true);
  const originalBox = new Box3().setFromObject(loaded.object);
  if (originalBox.isEmpty()) {
    throw new OrbitFrameError('EMPTY_SCENE', '模型场景中没有可渲染几何体。');
  }
  const dimensions = originalBox.getSize(new Vector3());
  if (![dimensions.x, dimensions.y, dimensions.z].every(Number.isFinite) || dimensions.lengthSq() === 0) {
    throw new OrbitFrameError('INVALID_MODEL', '模型包围盒无效。');
  }
  const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
  const normalized = new Group();
  normalized.name = 'OrbitFrameNormalizedModel';
  normalized.scale.setScalar(2 / maxDimension);
  const center = originalBox.getCenter(new Vector3());
  loaded.object.position.sub(center);
  if (config.bottomAlign ?? true) loaded.object.position.y += dimensions.y / 2;
  normalized.add(loaded.object);
  scene.add(normalized);
  normalized.updateMatrixWorld(true);

  const normalizedBox = new Box3().setFromObject(normalized);
  const roomEnvironment = new RoomEnvironment();
  const pmremGenerator = new PMREMGenerator(renderer);
  const environmentTarget = (() => {
    try {
      return pmremGenerator.fromScene(roomEnvironment);
    } finally {
      roomEnvironment.dispose();
      pmremGenerator.dispose();
    }
  })();
  setupCleanup.push(() => environmentTarget.dispose());
  scene.environment = environmentTarget.texture;
  const floorY = normalizedBox.min.y - 0.025;
  let floor: Mesh | undefined;
  if (config.groundShadow ?? true) {
    floor = new Mesh(new PlaneGeometry(200, 200), new ShadowMaterial({ color: 0x000000, opacity: 0.16 }));
    floor.name = 'OrbitFrameGround';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);
    setupCleanup.push(() => { floor?.geometry.dispose(); (floor?.material as ShadowMaterial | undefined)?.dispose(); });
    normalized.traverse((node) => { if ('isMesh' in node) (node as Mesh).castShadow = true; });
  }

  const initialWidth = Math.max(1, config.container.clientWidth);
  const initialHeight = Math.max(1, config.container.clientHeight);
  const camera = new PerspectiveCamera(35, initialWidth / initialHeight, 0.01, 100);
  const sphere = normalizedBox.getBoundingSphere(new Sphere());
  const cameraTarget = normalizedBox.getCenter(new Vector3());
  cameraTarget.y = Math.max(0, cameraTarget.y);
  const frontDirection = dimensions.x <= dimensions.z ? new Vector3(1, 0.16, 0) : new Vector3(0, 0.16, 1);
  const frameCamera = () => {
    const verticalFov = MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.01, camera.aspect));
    const distance = sphere.radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.2;
    camera.position.copy(cameraTarget).addScaledVector(frontDirection.clone().normalize(), distance);
    camera.near = Math.max(0.001, distance - sphere.radius * 2.2);
    camera.far = distance + sphere.radius * 4 + 10;
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
  };
  frameCamera();
  scene.add(camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  setupCleanup.push(() => controls.dispose());
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.copy(cameraTarget);
  controls.minDistance = sphere.radius * 1.15;
  controls.maxDistance = camera.position.distanceTo(cameraTarget) * 5;
  controls.saveState();

  let disposed = false;
  let animation = 0;
  const initialModelQuaternion = normalized.quaternion.clone();
  const stats = countStats(loaded.object, info.format, info.name, info.bytes, dimensions, loaded.animations.length);
  const mixer = loaded.animations.length ? new AnimationMixer(normalized) : undefined;
  const clock = new Clock();
  const resize = (explicitWidth?: number, explicitHeight?: number) => {
    if (disposed) return;
    const width = Math.max(1, explicitWidth ?? config.container.clientWidth);
    const height = Math.max(1, explicitHeight ?? config.container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(() => resize());
  setupCleanup.push(() => resizeObserver.disconnect());
  resizeObserver.observe(config.container);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    config.onError?.(new OrbitFrameError('WEBGL_CONTEXT_LOST', 'WebGL 上下文已丢失，请重新加载模型。'));
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  const tick = () => {
    if (disposed) return;
    controls.update();
    if (mixer) mixer.update(clock.getDelta());
    renderer.render(scene, camera);
    animation = requestAnimationFrame(tick);
  };
  resize();
  tick();

  const handle: ViewerHandle = {
    container: config.container, canvas: renderer.domElement, element: renderer.domElement,
    scene, modelRoot: normalized, model: normalized, camera, renderer, controls,
    animations: loaded.animations, mixer, metadata: stats, stats,
    get disposed() { return disposed; },
    render() { if (!disposed) renderer.render(scene, camera); },
    resetView() {
      frameCamera();
      controls.target.copy(cameraTarget);
      controls.update();
      controls.saveState();
      normalized.quaternion.copy(initialModelQuaternion);
      handle.render();
    },
    reset() { handle.resetView(); },
    resize,
    setBackground(value) {
      scene.background = value === 'transparent' ? null : new Color(value);
      handle.render();
    },
    playAnimation(nameOrIndex = 0) {
      if (!mixer) return;
      const clip = typeof nameOrIndex === 'number'
        ? loaded.animations[nameOrIndex]
        : loaded.animations.find((candidate) => candidate.name === nameOrIndex);
      if (!clip) throw new OrbitFrameError('INVALID_MODEL', `Animation not found: ${String(nameOrIndex)}`);
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
    },
    stopAnimation() { mixer?.stopAllAction(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animation);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      mixer?.stopAllAction();
      mixer?.uncacheRoot(normalized);
      disposeObject(normalized);
      if (floor) { floor.geometry.dispose(); (floor.material as ShadowMaterial).dispose(); }
      scene.environment = null;
      environmentTarget.dispose();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      loaded.cleanup();
    }
  };
  return handle;
  } catch (error) {
    for (const cleanup of setupCleanup.reverse()) { try { cleanup(); } catch { /* Preserve the initialization error. */ } }
    throw error;
  }
}
