import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMotionRunner, motionAdapters, validateMotion } from '../../src/motion';
import type { MotionKind, ViewerHandle } from '../../src/schema/types';

function viewer(): ViewerHandle {
  const camera = new PerspectiveCamera();
  camera.position.set(3, 2, 4);
  return { model: new Object3D(), camera, controls: { target: new Vector3(0, 0.75, 0) } } as ViewerHandle;
}

function closeVector(a: Vector3, b: Vector3) { expect(a.distanceTo(b)).toBeLessThan(1e-6); }
function closeQuaternion(a: Quaternion, b: Quaternion) { expect(1 - Math.abs(a.dot(b))).toBeLessThan(1e-6); }

describe('motion paths', () => {
  const kinds = Object.keys(motionAdapters) as MotionKind[];
  it('provides six independent adapters', () => expect(new Set(kinds)).toHaveLength(6));

  it.each(kinds)('%s is deterministic and loop-continuous', (type) => {
    const handle = viewer();
    const runner = createMotionRunner(handle, { type, turns: 1, direction: 1 });
    runner.apply(0);
    const startPosition = handle.camera.position.clone(), startRotation = handle.model.quaternion.clone();
    runner.apply(0.375);
    const middlePosition = handle.camera.position.clone(), middleRotation = handle.model.quaternion.clone();
    runner.apply(0.375);
    closeVector(handle.camera.position, middlePosition); closeQuaternion(handle.model.quaternion, middleRotation);
    runner.apply(1);
    closeVector(handle.camera.position, startPosition); closeQuaternion(handle.model.quaternion, startRotation);
  });

  it('rejects a fractional turn that cannot loop', () => {
    expect(() => validateMotion({ type: 'camera-orbit', turns: 1.5 })).toThrowError(expect.objectContaining({ code: 'NON_LOOPING_PATH' }));
  });
});
