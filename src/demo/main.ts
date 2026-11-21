import { Color, DirectionalLight, HemisphereLight } from 'three';
import { export3DToGIF, import3DToHTML, OrbitFrameError, type GifExportResult, type InputPackage, type LightPreset, type MotionKind, type ViewerHandle } from '../index';
import './styles.css';

Object.assign(globalThis, { OrbitFrame: { import3DToHTML, export3DToGIF } });

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">OF</span><strong>OrbitFrame</strong><span>3D → GIF</span></div>
    <button id="reset-view" class="icon-button" title="重置视图" aria-label="重置视图">↺</button>
  </header>
  <main class="workspace">
    <aside class="panel controls-panel">
      <section>
        <div class="section-heading"><h2>模型</h2><span id="format-badge" class="badge">未载入</span></div>
        <label id="drop-zone" class="drop-zone">
          <input id="model-file" type="file" accept=".glb,.gltf,.obj,.usd,.usda,.usdc,.usdz,model/gltf-binary,model/gltf+json,model/obj,model/vnd.usd,model/vnd.usdz+zip" />
          <span class="drop-icon">＋</span><strong>选择或拖入 3D 文件</strong><small>GLB · OBJ · USD · USDZ</small>
        </label>
        <label class="field resource-field"><span>glTF / OBJ / USD 关联资源</span><input id="resource-files" type="file" multiple accept=".mtl,image/*,.bin,.ktx2,.usd,.usda,.usdc" /></label>
        <div id="stats" class="stats" aria-live="polite"><span>网格<b>—</b></span><span>三角面<b>—</b></span><span>材质<b>—</b></span><span>纹理<b>—</b></span></div>
      </section>
      <section>
        <h2>场景</h2>
        <div class="field-row">
          <label class="field"><span>背景</span><input id="background" type="color" value="#eceeef" /></label>
          <label class="check-field"><input id="transparent" type="checkbox" /><span>透明</span></label>
        </div>
        <label class="field"><span>灯光预设</span><select id="lights"><option value="studio">工作室</option><option value="soft">柔和</option><option value="dramatic">高对比</option></select></label>
      </section>
      <section>
        <h2>运动</h2>
        <label class="field"><span>轨迹策略</span><select id="motion">
          <option value="model-turntable">模型水平转台</option><option value="camera-orbit">相机水平环绕</option><option value="camera-tilt-orbit">相机倾斜环绕</option><option value="ping-pong">往返摆动</option><option value="multi-axis-sway">多轴轻摆</option><option value="spiral-orbit">螺旋环绕</option>
        </select></label>
        <div class="segmented" aria-label="运动方向"><button class="active" data-direction="1">顺时针</button><button data-direction="-1">逆时针</button></div>
        <div class="two-col"><label class="field"><span>角度 / 幅度</span><input id="angle" type="number" value="55" min="1" max="360" /></label><label class="field"><span>圈数</span><input id="turns" type="number" value="1" min="1" max="10" step="1" /></label></div>
      </section>
    </aside>

    <section class="stage-column">
      <div id="viewer" class="viewer"><div class="empty-state"><span class="cube">◇</span><strong>等待模型</strong></div></div>
      <div class="statusbar"><span id="file-name">未选择文件</span><span id="model-size">—</span></div>
      <div id="messages" class="messages" aria-live="assertive"></div>
    </section>

    <aside class="panel export-panel">
      <section>
        <h2>GIF 输出</h2>
        <div class="two-col"><label class="field"><span>宽度</span><input id="width" type="number" value="512" min="16" max="2048" /></label><label class="field"><span>高度</span><input id="height" type="number" value="512" min="16" max="2048" /></label></div>
        <div class="two-col"><label class="field"><span>时长（秒）</span><input id="duration" type="number" value="4" min="0.1" max="120" step="0.1" /></label><label class="field"><span>FPS</span><input id="fps" type="number" value="15" min="1" max="60" /></label></div>
        <label class="field"><span>颜色数量 <output id="colors-output">256</output></span><input id="colors" type="range" value="256" min="2" max="256" /></label>
        <div class="toggle-row"><label class="check-field"><input id="dithering" type="checkbox" /><span>Floyd–Steinberg 抖动</span></label><label class="check-field"><input id="loop" type="checkbox" checked /><span>无限循环</span></label></div>
      </section>
      <section class="action-section">
        <button id="generate" class="primary" disabled>生成 GIF</button><button id="cancel" class="secondary" disabled>取消</button>
        <div class="progress-wrap"><div class="progress-label"><span id="progress-phase">就绪</span><span id="progress-value">0%</span></div><progress id="progress" max="100" value="0"></progress></div>
      </section>
      <section class="result-section">
        <div class="section-heading"><h2>结果</h2><span id="result-size">—</span></div>
        <div id="result" class="result"><span>GIF 预览</span></div>
        <a id="download" class="download disabled" download="orbitframe.gif" aria-disabled="true">↓ 下载 GIF</a>
      </section>
    </aside>
  </main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewerElement = $<HTMLDivElement>('viewer');
