import { Euler, Quaternion, Vector3 } from 'three';
import { OrbitFrameError } from '../errors';
import type { MotionConfig, MotionKind, ViewerHandle } from '../schema/types';

export interface MotionSnapshot {
  modelQuaternion: Quaternion;
  cameraPosition: Vector3;
  cameraUp: Vector3;
}

export interface MotionPathAdapter {
  readonly type: MotionKind;
  apply(viewer: ViewerHandle, t: number, config: MotionConfig, base: MotionSnapshot): void;
}

const tau = Math.PI * 2;
const angleFor = (t: number, config: MotionConfig) => tau * (config.turns ?? 1) * (config.direction ?? 1) * t;

function orbitPosition(base: Vector3, target: Vector3, angle: number, yOffset = 0): Vector3 {
  const relative = base.clone().sub(target);
  const radius = Math.hypot(relative.x, relative.z);
  const start = Math.atan2(relative.z, relative.x);
  return new Vector3(Math.cos(start + angle) * radius, relative.y + yOffset, Math.sin(start + angle) * radius).add(target);
}

const adapters: Record<MotionKind, MotionPathAdapter> = {
  'model-turntable': {
    type: 'model-turntable',
    apply(viewer, t, config, base) {
      viewer.model.quaternion.copy(base.modelQuaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angleFor(t, config)));
    }
  },
  'camera-orbit': {
    type: 'camera-orbit',
    apply(viewer, t, config, base) {
      viewer.camera.position.copy(orbitPosition(base.cameraPosition, viewer.controls.target, angleFor(t, config)));
      viewer.camera.lookAt(viewer.controls.target);
    }
  },
  'camera-tilt-orbit': {
    type: 'camera-tilt-orbit',
    apply(viewer, t, config, base) {
      const tilt = (config.tilt ?? 18) * Math.PI / 180;
      const relative = base.cameraPosition.clone().sub(viewer.controls.target);
      const radius = relative.length();
      const y = Math.sin(tilt) * radius;
      const flat = Math.max(0.1, Math.cos(tilt) * radius);
      const angle = angleFor(t, config) + Math.atan2(relative.z, relative.x);
      viewer.camera.position.set(Math.cos(angle) * flat, y, Math.sin(angle) * flat).add(viewer.controls.target);
      viewer.camera.lookAt(viewer.controls.target);
    }
  },
  'ping-pong': {
    type: 'ping-pong',
    apply(viewer, t, config, base) {
      const amplitude = (config.angle ?? config.amplitude ?? 55) * Math.PI / 180;
      const angle = Math.sin(tau * t) * amplitude * (config.direction ?? 1);
      viewer.model.quaternion.copy(base.modelQuaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle));
    }
  },
  'multi-axis-sway': {
    type: 'multi-axis-sway',
    apply(viewer, t, config, base) {
      const amplitude = (config.amplitude ?? 12) * Math.PI / 180;
      const euler = new Euler(Math.sin(tau * t) * amplitude, Math.sin(tau * t * 2) * amplitude * 0.7, Math.cos(tau * t) * amplitude * 0.55, 'YXZ');
      viewer.model.quaternion.copy(base.modelQuaternion).multiply(new Quaternion().setFromEuler(euler));
    }
  },
  'spiral-orbit': {
    type: 'spiral-orbit',
    apply(viewer, t, config, base) {
      const vertical = Math.sin(tau * t) * (config.height ?? 0.75);
      viewer.camera.position.copy(orbitPosition(base.cameraPosition, viewer.controls.target, angleFor(t, config), vertical));
      viewer.camera.lookAt(viewer.controls.target);
    }
  }
};

export function validateMotion(config: MotionConfig): void {
  if (!adapters[config.type]) throw new OrbitFrameError('INVALID_MOTION_CONFIG', `未知轨迹：${config.type}。`);
  if ((config.turns ?? 1) <= 0 || !Number.isFinite(config.turns ?? 1)) throw new OrbitFrameError('INVALID_MOTION_CONFIG', '圈数必须是正数。');
  if (['model-turntable', 'camera-orbit', 'camera-tilt-orbit', 'spiral-orbit'].includes(config.type) && !Number.isInteger(config.turns ?? 1)) {
    throw new OrbitFrameError('NON_LOOPING_PATH', '循环轨迹的圈数必须是整数。');
  }
}

export function createMotionRunner(viewer: ViewerHandle, config: MotionConfig) {
  validateMotion(config);
  const base: MotionSnapshot = {
    modelQuaternion: viewer.model.quaternion.clone(),
    cameraPosition: viewer.camera.position.clone(),
    cameraUp: viewer.camera.up.clone()
  };
  return {
    apply(t: number) {
      viewer.model.quaternion.copy(base.modelQuaternion);
      viewer.camera.position.copy(base.cameraPosition);
      viewer.camera.up.copy(base.cameraUp);
      adapters[config.type].apply(viewer, ((t % 1) + 1) % 1, config, base);
      viewer.camera.updateMatrixWorld(true);
      viewer.model.updateMatrixWorld(true);
    },
    restore() {
      viewer.model.quaternion.copy(base.modelQuaternion);
      viewer.camera.position.copy(base.cameraPosition);
      viewer.camera.up.copy(base.cameraUp);
      viewer.camera.lookAt(viewer.controls.target);
    }
  };
}

export const motionAdapters = adapters;
