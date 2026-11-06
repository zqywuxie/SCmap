import { summarize, percent, subtypeGeneCounts, sortGeneRanks } from './stats.js';
import { GenePicker } from './gene-picker.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const fmt = (n) => nf.format(n);
const state = { manifest: null, data: null, lineage: 'CD8', mode: 'single', chain: 'TRA', locus: 'TRAV', gene: null, geneJ: null,
  study: 'all', cohort: 'matched', filtered: new Uint32Array(), summary: null,
  direction: 'gene', rankSubtype: null, rankSort: 'usage', rankSearch: '', rankPage: 0,
  rankKey: null, rankData: null, rankRows: [], rankPageSize: 25,
  cache: new Map(), request: 0, view: null, baseScale: 1, grid: null, loading: false };
const esc = (text) => String(text).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
let renderers = [];
let genePicker, jPicker;
let framePending = false;
let resultsPosition = null;
const mobileLayout = window.matchMedia('(max-width:760px)');
state.rankPageSize = mobileLayout.matches ? 10 : 25;

function navigateTo(target) {
  if (target === 'maps') resultsPosition = { y: window.scrollY, rank: document.activeElement?.dataset.rankSelect };
  const heading = target === 'maps' ? $('maps-heading') : target === 'controls' ? $('gene-heading') :
    $(state.direction === 'subtype' ? 'ranking-title' : 'distribution-title');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  const y = target === 'results' && resultsPosition ? resultsPosition.y : heading.getBoundingClientRect().top + window.scrollY - 20;
  window.scrollTo({ top: y, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' });
  if (target === 'results' && resultsPosition?.rank) document.querySelector(`[data-rank-select="${resultsPosition.rank}"]`)?.focus({ preventScroll: true });
}

function viewAction(action) {
  if (!state.view || state.loading) return;
  if (action === 'in' || action === 'out') state.view.scale = Math.max(state.baseScale / 100,
    Math.min(state.baseScale * 4, state.view.scale * (action === 'in' ? 0.8 : 1.25)));
  else {
    const step = $('reference-canvas').clientWidth * state.view.scale * 0.15;
    if (action === 'left') state.view.cx -= step;
    if (action === 'right') state.view.cx += step;
    if (action === 'up') state.view.cy += step;
    if (action === 'down') state.view.cy -= step;
  }
  scheduleDraw();
}

function updateContext() {
  if (!state.data) return;
  const subtype = state.data.info.subtypes.find(s => s.code === state.rankSubtype);
  const selected = selectionName();
  const context = `${state.lineage} · ${$('study-select').selectedOptions[0]?.textContent || '全部研究'} · RNA–TCR 已匹配`;
  $('map-context').textContent = `${context} · ${selected ? `${selected} · ${fmt(state.summary.carrierTotal)} 个高亮细胞` : '选择基因后查看携带细胞'}`;
  $('dock-context').textContent = `${state.direction === 'subtype' ? '亚型排名 · ' + (subtype?.label || '') : '按基因看亚型'} · ${selected || '尚未选择基因'}`;
  $('selection-feedback').hidden = state.direction === 'subtype';
  $('selection-feedback').innerHTML = `<span>${selected ? `已选 ${esc(selected)} · 全队列高亮 ${fmt(state.summary.carrierTotal)} 个携带细胞` : state.mode === 'pair' ? '选择同一条链的 V 和 J 基因后，显示组合携带细胞。' : '搜索或从常见基因中选择，查看各亚型的分布。'}</span><button type="button" data-jump="maps">查看 UMAP ↑</button>`;
  document.querySelectorAll('.legend-item').forEach(el => el.classList.toggle('legend-selected', state.direction === 'subtype' && Number(el.dataset.code) === state.rankSubtype));
}

class UmapRenderer {
  constructor(canvas, reference) {
    this.canvas = canvas;
    this.reference = reference;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('浏览器未启用 WebGL。请在浏览器设置中启用图形加速后重试。');
    this.gl = gl;
    const vertex = `attribute vec2 aPosition;
      attribute vec3 aColor;
      uniform vec2 uCenter;
      uniform vec2 uExtent;
      uniform float uSize;
      uniform bool uUseColor;
      uniform vec4 uColor;
      varying vec4 vColor;
      void main(){gl_Position=vec4((aPosition-uCenter)/uExtent,0.0,1.0);
      gl_PointSize=uSize;vColor=uUseColor?vec4(aColor/255.0,uColor.a):uColor;}`;
    const fragment = `precision mediump float;
      varying vec4 vColor;
      void main(){vec2 q=gl_PointCoord-vec2(0.5);if(dot(q,q)>0.25)discard;gl_FragColor=vColor;}`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('UMAP 图形程序加载失败。');
    this.positionLocation = gl.getAttribLocation(this.program, 'aPosition');
    this.colorLocation = gl.getAttribLocation(this.program, 'aColor');
    this.uniforms = Object.fromEntries(['uCenter', 'uExtent', 'uSize', 'uUseColor', 'uColor']
      .map((n) => [n, gl.getUniformLocation(this.program, n)]));
    this.positions = gl.createBuffer(); this.colors = gl.createBuffer(); this.carriers = gl.createBuffer();
    this.carrierColors = gl.createBuffer();
    this.count = 0; this.carrierCount = 0;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); showError(new Error('图形上下文已中断，请刷新页面重新加载。'));
    });
    this.attachNavigation();
  }

  setData(positions, colors) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positions);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    if (this.reference) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colors);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    }
    this.count = positions.length / 2;
    this.carrierCount = 0;
  }

  setCarriers(positions, colors) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.carriers);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.carrierColors);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    this.carrierCount = positions.length / 2;
  }

  draw() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!state.view || !this.count) return;
    gl.useProgram(this.program);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.uniforms.uCenter, state.view.cx, state.view.cy);
    gl.uniform2f(this.uniforms.uExtent, rect.width * state.view.scale / 2, rect.height * state.view.scale / 2);
    const size = Math.min(4, Math.max(1.15, 1.3 * Math.pow(state.baseScale / state.view.scale, 0.35)));
    gl.uniform1f(this.uniforms.uSize, size * dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positions);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    if (this.reference) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colors);
      gl.enableVertexAttribArray(this.colorLocation);
      gl.vertexAttribPointer(this.colorLocation, 3, gl.UNSIGNED_BYTE, false, 0, 0);
      gl.uniform1i(this.uniforms.uUseColor, 1);
      gl.uniform4f(this.uniforms.uColor, 0, 0, 0, 0.44);
    } else {
      gl.disableVertexAttribArray(this.colorLocation);
      gl.vertexAttrib3f(this.colorLocation, 0, 0, 0);
      gl.uniform1i(this.uniforms.uUseColor, 0);
      gl.uniform4f(this.uniforms.uColor, 0.64, 0.70, 0.64, state.gene === null ? 0.15 : 0.11);
    }
    gl.drawArrays(gl.POINTS, 0, this.count);
    if (!this.reference && this.carrierCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.carriers);
      gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.carrierColors);
      gl.enableVertexAttribArray(this.colorLocation);
      gl.vertexAttribPointer(this.colorLocation, 3, gl.UNSIGNED_BYTE, false, 0, 0);
      gl.uniform1i(this.uniforms.uUseColor, 1);
      gl.uniform4f(this.uniforms.uColor, 0, 0, 0, 0.8);
      gl.uniform1f(this.uniforms.uSize, Math.max(1.7, size) * dpr);
      gl.drawArrays(gl.POINTS, 0, this.carrierCount);
    }
  }

  attachNavigation() {
    const canvas = this.canvas;
    let dragging = null, lastHover = 0;
    canvas.addEventListener('pointerdown', (event) => {
      if (!state.view || state.loading) return;
      dragging = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId); $('cell-tooltip').hidden = true;
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!state.view || state.loading) return;
      if (dragging) {
        state.view.cx -= (event.clientX - dragging.x) * state.view.scale;
        state.view.cy += (event.clientY - dragging.y) * state.view.scale;
        dragging = { x: event.clientX, y: event.clientY }; scheduleDraw();
      } else if (performance.now() - lastHover > 45) {
        lastHover = performance.now(); hoverCell(canvas, event);
      }
    });
    canvas.addEventListener('pointerup', () => { dragging = null; });
    canvas.addEventListener('pointercancel', () => { dragging = null; });
    canvas.addEventListener('pointerleave', () => { $('cell-tooltip').hidden = true; });
    canvas.addEventListener('dblclick', () => resetView());
    canvas.addEventListener('wheel', (event) => {
      if (!state.view || state.loading) return;
      event.preventDefault(); $('cell-tooltip').hidden = true;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = rect.height / 2 - (event.clientY - rect.top);
      const old = state.view.scale;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      const scale = Math.max(state.baseScale / 100, Math.min(state.baseScale * 4, old * Math.exp(delta * 0.0015)));
      state.view.cx += x * (old - scale); state.view.cy += y * (old - scale);
      state.view.scale = scale; scheduleDraw();
    }, { passive: false });
  }
}

