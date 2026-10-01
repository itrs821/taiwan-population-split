// 分割線的幾何與統計計算（純函式，不碰 DOM）
//
// 座標系：以 (LON0, LAT0) 為原點的平面座標，單位公里，x 向東、y 向北。
// 分割線以角度 theta（線的方向，自正東逆時針，0–180°）與 offset 表示：
//   法向量 n = (-sin θ, cos θ)，滿足 n·p = offset 的點都在線上。
//   n·p > offset 為 A 側（法向量指向的那一側），其餘為 B 側。

export const LON0 = 120.95;
export const LAT0 = 23.7;
const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110.574;

export const project = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const unproject = (x, y) => [x / KX + LON0, y / KY + LAT0];

const rad = (deg) => (deg * Math.PI) / 180;
export const normalOf = (theta) => [-Math.sin(rad(theta)), Math.cos(rad(theta))];
export const directionOf = (theta) => [Math.cos(rad(theta)), Math.sin(rad(theta))];

export function normalizeTheta(theta) {
  return ((theta % 180) + 180) % 180;
}

const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
// 法向量所指的方位名稱，例如 A 側在「西北」
export function sideNames(theta) {
  const [nx, ny] = normalOf(theta);
  const bearing = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
  const i = Math.round(bearing / 45) % 8;
  return [COMPASS[i], COMPASS[(i + 4) % 8]];
}

// 依某角度，找出把人口平分的 offset（以村里重心的加權中位數）
export function balanceOffset(model, theta) {
  const [nx, ny] = normalOf(theta);
  const { cx, cy, pop, count, totalPop } = model;
  const proj = new Float64Array(count);
  for (let i = 0; i < count; i++) proj[i] = cx[i] * nx + cy[i] * ny;
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => proj[a] - proj[b]);
  const half = totalPop / 2;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    acc += pop[order[k]];
    if (acc >= half) {
      // 讓剛好越過一半的村里落在 B 側，與下一個村里取中點
      const next = k + 1 < count ? proj[order[k + 1]] : proj[order[k]];
      // 判斷：讓這個村里留在 B 側還是 A 側比較接近 50%
      const before = acc - pop[order[k]];
      if (half - before < acc - half && k > 0) {
        return (proj[order[k - 1]] + proj[order[k]]) / 2;
      }
      return (proj[order[k]] + next) / 2;
    }
  }
  return 0;
}

// 一個環在半平面 n·p >= offset 內的有號面積（Sutherland–Hodgman 裁切後算鞋帶公式）
function clippedRingArea(ring, nx, ny, offset) {
  const n = ring.length / 2;
  let area = 0;
  let firstX, firstY, lastX, lastY, has = false;
  const emit = (x, y) => {
    if (!has) { firstX = x; firstY = y; has = true; }
    else area += lastX * y - x * lastY;
    lastX = x; lastY = y;
  };
  let px = ring[2 * n - 2], py = ring[2 * n - 1];
  let dp = px * nx + py * ny - offset;
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i], y = ring[2 * i + 1];
    const d = x * nx + y * ny - offset;
    if (d >= 0) {
      if (dp < 0) { const t = dp / (dp - d); emit(px + t * (x - px), py + t * (y - py)); }
      emit(x, y);
    } else if (dp >= 0) {
      const t = dp / (dp - d); emit(px + t * (x - px), py + t * (y - py));
    }
    px = x; py = y; dp = d;
  }
  if (has) area += lastX * firstY - firstX * lastY;
  return area / 2;
}

// 計算兩側的人口與面積，以及每個縣市被切開的比例
export function splitStats(model, theta, offset) {
  const [nx, ny] = normalOf(theta);
  const { cx, cy, pop, area, bbox, rings, ringArea, county, count } = model;
  let popA = 0, areaA = 0;
  const countyA = new Float64Array(model.counties.length);
  for (let i = 0; i < count; i++) {
    if (cx[i] * nx + cy[i] * ny > offset) popA += pop[i];

    // 用外框四角判斷是否整個在某一側
    const b = 4 * i;
    const p1 = bbox[b] * nx + bbox[b + 1] * ny, p2 = bbox[b + 2] * nx + bbox[b + 1] * ny;
    const p3 = bbox[b] * nx + bbox[b + 3] * ny, p4 = bbox[b + 2] * nx + bbox[b + 3] * ny;
    const lo = Math.min(p1, p2, p3, p4), hi = Math.max(p1, p2, p3, p4);
    let a;
    if (lo >= offset) a = area[i];
    else if (hi <= offset) a = 0;
    else {
      let s = 0;
      for (const r of rings[i]) s += clippedRingArea(r, nx, ny, offset);
      a = area[i] * Math.min(1, Math.max(0, s / ringArea[i]));
    }
    areaA += a;
    countyA[county[i]] += a;
  }
  const crossed = [];
  model.counties.forEach((name, c) => {
    const shareA = countyA[c] / model.countyArea[c];
    if (shareA > 0.005 && shareA < 0.995) crossed.push({ name, shareA });
  });
  return {
    popA, popB: model.totalPop - popA,
    areaA, areaB: model.totalArea - areaA,
    crossed,
  };
}

// 找出「人口占比與面積占比差距最大」的分割線：台灣版的胡煥庸線
// 對每個角度把村里依投影排序，累加人口與面積占比，取差距最大的切點
export function findHuLine(model, step = 0.5) {
  const { cx, cy, pop, area, count, totalPop, totalArea } = model;
  const proj = new Float64Array(count);
  const order = new Uint32Array(count);
  let best = { score: -1 };
  for (let theta = 0; theta < 180; theta += step) {
    const [nx, ny] = normalOf(theta);
    for (let i = 0; i < count; i++) { proj[i] = cx[i] * nx + cy[i] * ny; order[i] = i; }
    order.sort((a, b) => proj[a] - proj[b]);
    let cp = 0, ca = 0;
    for (let k = 0; k < count - 1; k++) {
      const i = order[k];
      cp += pop[i]; ca += area[i];
      const score = Math.abs(cp / totalPop - ca / totalArea);
      if (score > best.score) {
        best = { score, theta, offset: (proj[i] + proj[order[k + 1]]) / 2 };
      }
    }
  }
  return best;
}
