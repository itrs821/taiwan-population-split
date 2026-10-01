import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
import { buildModel, hitTest } from './model.js';
import {
  normalOf, directionOf, normalizeTheta, sideNames,
  balanceOffset, splitStats, findHuLine,
} from './split.js';

// 發佈到 GitHub 後填入，頁尾會顯示「原始碼」連結
const REPO_URL = 'https://github.com/itrs821/taiwan-population-split';

const DENSITY_BREAKS = [10, 50, 200, 1000, 5000, 20000]; // 人/km²
const DENSITY_LABELS = ['<10', '10', '50', '200', '1千', '5千', '2萬'];
const SHADE = [0.12, 0.25, 0.4, 0.56, 0.72, 0.87, 1];
const FAR = 3000; // km，足以讓線和半平面蓋過全島

const $ = (id) => document.getElementById(id);
const mapEl = $('map');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const state = { theta: 90, offset: 0 };
const view = { k: 1, tx: 0, ty: 0, minK: 0.1, maxK: 100 }; // 螢幕 = (tx + k·x, ty − k·y)
let model, classPaths, borders, palettes, pivot = [0, 0], huCache = null;
let width = 0, height = 0, dpr = 1;

const toScreen = (x, y) => [view.tx + view.k * x, view.ty - view.k * y];
const toWorld = (sx, sy) => [(sx - view.tx) / view.k, (view.ty - sy) / view.k];

const fmtInt = (n) => Math.round(n).toLocaleString('zh-TW');
const fmtPct = (n) => (n * 100).toFixed(1) + '%';