function scheduleDraw() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => { framePending = false; renderers.forEach((r) => r.draw()); updateLabels(); });
}

function resetView() {
  if (!state.data) return;
  const [xmin, ymin, xmax, ymax] = state.data.info.bounds;
  const rect = $('reference-canvas').getBoundingClientRect();
  const scale = Math.max((xmax - xmin) / (rect.width * 0.88), (ymax - ymin) / (rect.height * 0.84));
  state.view = { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, scale };
  state.baseScale = scale;
  scheduleDraw();
}

function updateLabels() {
  if (!state.view || !state.summary) return;
  const rect = $('reference-canvas').getBoundingClientRect();
  document.querySelectorAll('.subtype-label').forEach((element) => {
    const subtype = state.data.info.subtypes.find((s) => s.code === Number(element.dataset.code));
    const x = rect.width / 2 + (subtype.label_position[0] - state.view.cx) / state.view.scale;
    const y = rect.height / 2 - (subtype.label_position[1] - state.view.cy) / state.view.scale;
    const visible = state.summary.totals[subtype.code] > 0 && x > 20 && x < rect.width - 20 && y > 14 && y < rect.height - 14;
    element.hidden = !visible; element.style.left = `${x}px`; element.style.top = `${y}px`;
  });
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`数据读取失败 (${response.status})：${path}`);
  return response.json();
}