const messages = $<HTMLDivElement>('messages');
const modelInput = $<HTMLInputElement>('model-file');
const resourceInput = $<HTMLInputElement>('resource-files');
let viewer: ViewerHandle | undefined;
let result: GifExportResult | undefined;
let activePackage: InputPackage | undefined;
let exportAbort: AbortController | undefined;
let direction: 1 | -1 = 1;

function number(id: string): number { return Number(($<HTMLInputElement>(id)).value); }
function background(): string | 'transparent' { return $<HTMLInputElement>('transparent').checked ? 'transparent' : $<HTMLInputElement>('background').value; }
function bytes(value: number): string { return value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }

function showMessage(error: unknown, type: 'error' | 'warning' = 'error') {
  const item = document.createElement('div');
  item.className = `message ${type}`;
  const code = error instanceof OrbitFrameError ? error.code : 'ERROR';
  const text = error instanceof Error ? error.message : String(error);
  const strong = document.createElement('strong');
  strong.textContent = code;
  const span = document.createElement('span');
  span.textContent = text;
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', '关闭');
  button.textContent = '×';
  button.onclick = () => item.remove();
  item.append(strong, span, button);
  messages.prepend(item);
}

function applyLighting(preset: LightPreset) {
  if (!viewer) return;
  const values = preset === 'dramatic' ? [3.4, 0.55] : preset === 'soft' ? [1.8, 1.15] : [2.5, 0.85];
  viewer.scene.environmentIntensity = preset === 'dramatic' ? 0.7 : preset === 'soft' ? 0.45 : 0.55;
  const lights = viewer.scene.getObjectByName('OrbitFrameLights');
  const directional = lights?.children.filter((light): light is DirectionalLight => light instanceof DirectionalLight) ?? [];
  const hemi = lights?.children.find((light): light is HemisphereLight => light instanceof HemisphereLight);
  if (directional[0]) directional[0].intensity = values[0];
  if (directional[1]) directional[1].intensity = preset === 'dramatic' ? 0.35 : 0.75;
  if (hemi) hemi.intensity = values[1];
}

async function loadPackage(pkg: InputPackage) {
  viewer?.dispose(); viewer = undefined;
  result?.dispose(); result = undefined;
  $('result').replaceChildren(Object.assign(document.createElement('span'), { textContent: 'GIF 预览' }));
  $('download').classList.add('disabled');
  messages.replaceChildren();
  $('file-name').textContent = pkg.file.name;
  $('model-size').textContent = bytes(pkg.file.size);
  viewerElement.classList.add('loading');
  viewerElement.innerHTML = '<div class="empty-state"><span class="spinner"></span><strong>正在解析模型</strong></div>';
  try {
    viewer = await import3DToHTML(pkg, { container: viewerElement, background: background(), groundShadow: true, bottomAlign: true, lightPreset: $<HTMLSelectElement>('lights').value as LightPreset, onError: showMessage });
    activePackage = pkg;
    $('format-badge').textContent = viewer.stats.format.toUpperCase();
    $('stats').innerHTML = `<span>网格<b>${viewer.stats.meshes}</b></span><span>三角面<b>${viewer.stats.triangles.toLocaleString()}</b></span><span>材质<b>${viewer.stats.materials}</b></span><span>纹理<b>${viewer.stats.textures}</b></span>`;
    $<HTMLButtonElement>('generate').disabled = false;
  } catch (error) {
    activePackage = undefined;
    $<HTMLButtonElement>('generate').disabled = true;
    viewerElement.innerHTML = '<div class="empty-state"><span class="cube">!</span><strong>模型加载失败</strong></div>';
    if (!(error instanceof OrbitFrameError)) showMessage(error);
  } finally { viewerElement.classList.remove('loading'); }
}

