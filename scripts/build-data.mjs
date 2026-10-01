// 把村里界線 (內政部村里界圖，經 taiwan-atlas 轉成 TopoJSON) 與村里人口合併，
// 只保留台灣本島，輸出前端使用的 public/data/taiwan.topo.json 與 meta.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as topojsonClient from 'topojson-client';
import * as topojsonServer from 'topojson-server';
import * as topojsonSimplify from 'topojson-simplify';
import { geoArea, geoCentroid } from 'd3-geo';

const ATLAS_VERSION = '2021.9.20';
const ATLAS_URL = `https://cdn.jsdelivr.net/npm/taiwan-atlas@${ATLAS_VERSION}/villages-10t.json`;
const CACHE = `.cache/villages-10t-${ATLAS_VERSION}.json`;
const EARTH_RADIUS_KM = 6371.0088;

// 離島：整個縣或整個鄉都排除
const EXCLUDED_COUNTIES = new Set(['澎湖縣', '金門縣', '連江縣']);
const EXCLUDED_TOWNS = new Set(['臺東縣綠島鄉', '臺東縣蘭嶼鄉', '屏東縣琉球鄉']);
// 本島範圍：用來剔除屬於本島村里、但位在外海的小島（例如釣魚台）
const MAIN_BBOX = { minLon: 119.9, maxLon: 122.1, minLat: 21.8, maxLat: 25.4 };

// 界線資料用「台」、人口資料用「臺」，一律統一成「臺」
const norm = (s) => s.replace(/台/g, '臺');

const isExcluded = (county, town) =>
  EXCLUDED_COUNTIES.has(county) || EXCLUDED_TOWNS.has(county + town);

async function loadBoundaries() {
  if (!existsSync(CACHE)) {
    console.log(`下載村里界線 ${ATLAS_URL}`);
    const res = await fetch(ATLAS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir('.cache', { recursive: true });
    await writeFile(CACHE, await res.text());
  }
  return JSON.parse(await readFile(CACHE, 'utf8'));
}

async function loadPopulation() {
  const yyymm = (await readFile('data-raw/latest.txt', 'utf8')).trim();
  const lines = (await readFile(`data-raw/population-${yyymm}.csv`, 'utf8')).trim().split('\n').slice(1);
  const rows = lines.map((l) => {
    const [code, site, village, households, population] = l.split(',');
    return { code, site, village, households: +households, population: +population };
  });
  return { yyymm, rows };
}

function polygonInBBox(rings) {
  return rings[0].every(([lon, lat]) =>
    lon >= MAIN_BBOX.minLon && lon <= MAIN_BBOX.maxLon && lat >= MAIN_BBOX.minLat && lat <= MAIN_BBOX.maxLat);
}

// 只留下本島範圍內的多邊形
function clipToMainIsland(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const kept = polys.filter(polygonInBBox);
  if (kept.length === 0) return null;
  return kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept };
}