// ---------- 顏色 ----------
function hexToRgb(hex) {
  const v = parseInt(hex.trim().replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function mix(c1, c2, t) {
  return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(',')})`;
}
function readPalettes() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => hexToRgb(css.getPropertyValue(name));
  const build = (soft, strong) => SHADE.map((t) => mix(get(soft), get(strong), t));
  palettes = {
    a: build('--a-soft', '--a'),
    b: build('--b-soft', '--b'),
    ink: css.getPropertyValue('--ink').trim(),
    panel: css.getPropertyValue('--panel').trim(),
  };
  renderLegend();
}

// ---------- 預先建立繪圖路徑 ----------
function ringsToPath(path, rings) {
  for (const r of rings) {
    path.moveTo(r[0], r[1]);
    for (let k = 2; k < r.length; k += 2) path.lineTo(r[k], r[k + 1]);
    path.closePath();
  }
}
function linesToPath(lines) {
  const p = new Path2D();
  for (const r of lines) {
    p.moveTo(r[0], r[1]);
    for (let k = 2; k < r.length; k += 2) p.lineTo(r[k], r[k + 1]);
  }
  return p;
}
function buildPaths() {
  classPaths = SHADE.map(() => new Path2D());
  for (let i = 0; i < model.count; i++) {
    const d = model.pop[i] / model.area[i];
    let c = 0;
    while (c < DENSITY_BREAKS.length && d >= DENSITY_BREAKS[c]) c++;
    ringsToPath(classPaths[c], model.rings[i]);
  }
  borders = {
    town: linesToPath(model.townBorders),
    county: linesToPath(model.countyBorders),
    coast: linesToPath(model.coast),
  };
}

// ---------- 版面與視角 ----------
function resize() {
  dpr = window.devicePixelRatio || 1;
  width = mapEl.clientWidth;
  height = mapEl.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
}
function fit() {
  const [x0, y0, x1, y1] = model.extent;
  const pad = 28;
  const k = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (y1 - y0));
  view.k = k;
  view.minK = k * 0.5;
  view.maxK = k * 80;
  view.tx = width / 2 - (k * (x0 + x1)) / 2;
  view.ty = height / 2 + (k * (y0 + y1)) / 2;
}
function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  view.k = Math.min(view.maxK, Math.max(view.minK, view.k * factor));
  view.tx = sx - view.k * wx;
  view.ty = sy + view.k * wy;
  invalidate();
}

// ---------- 繪圖 ----------
function halfPlane(sign) {
  const [nx, ny] = normalOf(state.theta);
  const [dx, dy] = directionOf(state.theta);
  const px = nx * state.offset, py = ny * state.offset;
  const p = new Path2D();
  p.moveTo(px + dx * FAR, py + dy * FAR);
  p.lineTo(px - dx * FAR, py - dy * FAR);
  p.lineTo(px - dx * FAR + sign * nx * FAR, py - dy * FAR + sign * ny * FAR);
  p.lineTo(px + dx * FAR + sign * nx * FAR, py + dy * FAR + sign * ny * FAR);
  p.closePath();
  return p;
}

function renderMap() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
  for (const [sign, pal] of [[1, palettes.a], [-1, palettes.b]]) {
    ctx.save();
    ctx.clip(halfPlane(sign));
    classPaths.forEach((p, c) => { ctx.fillStyle = pal[c]; ctx.fill(p); });
    ctx.restore();
  }
  const px = 1 / view.k;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palettes.panel;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.6 * px;
  ctx.stroke(borders.town);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.6 * px;
  ctx.stroke(borders.county);
  ctx.strokeStyle = palettes.ink;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.8 * px;
  ctx.stroke(borders.coast);
  ctx.globalAlpha = 1;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function renderOverlay() {
  const [nx, ny] = normalOf(state.theta);
  const [dx, dy] = directionOf(state.theta);
  // 支點：線上最接近畫面中心的點
  const [cx, cy] = toWorld(width / 2, height / 2);
  const dist = cx * nx + cy * ny - state.offset;
  pivot = [cx - nx * dist, cy - ny * dist];

  const [x1, y1] = toScreen(pivot[0] + dx * FAR, pivot[1] + dy * FAR);
  const [x2, y2] = toScreen(pivot[0] - dx * FAR, pivot[1] - dy * FAR);
  for (const el of [$('line'), $('line-hit')]) setAttrs(el, { x1, y1, x2, y2 });

  const r = Math.min(width, height) * 0.38 / view.k;
  const [k1x, k1y] = toScreen(pivot[0] + dx * r, pivot[1] + dy * r);
  const [k2x, k2y] = toScreen(pivot[0] - dx * r, pivot[1] - dy * r);
  setAttrs($('knob-1'), { cx: k1x, cy: k1y });
  setAttrs($('knob-2'), { cx: k2x, cy: k2y });

  // 標籤放在線的兩側，依法向量方向決定對齊，避免文字壓到線
  const gap = 16 / view.k;
  for (const [key, sign] of [['a', 1], ['b', -1]]) {
    const [x, y] = toScreen(pivot[0] + sign * nx * gap, pivot[1] + sign * ny * gap);
    const ux = sign * nx, uy = -sign * ny; // 螢幕座標中的方向
    setAttrs($(`label-${key}`), {
      x, y,
      'text-anchor': ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle',
      'dominant-baseline': uy > 0.3 ? 'hanging' : uy < -0.3 ? 'auto' : 'middle',
    });
  }
}

// ---------- 統計面板 ----------
function renderStats() {
  const s = splitStats(model, state.theta, state.offset);
  const [na, nb] = sideNames(state.theta);
  const P = model.totalPop, A = model.totalArea;
  const sides = [
    { key: 'a', name: na, pop: s.popA, area: s.areaA },
    { key: 'b', name: nb, pop: s.popB, area: s.areaB },
  ];
  for (const side of sides) {
    $(`name-${side.key}`).textContent = `${side.name}側`;
    $(`pop-${side.key}`).textContent = fmtPct(side.pop / P);
    $(`pop-${side.key}-abs`).textContent = `${fmtInt(side.pop)} 人`;
    $(`area-${side.key}`).textContent = `${fmtInt(side.area)} km²（${fmtPct(side.area / A)}）`;
    $(`dens-${side.key}`).textContent = side.area > 0.5 ? `${fmtInt(side.pop / side.area)} 人/km²` : '—';
    $(`label-${side.key}`).textContent = `${side.name}側 ${fmtPct(side.pop / P)}`;
  }
  $('bar-pop').style.width = fmtPct(s.popA / P);
  $('bar-area').style.width = fmtPct(s.areaA / A);

  // 以密度較高的一側描述，像胡煥庸線那樣：X% 的土地住了 Y% 的人
  const dense = sides
    .filter((x) => x.area > 0.5)
    .sort((x, y) => y.pop / y.area - x.pop / x.area)[0];
  $('headline').innerHTML = dense && dense.pop > 0
    ? `<b class="${dense.key}">${dense.name}側</b>以 <b class="${dense.key}">${fmtPct(dense.area / A)}</b> 的土地，住了 <b class="${dense.key}">${fmtPct(dense.pop / P)}</b> 的人口。`
    : '';

  const list = $('crossed');
  list.replaceChildren();
  if (s.crossed.length === 0) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = '沒有切過任何縣市';
    list.append(li);
  }
  for (const c of s.crossed.sort((x, y) => y.shareA - x.shareA)) {
    const li = document.createElement('li');
    li.title = `${na}側 ${fmtPct(c.shareA)}｜${nb}側 ${fmtPct(1 - c.shareA)}（面積）`;
    li.innerHTML = `<span>${c.name}</span><div class="mini"><i style="width:${fmtPct(c.shareA)}"></i></div>`;
    list.append(li);
  }

  $('angle').value = state.theta;
  $('angle-out').textContent = `${state.theta.toFixed(1).replace(/\.0$/, '')}°`;
}

function renderLegend() {
  const row = (pal) => `<div class="row">${pal.map((c) => `<div class="cell"><i style="background:${c}"></i></div>`).join('')}</div>`;
  $('legend').innerHTML = `人口密度（人/km²）${row(palettes.a)}${row(palettes.b)}` +
    `<div class="row">${DENSITY_LABELS.map((l) => `<div class="cell">${l}</div>`).join('')}</div>`;
}

let frame = 0;
function invalidate() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderMap();
    renderOverlay();
    renderStats();
  });
}

// ---------- 網址分享 ----------
function saveHash() {
  history.replaceState(null, '', `#a=${state.theta.toFixed(1)}&o=${state.offset.toFixed(2)}`);
}
function loadHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const a = parseFloat(params.get('a')), o = parseFloat(params.get('o'));
  if (Number.isFinite(a) && Number.isFinite(o)) {
    state.theta = normalizeTheta(a);
    state.offset = o;
    return true;
  }
  return false;
}

