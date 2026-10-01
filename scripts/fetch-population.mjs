// 從內政部戶政司開放資料 API (ODRP014：村里戶數、單一年齡人口) 抓取最新月份的村里人口
// 用法：node scripts/fetch-population.mjs [民國年月，例如 11508]
import { writeFile, mkdir } from 'node:fs/promises';

const API = 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014';

async function fetchPage(yyymm, page) {
  const res = await fetch(`${API}/${yyymm}?page=${page}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${yyymm} page ${page}`);
  return res.json();
}

// 從本月往回找，直到找到有資料的月份
function candidateMonths(count = 8) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear() - 1911;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    out.push(`${y}${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

async function main() {
  const months = process.argv[2] ? [process.argv[2]] : candidateMonths();
  let yyymm, first;
  for (const m of months) {
    const data = await fetchPage(m, 1);
    if (data.responseCode === 'OD-0101-S') { yyymm = m; first = data; break; }
    console.log(`${m}: ${data.responseMessage}`);
  }
  if (!yyymm) throw new Error('找不到可用的月份資料');

  const totalPage = Number(first.totalPage);
  const rows = [...first.responseData];
  for (let p = 2; p <= totalPage; p++) {
    const data = await fetchPage(yyymm, p);
    rows.push(...data.responseData);
  }

  const csv = ['code,site,village,households,population'];
  for (const r of rows) {
    csv.push([r.district_code, r.site_id, r.village, r.household_no, r.people_total].join(','));
  }
  await mkdir('data-raw', { recursive: true });
  await writeFile(`data-raw/population-${yyymm}.csv`, csv.join('\n') + '\n');
  await writeFile('data-raw/latest.txt', yyymm + '\n');

  const total = rows.reduce((s, r) => s + Number(r.people_total), 0);
  console.log(`${yyymm}: ${rows.length} 村里，總人口 ${total.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