async function main() {
  const topo = await loadBoundaries();
  const { yyymm, rows } = await loadPopulation();

  // 1. 村里界線：排除離島
  const villages = [];
  for (const f of topojsonClient.feature(topo, topo.objects.villages).features) {
    const p = { ...f.properties, COUNTYNAME: norm(f.properties.COUNTYNAME), TOWNNAME: norm(f.properties.TOWNNAME) };
    if (isExcluded(p.COUNTYNAME, p.TOWNNAME)) continue;
    const geometry = clipToMainIsland(f.geometry);
    if (!geometry) continue;
    villages.push({ type: 'Feature', geometry, properties: p });
  }

  // 2. 村里人口：排除離島
  const popRows = rows.filter((r) => {
    const county = r.site.slice(0, 3);
    const town = r.site.slice(3);
    return !isExcluded(county, town);
  });

  // 3. 合併：先比對村里代碼，再比對「鄉鎮市區 + 村里名稱」，剩下的人口在同一鄉鎮內分配
  const byCode = new Map(villages.map((v) => [v.properties.VILLCODE, v]));
  const byName = new Map(villages.map((v) => [v.properties.TOWNCODE + v.properties.VILLNAME, v]));
  const pop = new Map(); // VILLCODE -> population
  const leftoverByTown = new Map(); // TOWNCODE -> population
  let matchedByCode = 0, matchedByName = 0, leftover = 0;
  for (const r of popRows) {
    let v = byCode.get(r.code);
    if (v) matchedByCode++;
    else {
      v = byName.get(r.code.slice(0, 8) + r.village);
      if (v) matchedByName++;
    }
    if (v) {
      const k = v.properties.VILLCODE;
      pop.set(k, (pop.get(k) || 0) + r.population);
    } else {
      const town = r.code.slice(0, 8);
      leftoverByTown.set(town, (leftoverByTown.get(town) || 0) + r.population);
      leftover++;
    }
  }
  for (const [town, extra] of leftoverByTown) {
    const inTown = villages.filter((v) => v.properties.TOWNCODE === town);
    if (inTown.length === 0) { console.warn(`找不到鄉鎮 ${town}，${extra} 人未分配`); continue; }
    // 沒有對到人口的村里優先接收；依面積分配
    const unmatched = inTown.filter((v) => !pop.has(v.properties.VILLCODE));
    const targets = unmatched.length ? unmatched : inTown;
    const areas = targets.map((v) => geoArea(v));
    const sum = areas.reduce((a, b) => a + b, 0);
    targets.forEach((v, i) => {
      const k = v.properties.VILLCODE;
      pop.set(k, (pop.get(k) || 0) + Math.round(extra * areas[i] / sum));
    });
  }

  // 4. 建立縣市、鄉鎮索引表與精簡屬性
  const counties = [], countyIndex = new Map();
  const towns = [], townIndex = new Map();
  const features = villages.map((v) => {
    const p = v.properties;
    if (!countyIndex.has(p.COUNTYNAME)) { countyIndex.set(p.COUNTYNAME, counties.length); counties.push(p.COUNTYNAME); }
    if (!townIndex.has(p.TOWNCODE)) { townIndex.set(p.TOWNCODE, towns.length); towns.push([countyIndex.get(p.COUNTYNAME), p.TOWNNAME]); }
    const [lon, lat] = geoCentroid(v);
    return {
      type: 'Feature',
      geometry: v.geometry,
      properties: {
        n: p.VILLNAME,
        t: townIndex.get(p.TOWNCODE),
        p: pop.get(p.VILLCODE) || 0,
        a: +(geoArea(v) * EARTH_RADIUS_KM ** 2).toFixed(4),
        c: [+lon.toFixed(5), +lat.toFixed(5)],
      },
    };
  });

  // 5. 重建 TopoJSON、簡化、量化
  let out = topojsonServer.topology({ villages: { type: 'FeatureCollection', features } });
  out = topojsonSimplify.presimplify(out);
  out = topojsonSimplify.simplify(out, topojsonSimplify.quantile(out, 0.35));
  out = topojsonClient.quantize(out, 1e5);

  const totalPop = features.reduce((s, f) => s + f.properties.p, 0);
  const totalArea = features.reduce((s, f) => s + f.properties.a, 0);
  const meta = {
    yyymm,
    period: `${Math.floor(yyymm / 100) + 1911} 年 ${Number(yyymm.slice(-2))} 月`,
    population: totalPop,
    area: Math.round(totalArea),
    villages: features.length,
    counties,
    towns,
    sources: {
      population: '內政部戶政司 村里戶數、單一年齡人口 (ODRP014)',
      boundaries: `內政部 村里界圖 (TWD97經緯度)，經 taiwan-atlas@${ATLAS_VERSION} 轉檔`,
    },
  };

  await mkdir('public/data', { recursive: true });
  await writeFile('public/data/taiwan.topo.json', JSON.stringify(out));
  await writeFile('public/data/meta.json', JSON.stringify(meta, null, 2));

  const allPop = rows.reduce((s, r) => s + r.population, 0);
  console.log(`資料月份 ${meta.period}`);
  console.log(`本島村里 ${features.length}，人口 ${totalPop.toLocaleString()}（全國 ${allPop.toLocaleString()}，占 ${(totalPop / allPop * 100).toFixed(2)}%）`);
  console.log(`本島面積 ${meta.area.toLocaleString()} km²`);
  console.log(`代碼比對 ${matchedByCode}、名稱比對 ${matchedByName}、鄉鎮內分配 ${leftover} 筆`);
  console.log(`無人口村里 ${features.filter((f) => f.properties.p === 0).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