async function loadArray(lineage, descriptor, Type) {
  const response = await fetch(`/data/${lineage}/${descriptor.path}`);
  if (!response.ok) throw new Error(`数据读取失败 (${response.status})：${descriptor.path}`);
  if (!('DecompressionStream' in window)) throw new Error('请使用支持 gzip 解压的新版 Chrome、Edge、Firefox 或 Safari。');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength !== descriptor.bytes) throw new Error(`数据长度校验失败：${descriptor.path}`);
  if (window.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const actual = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
    if (actual !== descriptor.sha256) throw new Error(`数据校验失败：${descriptor.path}`);
  }
  return new Type(buffer);
}

async function loadLineage(lineage) {
  const request = ++state.request;
  state.loading = true;
  document.body.classList.add('loading');
  setControlsDisabled(true);
  $('cell-tooltip').hidden = true;
  $('notice').dataset.ready = 'false'; $('notice').classList.remove('error');
  $('notice').textContent = `正在加载 ${lineage} 的完整细胞坐标与 V/J 注释…`;
  try {
    let data = state.cache.get(lineage);
    if (!data) {
      const info = state.manifest.lineages[lineage];
      const [coords, attrs, matched, rows] = await Promise.all([
        loadArray(lineage, info.files.coords, Float32Array),
        loadArray(lineage, info.files.attributes, Uint16Array),
        loadArray(lineage, info.files.matched, Uint8Array),
        loadArray(lineage, info.files.source_rows, Uint32Array),
      ]);
      data = { info, coords, attrs, matched, rows };
      state.cache.set(lineage, data);
    }
    if (request !== state.request) return;
    state.lineage = lineage; state.data = data;
    document.querySelectorAll('[data-lineage]').forEach((b) => {
      const active = b.dataset.lineage === lineage; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active);
    });
    $('reference-labels').innerHTML = data.info.subtypes.map((s) =>
      `<span class="subtype-label" data-code="${s.code}">${esc(s.label.replace(`${lineage}+ `, ''))}</span>`).join('');
    $('subtype-legend').innerHTML = data.info.subtypes.map((s) =>
      `<span class="legend-item" data-code="${s.code}"><i class="legend-dot" style="background:${s.color}"></i>${esc(s.label.replace(`${lineage}+ `, ''))}</span>`).join('');
    applyFilters(true);
    $('notice').dataset.ready = 'true';
  } catch (error) { if (request === state.request) showError(error); }
  finally {
    if (request === state.request) { state.loading = false; document.body.classList.remove('loading'); setControlsDisabled(false); }
  }
}

function setControlsDisabled(disabled) {
  document.querySelectorAll('.toolbar button,.toolbar select,.gene-section button,.gene-section input,.gene-section select,.map-buttons button,.explorer-dock button,.ranking-section button')
    .forEach((element) => { element.disabled = disabled; });
}

function applyFilters(reset = false) {
  const start = performance.now();
  const { attrs, matched, coords, info } = state.data;
  const stride = state.manifest.attributes.length;
  const studyField = state.manifest.attributes.indexOf('study_name');
  const subtypeField = state.manifest.attributes.indexOf('cell_subtype_v3');
  const study = state.study === 'all' ? null : Number(state.study);
  let count = 0;
  for (let i = 0; i < info.cells; i++) if (matched[i] && (study === null || attrs[i * stride + studyField] === study)) count++;
  const indices = new Uint32Array(count), positions = new Float32Array(count * 2), colors = new Uint8Array(count * 3);
  const palette = state.manifest.codebooks.cell_subtype_v3.map((name) => colorRGB(state.manifest.colors[name] || '#b4bcb0'));
  let offset = 0;
  for (let i = 0; i < info.cells; i++) {
    if (!matched[i] || (study !== null && attrs[i * stride + studyField] !== study)) continue;
    indices[offset] = i; positions[offset * 2] = coords[i * 2]; positions[offset * 2 + 1] = coords[i * 2 + 1];
    const color = palette[attrs[i * stride + subtypeField]];
    colors[offset * 3] = color[0]; colors[offset * 3 + 1] = color[1]; colors[offset * 3 + 2] = color[2]; offset++;
  }
  state.filtered = indices;
  state.rankKey = null; state.rankPage = 0;
  renderers.forEach((r) => r.setData(positions, colors));
  buildGrid();
  refreshGeneOptions();
  updateSelection();
  const studies = new Set();
  for (const i of indices) studies.add(attrs[i * stride + studyField]);
  $('cohort-number').textContent = fmt(count); $('study-count').textContent = `${studies.size} 项研究`;
  $('display-count').textContent = `${fmt(count)} 个细胞 · 全量显示`;
  $('reference-empty').textContent = count ? '' : '当前筛选下没有细胞';
  if (reset || !state.view) resetView(); else scheduleDraw();
  state.filterMs = performance.now() - start;
}

function partnerLocus() { return state.chain === 'TRA' ? 'TRAJ' : 'TRBJ'; }
function selectionName() {
  if (state.gene === null || (state.mode === 'pair' && state.geneJ === null)) return null;
  const first = state.manifest.codebooks[state.locus][state.gene];
  return state.mode === 'single' ? first : `${first} + ${state.manifest.codebooks[partnerLocus()][state.geneJ]}`;
}

