import { writeFile, copyFile } from 'node:fs/promises';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader ??= class FileReader {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      queueMicrotask(() => this.onloadend?.());
    });
  }
};

async function glb(name, object) {
  const exporter = new GLTFExporter();
  const output = await exporter.parseAsync(object, { binary: true, onlyVisible: false });
  await writeFile(new URL(`../public/fixtures/${name}`, import.meta.url), new Uint8Array(output));
}

const standard = new Scene();
standard.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xe05236, roughness: 0.55 })));
await glb('standard.glb', standard);

const geometry = new BoxGeometry(1.6, 1, 1);
geometry.clearGroups();
geometry.addGroup(0, 18, 0);
geometry.addGroup(18, 18, 1);
const multi = new Scene();
multi.add(new Mesh(geometry, [new MeshStandardMaterial({ color: 0x2b6cb0 }), new MeshStandardMaterial({ color: 0xf2c94c })]));
await glb('multi-material.glb', multi);

const offset = new Scene();
const offsetMesh = new Mesh(new BoxGeometry(1, 2, 0.6), new MeshStandardMaterial({ color: 0x2aa876 }));
offsetMesh.position.set(120, -40, 75);
offset.add(offsetMesh);
await glb('origin-offset.glb', offset);

const tall = new Scene();
tall.add(new Mesh(new BoxGeometry(0.05, 8, 0.05), new MeshStandardMaterial({ color: 0xd16ba5 })));
await glb('extreme-tall.glb', tall);

const flat = new Scene();
flat.add(new Mesh(new BoxGeometry(8, 0.02, 5), new MeshStandardMaterial({ color: 0x4f86c6 })));
await glb('extreme-flat.glb', flat);

await glb('empty.glb', new Scene());
await copyFile(new URL('../public/fixtures/standard.glb', import.meta.url), new URL('../public/fixtures/mismatch.obj', import.meta.url));

const invalid = new BufferGeometry();
invalid.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
const invalidScene = new Group();
invalidScene.add(new Mesh(invalid, new MeshStandardMaterial()));
await glb('degenerate.glb', invalidScene);
