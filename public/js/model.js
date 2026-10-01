// 把 TopoJSON 轉成計算與繪圖用的資料結構（平面座標、型別陣列）
import { project } from './split.js';

function ringToWorld(ring) {
  const out = new Float64Array(ring.length * 2);
  ring.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    out[2 * i] = x; out[2 * i + 1] = y;
  });
  return out;
}

function signedArea(r) {
  let s = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) s += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return s / 2;
}

export function buildModel(topo, meta, topojson) {
  const features = topojson.feature(topo, topo.objects.villages).features;
  const count = features.length;
  const model = {
    count,
    counties: meta.counties,
    towns: meta.towns,
    cx: new Float64Array(count),
    cy: new Float64Array(count),
    pop: new Float64Array(count),
    area: new Float64Array(count),
    bbox: new Float64Array(count * 4),
    county: new Uint16Array(count),
    rings: new Array(count),
    ringArea: new Float64Array(count),
    names: new Array(count),
    totalPop: 0,
    totalArea: 0,
    countyArea: new Float64Array(meta.counties.length),
    extent: [Infinity, Infinity, -Infinity, -Infinity],
  };

  features.forEach((f, i) => {
    const p = f.properties;
    const [x, y] = project(p.c[0], p.c[1]);
    model.cx[i] = x; model.cy[i] = y;
    model.pop[i] = p.p;
    model.area[i] = p.a;
    const [countyIdx, townName] = meta.towns[p.t];
    model.county[i] = countyIdx;
    model.names[i] = meta.counties[countyIdx] + townName + p.n;
    model.totalPop += p.p;
    model.totalArea += p.a;
    model.countyArea[countyIdx] += p.a;

    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.flat().map(ringToWorld);
    model.rings[i] = rings;
    model.ringArea[i] = rings.reduce((s, r) => s + signedArea(r), 0);

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) {
      for (let k = 0; k < r.length; k += 2) {
        if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k];
        if (r[k + 1] < y0) y0 = r[k + 1]; if (r[k + 1] > y1) y1 = r[k + 1];
      }
    }
    model.bbox.set([x0, y0, x1, y1], i * 4);
    const e = model.extent;
    e[0] = Math.min(e[0], x0); e[1] = Math.min(e[1], y0);
    e[2] = Math.max(e[2], x1); e[3] = Math.max(e[3], y1);
  });

  // 鄉鎮界、縣市界、海岸線（共用邊只畫一次）
  const towns = (f) => f.properties.t;
  const countyOf = (f) => meta.towns[f.properties.t][0];
  const meshToWorld = (filter) =>
    topojson.mesh(topo, topo.objects.villages, filter).coordinates.map(ringToWorld);
  model.townBorders = meshToWorld((a, b) => a !== b && towns(a) !== towns(b) && countyOf(a) === countyOf(b));
  model.countyBorders = meshToWorld((a, b) => a !== b && countyOf(a) !== countyOf(b));
  model.coast = meshToWorld((a, b) => a === b);
  return model;
}

// 點是否在村里多邊形內（射線法，含洞）
export function hitTest(model, x, y) {
  const { bbox, rings, count } = model;
  for (let i = 0; i < count; i++) {
    const b = 4 * i;
    if (x < bbox[b] || x > bbox[b + 2] || y < bbox[b + 1] || y > bbox[b + 3]) continue;
    let inside = false;
    for (const r of rings[i]) {
      const n = r.length / 2;
      for (let p = 0, q = n - 1; p < n; q = p++) {
        const xp = r[2 * p], yp = r[2 * p + 1], xq = r[2 * q], yq = r[2 * q + 1];
        if ((yp > y) !== (yq > y) && x < ((xq - xp) * (y - yp)) / (yq - yp) + xp) inside = !inside;
      }
    }
    if (inside) return i;
  }
  return -1;
}