function countsForLocus(locus, otherLocus = null, otherGene = null) {
  const counts = new Uint32Array(state.manifest.codebooks[locus].length);
  const field = state.manifest.attributes.indexOf(locus), stride = state.manifest.attributes.length;
  const otherField = otherLocus === null ? null : state.manifest.attributes.indexOf(otherLocus);
  for (const i of state.filtered) {
    const call = state.data.attrs[i * stride + field];
    if (otherField !== null) {
      const other = state.data.attrs[i * stride + otherField];
      if (call < 2 || other < 2 || (otherGene !== null && other !== otherGene)) continue;
    }
    counts[call]++;
  }
  return counts;
}

function fillGeneOptions(locus, counts, selected, selectId) {
  const book = state.manifest.codebooks[locus];
  const options = book.map((name, code) => ({ name, code, count: counts[code] }))
    .filter(g => g.code >= 2 && (g.count > 0 || g.code === selected));
  (selectId === 'gene-select' ? genePicker : jPicker).update(options, selected, locus);
  $('gene-options-info').textContent = state.mode === 'pair'
    ? '先选 V 或 J 均可，另一侧候选按同细胞的实际组合更新。数字为当前配对队列携带细胞数。'
    : '输入基因名称直接筛选，点击候选或按 Enter 选择。数字为当前配对队列携带细胞数。';
}

function refreshGeneOptions() {
  const pair = state.mode === 'pair';
  const book = state.manifest.codebooks[state.locus];
  state.geneCounts = countsForLocus(state.locus, pair ? partnerLocus() : null, pair ? state.geneJ : null);
  fillGeneOptions(state.locus, state.geneCounts, state.gene, 'gene-select');
  if (pair) {
    const jBook = state.manifest.codebooks[partnerLocus()];
    const jCounts = countsForLocus(partnerLocus(), state.locus, state.gene);
    state.jCounts = jCounts;
    fillGeneOptions(partnerLocus(), jCounts, state.geneJ, 'gene-select-j');
    const stride = state.manifest.attributes.length;
    const vField = state.manifest.attributes.indexOf(state.locus), jField = state.manifest.attributes.indexOf(partnerLocus());
    const counts = new Map();
    for (const i of state.filtered) {
      const v = state.data.attrs[i * stride + vField], j = state.data.attrs[i * stride + jField];
      if (v >= 2 && j >= 2) { const key = v * 65536 + j; counts.set(key, (counts.get(key) || 0) + 1); }
    }
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('quick-genes').innerHTML = '<span>常见组合</span>' + common.map(([key, n]) => {
      const v = Math.floor(key / 65536), j = key % 65536;
      return `<button type="button" data-gene="${v}" data-gene-j="${j}" title="${fmt(n)} 个携带细胞" class="${v === state.gene && j === state.geneJ ? 'active' : ''}">${esc(book[v])} + ${esc(jBook[j])}</button>`;
    }).join('') + (!common.length ? '<span>当前队列无明确的 V+J 组合调用</span>' : '');
    return;
  }
  const common = book.map((name, code) => ({ name, code, count: state.geneCounts[code] }))
    .filter((g) => g.code >= 2 && g.count > 0).sort((a, b) => b.count - a.count).slice(0, 6);
  $('quick-genes').innerHTML = '<span>常见基因</span>' + common.map((g) =>
    `<button type="button" data-gene="${g.code}" class="${g.code === state.gene ? 'active' : ''}">${esc(g.name)}</button>`).join('')
    + (!common.length ? '<span>当前队列无有效调用</span>' : '');
}