function pickMain(files: File[]): InputPackage | undefined {
  const main = files.find((file) => /\.(glb|gltf|obj|usd|usda|usdc|usdz)$/i.test(file.name));
  return main ? { file: main, resources: files.filter((file) => file !== main) } : undefined;
}

modelInput.onchange = () => {
  const file = modelInput.files?.[0];
  if (file) void loadPackage({ file, resources: Array.from(resourceInput.files ?? []) });
};
resourceInput.onchange = () => {
  if (activePackage) void loadPackage({ file: activePackage.file, resources: Array.from(resourceInput.files ?? []) });
};
const dropZone = $('drop-zone');
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault(); dropZone.classList.remove('dragging');
  const pkg = pickMain(Array.from(event.dataTransfer?.files ?? []));
  if (pkg) void loadPackage(pkg); else showMessage(new OrbitFrameError('UNSUPPORTED_FORMAT', '拖入内容中没有受支持的 3D 文件。'));
});

$('reset-view').onclick = () => viewer?.reset();
$<HTMLInputElement>('background').oninput = () => { if (viewer) viewer.scene.background = new Color(background() === 'transparent' ? '#000000' : background()); };
$<HTMLInputElement>('transparent').onchange = () => { if (viewer) viewer.scene.background = background() === 'transparent' ? null : new Color(background()); };
$<HTMLSelectElement>('lights').onchange = (event) => applyLighting((event.target as HTMLSelectElement).value as LightPreset);
document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach((button) => button.onclick = () => {
  direction = Number(button.dataset.direction) as 1 | -1;
  document.querySelectorAll('[data-direction]').forEach((item) => item.classList.toggle('active', item === button));
});
$<HTMLInputElement>('colors').oninput = (event) => $('colors-output').textContent = (event.target as HTMLInputElement).value;

$('generate').onclick = async () => {
  if (!viewer) return;
  exportAbort = new AbortController();
  $<HTMLButtonElement>('generate').disabled = true;
  $<HTMLButtonElement>('cancel').disabled = false;
  messages.replaceChildren();
  result?.dispose(); result = undefined;
  try {
    const duration = number('duration'), fps = number('fps');
    result = await export3DToGIF(viewer, {
      width: number('width'), height: number('height'), duration, fps, frameCount: Math.round(duration * fps),
      background: background(), maxColors: number('colors'), dithering: $<HTMLInputElement>('dithering').checked,
      loop: $<HTMLInputElement>('loop').checked, signal: exportAbort.signal,
      motion: { type: $<HTMLSelectElement>('motion').value as MotionKind, direction, turns: number('turns'), angle: number('angle'), amplitude: number('angle') },
      onProgress(progress) {
        $<HTMLProgressElement>('progress').value = progress.percent;
        $('progress-value').textContent = `${Math.round(progress.percent)}%`;
        $('progress-phase').textContent = progress.phase === 'rendering' ? `渲染 ${progress.completed}/${progress.total}` : progress.phase === 'encoding' ? `编码 ${progress.completed}/${progress.total}` : progress.phase === 'done' ? '完成' : '载入';
      }
    });
    const image = new Image(); image.src = result.url; image.alt = '生成的 GIF 预览';
    $('result').replaceChildren(image);
    $('result-size').textContent = `${result.width}×${result.height} · ${bytes(result.fileSize)}`;
    const download = $<HTMLAnchorElement>('download');
    download.href = result.url; download.classList.remove('disabled'); download.setAttribute('aria-disabled', 'false');
  } catch (error) { if (!(error instanceof OrbitFrameError && error.code === 'EXPORT_ABORTED')) showMessage(error); else showMessage(error, 'warning'); }
  finally {
    exportAbort = undefined;
    $<HTMLButtonElement>('generate').disabled = !viewer;
    $<HTMLButtonElement>('cancel').disabled = true;
  }
};
$('cancel').onclick = () => exportAbort?.abort();

window.addEventListener('beforeunload', () => { exportAbort?.abort(); result?.dispose(); viewer?.dispose(); });
