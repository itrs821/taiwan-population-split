// 快速驗證計算結果：node scripts/check.mjs
import { readFile } from 'node:fs/promises';
import * as topojson from 'topojson-client';
import { buildModel } from '../public/js/model.js';
import { balanceOffset, splitStats, findHuLine, sideNames } from '../public/js/split.js';

const topo = JSON.parse(await readFile('public/data/taiwan.topo.json', 'utf8'));
const meta = JSON.parse(await readFile('public/data/meta.json', 'utf8'));
let t = performance.now();
const model = buildModel(topo, meta, topojson);
console.log(`model ${model.count} 村里, ${(performance.now() - t).toFixed(0)} ms, 面積 ${model.totalArea.toFixed(0)}`);

const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%';
function report(label, theta, offset) {
  t = performance.now();
  const s = splitStats(model, theta, offset);
  const ms = (performance.now() - t).toFixed(1);
  const [na, nb] = sideNames(theta);
  console.log(`${label} θ=${theta} off=${offset.toFixed(2)} | ${na}側 人口 ${pct(s.popA, model.totalPop)} 面積 ${pct(s.areaA, model.totalArea)} | ${nb}側 人口 ${pct(s.popB, model.totalPop)} 面積 ${pct(s.areaB, model.totalArea)} | ${ms} ms`);
  console.log('  切過：' + s.crossed.map((c) => `${c.name}(${(c.shareA * 100).toFixed(0)}%)`).join('、'));
}
report('左右平分', 90, balanceOffset(model, 90));
report('上下平分', 0, balanceOffset(model, 0));
t = performance.now();
const hu = findHuLine(model);
console.log(`胡煥庸線搜尋 ${(performance.now() - t).toFixed(0)} ms, score ${hu.score.toFixed(3)}`);
report('台灣胡煥庸線', hu.theta, hu.offset);