// ---------- 操作 ----------
function setLine(theta, offset) {
  state.theta = normalizeTheta(theta);
  state.offset = offset ?? balanceOffset(model, state.theta);
  invalidate();
  saveHash();
}

function rotateTo(theta, around) {
  theta = normalizeTheta(theta);
  if ($('keep-balanced').checked) setLine(theta);
  else {
    const [nx, ny] = normalOf(theta);
    setLine(theta, around[0] * nx + around[1] * ny);
  }
}

function bindControls() {
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'lr') setLine(90);
      else if (action === 'tb') setLine(0);
      else if (action === 'balance') setLine(state.theta);
      else if (action === 'hu') {
        if (huCache) return setLine(huCache.theta, huCache.offset);
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = '計算中…';
        setTimeout(() => {
          huCache = findHuLine(model);
          btn.disabled = false;
          btn.textContent = label;
          setLine(huCache.theta, huCache.offset);
        }, 30);
      }
    });
  });
  $('angle').addEventListener('input', (e) => rotateTo(parseFloat(e.target.value), pivot));
  document.querySelectorAll('[data-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.zoom;
      if (z === 'fit') { fit(); invalidate(); }
      else zoomAt(width / 2, height / 2, z === 'in' ? 1.6 : 1 / 1.6);
    });
  });
}