function updateSelection() {
  const start = performance.now();
  const { attrs, coords } = state.data;
  const stride = state.manifest.attributes.length;
  const field = state.manifest.attributes.indexOf(state.locus);
  const pair = state.mode === 'pair';
  const jField = pair ? state.manifest.attributes.indexOf(partnerLocus()) : null;
  const subtypeField = state.manifest.attributes.indexOf('cell_subtype_v3');
  const summary = summarize(attrs, state.filtered, stride, subtypeField, field,
    state.manifest.codebooks.cell_subtype_v3.length, state.gene, jField, state.geneJ);
  state.summary = summary;
  const highlight = new Float32Array(summary.carrierTotal * 2);
  const highlightColors = new Uint8Array(summary.carrierTotal * 3);
  const palette = state.manifest.codebooks.cell_subtype_v3.map((name) => colorRGB(state.manifest.colors[name] || '#b4bcb0'));
  let p = 0, colorOffset = 0;
  if (state.gene !== null) for (const i of state.filtered) {
    if (attrs[i * stride + field] === state.gene && (!pair || attrs[i * stride + jField] === state.geneJ)) {
      highlight[p++] = coords[i * 2]; highlight[p++] = coords[i * 2 + 1];
      const color = palette[attrs[i * stride + subtypeField]];
      highlightColors[colorOffset++] = color[0];
      highlightColors[colorOffset++] = color[1];
      highlightColors[colorOffset++] = color[2];
    }
  }
  renderers[1].setCarriers(highlight, highlightColors);
  const gene = selectionName();
  $('gene-pill').textContent = gene || (pair ? '未选完整的 V + J' : '未选择基因');
  $('carrier-count').textContent = gene ? `${fmt(summary.carrierTotal)} 个携带细胞` : '—';
  $('highlight-empty').textContent = !state.filtered.length ? '当前筛选下没有细胞' :
    gene ? (summary.carrierTotal ? '' : `当前队列没有携带该${pair ? '组合' : '基因'}的细胞`) :
      (state.direction === 'subtype' ? '从下方基因排名中选择一项' :
        (pair ? '从下方选择同一条链的 V 和 J 基因' : '从下方选择一个 V/J 基因'));
  $('distribution-description').textContent = gene ? `${gene} · ${state.lineage} · RNA–TCR 已匹配 · ${fmt(summary.carrierTotal)} 个携带细胞` : '选择基因后查看各亚型的携带率与构成。';
  $('call-quality').textContent = `${pair ? state.chain + ' V+J' : state.locus} 有效 ${fmt(summary.validTotal)} · 缺失 ${fmt(summary.missingTotal)} · 不确定 ${fmt(summary.ambiguousTotal)}`;
  $('table-note').textContent = pair
    ? '有效细胞：同一条链的 V、J 两个位点均有明确调用；携带细胞：同时匹配所选 V 和 J。所有比例均基于当前筛选队列；分母为 0 时显示“—”。'
    : `有效细胞：${state.locus} 有明确调用的细胞。所有比例均基于当前筛选队列；分母为 0 时显示“—”。`;
  const rankedSubtypes = [...state.data.info.subtypes];
  if (gene) rankedSubtypes.sort((a, b) => summary.carriers[b.code] - summary.carriers[a.code]);
  $('composition-heading').textContent = `携带者亚型占比${gene ? ' ↓' : ''}`;
  $('composition-heading').closest('th').setAttribute('aria-sort', gene ? 'descending' : 'none');
  $('distribution-body').innerHTML = rankedSubtypes.map((s, rank) => {
    const n = summary.totals[s.code], valid = summary.valid[s.code], carriers = summary.carriers[s.code];
    const rate = gene && valid ? carriers / valid : null;
    const composition = gene && summary.carrierTotal ? carriers / summary.carrierTotal : null;
    const background = summary.validTotal ? valid / summary.validTotal : null;
    return `<tr data-subtype="${s.code}"><td>${gene ? `<span class="table-rank">${rank + 1}</span>` : ''}<span class="legend-dot" style="background:${s.color}"></span>${esc(s.label)}</td>
      <td class="numeric" title="亚型总数 ${fmt(n)}；缺失 ${fmt(summary.missing[s.code])}；不确定 ${fmt(summary.ambiguous[s.code])}">${gene ? fmt(carriers) : '—'} <span>/ ${fmt(valid)}</span></td>
      <td class="rate-cell"><div class="rate-display"><span class="rate-track"><i style="width:${rate === null ? 0 : rate * 100}%"></i></span><span>${percent(rate)}</span></div></td>
      <td class="composition">${percent(composition)}</td><td class="numeric">${percent(background)}</td></tr>`;
  }).join('');
  document.querySelectorAll('[data-gene]').forEach((b) => b.classList.toggle('active', Number(b.dataset.gene) === state.gene && (!pair || Number(b.dataset.geneJ) === state.geneJ)));
  updateExplorationControls();
  if (state.direction === 'subtype') renderGeneRanking();
  updateContext();
  scheduleDraw();
  state.selectionMs = performance.now() - start;
}

function chooseGene(code) {
  state.gene = code;
  genePicker.close(); jPicker.close();
  refreshGeneOptions();
  updateSelection();
}

function changeLocus(locus) {
  genePicker.close(); jPicker.close();
  state.locus = locus; state.gene = null; state.geneJ = null; $('gene-search').value = ''; $('gene-search-j').value = '';
  state.rankSearch = ''; $('rank-search').value = ''; state.rankPage = 0;
  document.querySelectorAll('[data-locus]').forEach((b) => {
    const active = b.dataset.locus === locus; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active);
  });
  refreshGeneOptions(); updateSelection();
}

function changeChain(chain) {
  state.chain = chain;
  document.querySelectorAll('[data-chain]').forEach((b) => {
    const active = b.dataset.chain === chain; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active);
  });
  changeLocus(chain === 'TRA' ? 'TRAV' : 'TRBV');
}

function changeMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => {
    const active = b.dataset.mode === mode; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active);
  });
  const pair = mode === 'pair';
  document.querySelectorAll('[data-locus]').forEach((b) => { b.hidden = pair; });
  document.querySelectorAll('[data-chain]').forEach((b) => { b.hidden = !pair; });
  $('j-picker').hidden = !pair; $('pair-plus').hidden = !pair;
  $('gene-select').setAttribute('aria-label', pair ? '选择 V 基因' : '选择基因');
  document.querySelector('.gene-controls').classList.toggle('pair-mode', pair);
  $('gene-heading').textContent = pair ? '选择同一条链的 V + J 组合' : '选择 V/J 基因';
  $('highlight-title').textContent = pair ? '组合携带细胞' : '基因携带细胞';
  $('distribution-title').textContent = pair ? '亚型中的组合使用' : '亚型中的基因使用';
  if (pair) changeChain(state.locus.startsWith('TRB') ? 'TRB' : 'TRA');
  else changeLocus(state.locus);
}

