import type { Material, Object3D, Texture } from 'three';

function disposeMaterial(material: Material) {
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && 'isTexture' in value) (value as Texture).dispose();
  }
  material.dispose();
}

export function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!('isMesh' in object)) return;
    const mesh = object as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial);
    else if (mesh.material) disposeMaterial(mesh.material);
  });
}