function bindPointer() {
  const pointers = new Map();
  let drag = null, pinch = null;
  const local = (e) => {
    const r = mapEl.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  mapEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoom')) return;
    mapEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    $('tooltip').hidden = true;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      drag = null;
      return;
    }
    const [sx, sy] = local(e);
    const role = e.target.dataset?.role;
    if (role === 'line') drag = { mode: 'line', start: toWorld(sx, sy), offset: state.offset };
    else if (role === 'knob') drag = { mode: 'rotate', pivot: [...pivot], sign: Number(e.target.dataset.sign) };
    else {
      drag = { mode: 'pan', sx, sy, tx: view.tx, ty: view.ty };
      mapEl.classList.add('panning');
    }
  });

  mapEl.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    // 若錯過了 pointerup（例如在視窗外放開滑鼠），按鍵已放開就結束拖曳
    if (drag && e.pointerType === 'mouse' && e.buttons === 0) end(e);

    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      view.tx += mid[0] - pinch.mid[0];
      view.ty += mid[1] - pinch.mid[1];
      zoomAt(mid[0], mid[1], dist / pinch.dist);
      pinch = { dist, mid };
      return;
    }
    if (!drag) {
      if (e.pointerType === 'mouse') showTooltip(sx, sy, e.target);
      return;
    }
    if (drag.mode === 'pan') {
      view.tx = drag.tx + sx - drag.sx;
      view.ty = drag.ty + sy - drag.sy;
      invalidate();
    } else if (drag.mode === 'line') {
      const [wx, wy] = toWorld(sx, sy);
      const [nx, ny] = normalOf(state.theta);
      state.offset = drag.offset + (wx - drag.start[0]) * nx + (wy - drag.start[1]) * ny;
      invalidate();
    } else if (drag.mode === 'rotate') {
      const [wx, wy] = toWorld(sx, sy);
      const vx = (wx - drag.pivot[0]) * drag.sign, vy = (wy - drag.pivot[1]) * drag.sign;
      if (Math.hypot(vx, vy) * view.k < 8) return;
      const theta = Math.round(((Math.atan2(vy, vx) * 180) / Math.PI) * 2) / 2;
      rotateTo(theta, drag.pivot);
    }
  });

  function end(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && drag.mode !== 'pan') saveHash();
    drag = null;
    mapEl.classList.remove('panning');
  }
  mapEl.addEventListener('pointerup', end);
  mapEl.addEventListener('pointercancel', end);
  mapEl.addEventListener('pointerleave', () => { $('tooltip').hidden = true; });

  mapEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}

function showTooltip(sx, sy, target) {
  const tip = $('tooltip');
  if (target !== canvas) { tip.hidden = true; return; }
  const i = hitTest(model, ...toWorld(sx, sy));
  if (i < 0) { tip.hidden = true; return; }
  const density = model.pop[i] / model.area[i];
  tip.innerHTML = `<b>${model.names[i]}</b>${fmtInt(model.pop[i])} 人 · ${model.area[i].toFixed(2)} km² · ${fmtInt(density)} 人/km²`;
  tip.style.left = `${sx}px`;
  tip.style.top = `${sy}px`;
  tip.hidden = false;
}

// ---------- 啟動 ----------
async function main() {
  const [topo, meta] = await Promise.all([
    fetch('data/taiwan.topo.json').then((r) => r.json()),
    fetch('data/meta.json').then((r) => r.json()),
  ]);
  model = buildModel(topo, meta, topojson);
  buildPaths();
  readPalettes();

  $('period').textContent = meta.period;
  $('src-pop').textContent = meta.sources.population;
  $('src-geo').textContent = meta.sources.boundaries;
  if (REPO_URL) $('repo-link').href = REPO_URL;
  else $('repo-link').remove();

  resize();
  fit();
  if (!loadHash()) state.offset = balanceOffset(model, state.theta);
  bindControls();
  bindPointer();

  new ResizeObserver(() => { resize(); fit(); invalidate(); }).observe(mapEl);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readPalettes(); invalidate(); });
  window.addEventListener('hashchange', () => { if (loadHash()) invalidate(); });

  $('loading').hidden = true;
  invalidate();
}

main().catch((err) => {
  console.error(err);
  $('loading').textContent = '資料載入失敗，請重新整理頁面。';
});