function updateExplorationControls() {
  const inverse = state.direction === 'subtype', pair = state.mode === 'pair';
  document.querySelectorAll('[data-direction]').forEach((b) => {
    const active = b.dataset.direction === state.direction;
    b.classList.toggle('active', active); b.setAttribute('aria-pressed', active);
  });
  $('primary-gene-picker').hidden = inverse;
  $('j-picker').hidden = inverse || !pair; $('pair-plus').hidden = inverse || !pair;
  $('quick-genes').hidden = inverse;
  $('gene-options-info').hidden = inverse;
  document.querySelector('label[for="gene-search"]').textContent = pair ? '选择 V 基因' : '选择基因';
  $('rank-controls').hidden = !inverse;
  $('ranking-section').hidden = !inverse;
  document.querySelector('.distribution-section').hidden = inverse;
  $('clear-gene').textContent = inverse ? '清除高亮' : '清除选择';
  $('gene-heading').textContent = inverse ? '选择细胞亚型，查看基因排名' :
    (pair ? '选择同一条链的 V + J 组合' : '选择 V/J 基因');
}

function changeDirection(direction) {
  state.direction = direction;
  updateSelection();
}

function rankedGeneName(row) {
  const v = state.manifest.codebooks[state.locus][row.gene];
  return state.mode === 'single' ? v : `${v} + ${state.manifest.codebooks[partnerLocus()][row.partner]}`;
}

function renderGeneRanking() {
  const subtypes = state.data.info.subtypes;
  if (!subtypes.some((s) => s.code === state.rankSubtype)) state.rankSubtype = subtypes[0].code;
  $('rank-subtype').innerHTML = subtypes.map((s) => `<option value="${s.code}">${esc(s.label)}</option>`).join('');
  $('rank-subtype').value = String(state.rankSubtype);
  const subtype = subtypes.find((s) => s.code === state.rankSubtype), pair = state.mode === 'pair';
  const key = [state.lineage, state.study, state.cohort, state.mode, state.locus, state.rankSubtype].join('|');
  if (key !== state.rankKey) {
    const start = performance.now();
    state.rankData = subtypeGeneCounts(state.data.attrs, state.filtered, state.manifest.attributes.length,
      state.manifest.attributes.indexOf('cell_subtype_v3'), state.rankSubtype,
      state.manifest.attributes.indexOf(state.locus), pair ? state.manifest.attributes.indexOf(partnerLocus()) : null);
    state.rankKey = key; state.rankMs = performance.now() - start;
  }
  state.rankRows = sortGeneRanks(state.rankData.rows, state.rankSort).map((r, i) => ({ ...r,
    rank: i + 1, name: rankedGeneName(r) }));
  const term = state.rankSearch.trim().toUpperCase();
  const filtered = state.rankRows.filter((r) => r.name.toUpperCase().includes(term));
  const pages = Math.max(1, Math.ceil(filtered.length / state.rankPageSize));
  state.rankPage = Math.min(state.rankPage, pages - 1);
  const offset = state.rankPage * state.rankPageSize, shown = filtered.slice(offset, offset + state.rankPageSize);
  const selected = selectionName();
  $('ranking-title').textContent = `${subtype.label} · ${pair ? state.chain + ' V+J 组合' : state.locus} 排名`;
  $('ranking-description').textContent = `${fmt(state.rankData.subtypeCells)} 个亚型细胞 · ${fmt(state.rankData.subtypeValid)} 个有效细胞 · ${fmt(state.rankRows.length)} 个已观察${pair ? '组合' : '基因'}。点击名称查看 UMAP。`;
  $('ranking-quality').textContent = `缺失 ${fmt(state.rankData.subtypeMissing)} · 不确定 ${fmt(state.rankData.subtypeAmbiguous)}`;
  const activeRow = state.rankRows.find(r => r.gene === state.gene && (!pair || r.partner === state.geneJ));
  $('ranking-selection').innerHTML = `<span>${selected ? `已选 ${esc(selected)} · 此亚型 ${fmt(activeRow?.carriers || 0)} 个携带细胞 · 全队列高亮 ${fmt(state.summary.carrierTotal)} 个` : '点击基因名称选择，再查看右侧 UMAP 中的携带细胞。'}</span><button type="button" data-jump="maps">查看 UMAP ↑</button>`;
  $('rank-gene-heading').textContent = pair ? '同链 V + J 组合' : '基因';
  $('rank-usage-heading').textContent = `亚型内携带率${state.rankSort === 'usage' ? ' ↓' : ''}`;
  $('rank-share-heading').textContent = `携带者亚型占比${state.rankSort === 'subtypeShare' ? ' ↓' : ''}`;
  $('rank-usage-heading').closest('th').setAttribute('aria-sort', state.rankSort === 'usage' ? 'descending' : 'none');
  $('rank-share-heading').closest('th').setAttribute('aria-sort', state.rankSort === 'subtypeShare' ? 'descending' : 'none');
  const metricCell = (r, metric) => `<td class="rank-metric">${state.rankSort === metric ? `<span class="metric-bar" aria-hidden="true"><i style="width:${r[metric] * 100}%"></i></span>` : ''}<span>${percent(r[metric])}</span></td>`;
  $('ranking-body').innerHTML = shown.length ? shown.map((r) => {
    const active = state.gene === r.gene && (!pair || state.geneJ === r.partner);
    return `<tr data-rank-gene="${r.gene}"${pair ? ` data-rank-partner="${r.partner}"` : ''} class="${active ? 'selected-rank' : ''}">
      <td class="numeric">${r.rank}</td><td><button type="button" class="rank-gene-button" aria-pressed="${active}" data-rank-select="${r.rank}">${esc(r.name)}${active ? '<span class="selected-label">已选</span>' : ''}</button></td>
      <td class="numeric">${fmt(r.carriers)}</td>${metricCell(r, 'usage')}${metricCell(r, 'subtypeShare')}<td class="numeric">${fmt(r.allCarriers)}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="table-placeholder">${state.rankData.subtypeValid === 0 ? '当前筛选下，该亚型没有有效调用细胞' : '没有匹配的基因或组合'}</td></tr>`;
  $('rank-page-info').textContent = filtered.length ? `第 ${state.rankPage + 1} / ${pages} 页 · ${offset + 1}–${offset + shown.length} / ${fmt(filtered.length)} 项${term ? '（保留原排名）' : ''}` : '0 项';
  $('rank-prev').disabled = state.rankPage === 0;
  $('rank-next').disabled = state.rankPage >= pages - 1;
  $('ranking-note').textContent = `按${state.rankSort === 'usage' ? '亚型内携带率' : '携带者属于该亚型的比例'}降序排列，并列时优先携带细胞数更多者。${pair ? '有效细胞须在同一条链的 V、J 两个位点均有明确调用；仅统计同一细胞同时匹配的组合。' : `有效细胞须有明确的 ${state.locus} 调用。`}仅列出该亚型中实际出现的基因或组合，统计使用当前研究与细胞范围的完整队列，与已高亮基因无关。集中比例须结合细胞数查看；这些为细胞加权描述。`;
  updateContext();
}

function chooseRank(rank) {
  if (state.loading) return;
  const row = state.rankRows.find((r) => r.rank === rank);
  if (!row) return;
  if (state.mode === 'pair') state.geneJ = row.partner;
  chooseGene(row.gene);
  document.querySelector(`[data-rank-select="${rank}"]`)?.focus({ preventScroll: true });
}

function buildGrid() {
  const dim = 128, heads = new Int32Array(dim * dim).fill(-1), next = new Int32Array(state.data.info.cells).fill(-1);
  const [xmin, ymin, xmax, ymax] = state.data.info.bounds;
  const sx = (xmax - xmin || 1) / dim, sy = (ymax - ymin || 1) / dim;
  for (const i of state.filtered) {
    const x = Math.min(dim - 1, Math.max(0, Math.floor((state.data.coords[i * 2] - xmin) / sx)));
    const y = Math.min(dim - 1, Math.max(0, Math.floor((state.data.coords[i * 2 + 1] - ymin) / sy)));
    const bin = y * dim + x; next[i] = heads[bin]; heads[bin] = i;
  }
  state.grid = { heads, next, xmin, ymin, sx, sy, dim };
}

function hoverCell(canvas, event) {
  if (!state.grid) return;
  const rect = canvas.getBoundingClientRect(), v = state.view, grid = state.grid;
  const wx = v.cx + (event.clientX - rect.left - rect.width / 2) * v.scale;
  const wy = v.cy - (event.clientY - rect.top - rect.height / 2) * v.scale;
  const radius = 7 * v.scale;
  const minX = Math.max(0, Math.floor((wx - radius - grid.xmin) / grid.sx));
  const maxX = Math.min(grid.dim - 1, Math.floor((wx + radius - grid.xmin) / grid.sx));
  const minY = Math.max(0, Math.floor((wy - radius - grid.ymin) / grid.sy));
  const maxY = Math.min(grid.dim - 1, Math.floor((wy + radius - grid.ymin) / grid.sy));
  let best = -1, distance = radius * radius;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    for (let i = grid.heads[y * grid.dim + x]; i >= 0; i = grid.next[i]) {
      const dx = state.data.coords[i * 2] - wx, dy = state.data.coords[i * 2 + 1] - wy;
      const d = dx * dx + dy * dy;
      if (d < distance) { distance = d; best = i; }
    }
  }
  const tooltip = $('cell-tooltip');
  if (best < 0) { tooltip.hidden = true; return; }
  const stride = state.manifest.attributes.length, book = state.manifest.codebooks;
  const value = (field) => book[field][state.data.attrs[best * stride + state.manifest.attributes.indexOf(field)]];
  tooltip.innerHTML = `<strong>${esc(value('cell_subtype_v3'))}</strong><br><span>${esc(value('study_name'))} · ${esc(value('sample_name'))}</span><br>
    <div class="tooltip-genes">${state.manifest.loci.map((l) => `<div>${l} <strong>${esc(value(l))}</strong></div>`).join('')}</div>
    <span>源 RNA 行 ${fmt(state.data.rows[best])} · ${state.data.matched[best] ? 'TCR 已匹配' : 'TCR 表未匹配'}</span>`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 15, innerWidth - tooltip.offsetWidth - 12))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 15, innerHeight - tooltip.offsetHeight - 12))}px`;
}

function showError(error) {
  console.error(error);
  $('notice').dataset.ready = 'false'; $('notice').classList.add('error');
  $('notice').textContent = `无法完成加载：${error.message}`;
}

async function init() {
  const start = performance.now();
  try {
    genePicker = new GenePicker($('primary-gene-picker'), chooseGene);
    jPicker = new GenePicker($('j-picker'), code => {
      state.geneJ = code;
      genePicker.close();
      refreshGeneOptions(); updateSelection();
    });
    renderers = [new UmapRenderer($('reference-canvas'), true), new UmapRenderer($('highlight-canvas'), false)];
    state.manifest = await fetchJSON('/data/manifest.json');
    if (state.manifest.version !== 1) throw new Error('数据版本不兼容，请重新导出数据。');
    $('study-select').innerHTML = '<option value="all">全部研究</option>' + state.manifest.codebooks.study_name
      .map((name, code) => `<option value="${code}">${esc(name)}</option>`).join('');
    document.querySelectorAll('[data-lineage]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.lineage !== state.lineage) loadLineage(b.dataset.lineage);
    }));
    document.querySelectorAll('[data-locus]').forEach((b) => b.addEventListener('click', () => changeLocus(b.dataset.locus)));
    document.querySelectorAll('[data-chain]').forEach((b) => b.addEventListener('click', () => changeChain(b.dataset.chain)));
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => changeMode(b.dataset.mode)));
    document.querySelectorAll('[data-direction]').forEach((b) => b.addEventListener('click', () => changeDirection(b.dataset.direction)));
    $('rank-subtype').addEventListener('change', (e) => {
      state.rankSubtype = Number(e.target.value); state.rankPage = 0;
      state.gene = null; state.geneJ = null; refreshGeneOptions(); updateSelection();
    });
    $('rank-sort').addEventListener('change', (e) => { state.rankSort = e.target.value; state.rankPage = 0; renderGeneRanking(); });
    $('rank-search').addEventListener('input', (e) => { state.rankSearch = e.target.value; state.rankPage = 0; renderGeneRanking(); });
    $('ranking-body').addEventListener('click', (e) => { const b = e.target.closest('[data-rank-select]'); if (b) chooseRank(Number(b.dataset.rankSelect)); });
    $('rank-prev').addEventListener('click', () => { if (!state.loading && state.rankPage > 0) { state.rankPage--; renderGeneRanking(); } });
    $('rank-next').addEventListener('click', () => { if (!state.loading) { state.rankPage++; renderGeneRanking(); } });
    $('study-select').addEventListener('change', (e) => { state.study = e.target.value; applyFilters(); });
    $('quick-genes').addEventListener('click', (e) => { const b = e.target.closest('[data-gene]'); if (b) {
      if (state.mode === 'pair') state.geneJ = Number(b.dataset.geneJ);
      chooseGene(Number(b.dataset.gene));
    } });
    $('clear-gene').addEventListener('click', () => { $('gene-search').value = ''; $('gene-search-j').value = ''; state.gene = null; state.geneJ = null; refreshGeneOptions(); updateSelection(); });
    $('reset-view').addEventListener('click', () => resetView());
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => viewAction(b.dataset.view)));
    $('return-results').addEventListener('click', () => navigateTo('results'));
    document.addEventListener('click', e => { const b = e.target.closest('[data-jump]'); if (b) navigateTo(b.dataset.jump); });
    new IntersectionObserver(entries => { $('explorer-dock').hidden = entries[0].isIntersecting || !state.data; }).observe(document.querySelector('.gene-section'));
    mobileLayout.addEventListener('change', () => { state.rankPageSize = mobileLayout.matches ? 10 : 25; state.rankPage = 0; if (state.data && state.direction === 'subtype') renderGeneRanking(); });
    new ResizeObserver(() => { if (state.data) scheduleDraw(); }).observe($('reference-stage'));
    await loadLineage('CD8');
    state.initialMs = performance.now() - start;
  } catch (error) { showError(error); }
}

// Read-only inspection supports count, coordinate, and browser-performance validation.
window.tcrExplorer = Object.freeze({
  snapshot: () => ({ lineage: state.lineage, mode: state.mode, chain: state.chain, locus: state.locus, gene: state.gene,
    direction: state.direction, rankSubtype: state.rankSubtype, rankSort: state.rankSort,
    locusJ: state.mode === 'pair' ? partnerLocus() : null, geneJ: state.geneJ,
    geneName: selectionName(),
    study: state.study, cohort: state.cohort, cells: state.filtered.length,
    summary: state.summary ? Object.fromEntries(Object.entries(state.summary).map(([k, v]) => [k, ArrayBuffer.isView(v) ? Array.from(v) : v])) : null,
    view: state.view ? { ...state.view } : null, rendering: renderers.map((r) => ({ cells: r.count, carriers: r.carrierCount })),
    timing: { initialMs: state.initialMs, filterMs: state.filterMs, selectionMs: state.selectionMs, rankingMs: state.rankMs }, loading: state.loading }),
  ranks: () => state.rankData ? { subtype: state.rankSubtype, sort: state.rankSort,
    subtypeCells: state.rankData.subtypeCells, subtypeValid: state.rankData.subtypeValid,
    missing: state.rankData.subtypeMissing, ambiguous: state.rankData.subtypeAmbiguous,
    rows: state.rankRows.map((r) => ({ ...r })) } : null,
  cell: (sourceRow) => {
    if (!state.data) return null;
    const index = state.data.rows.indexOf(sourceRow);
    if (index < 0) return null;
    return { sourceRow, xy: Array.from(state.data.coords.slice(index * 2, index * 2 + 2)),
      matched: Boolean(state.data.matched[index]), ...Object.fromEntries(state.manifest.attributes.map((f, j) =>
        [f, state.manifest.codebooks[f][state.data.attrs[index * state.manifest.attributes.length + j]]])) };
  },
});

init();
