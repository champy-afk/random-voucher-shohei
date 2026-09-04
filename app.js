const $ = (id) => document.getElementById(id);
let rows = [], inventory = [], lastResults = [], excludedCount = 0;

function parseCSV(text) {
  const out = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); if (row.some(v => v.trim() !== '')) out.push(row); row = []; cell = '';
    } else cell += c;
  }
  row.push(cell); if (row.some(v => v.trim() !== '')) out.push(row);
  return out;
}

function guess(headers, words, fallback = 0) {
  const index = headers.findIndex(h => words.some(w => h.toLowerCase().includes(w)));
  return index >= 0 ? index : Math.min(fallback, headers.length - 1);
}

function setOptions(select, headers, chosen, allowOne = false) {
  select.innerHTML = '';
  if (allowOne) select.add(new Option('各商品を1個として扱う', '-1'));
  headers.forEach((h, i) => select.add(new Option(h || `列${i + 1}`, i)));
  select.value = String(chosen);
}

async function loadFile(file) {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.includes('\uFFFD')) try { text = new TextDecoder('shift-jis').decode(buffer); } catch (_) {}
  rows = parseCSV(text);
  if (rows.length < 2) return alert('データ行のあるCSVを選択してください。');
  const h = rows[0].map(v => v.trim());
  setOptions($('nameColumn'), h, guess(h, ['商品名','品名','名称','name','アイテム'], 0));
  const snkrdunkColumn = h.findIndex(header => header.trim() === '現在相場（スニダン直近取引）');
  const valueGuess = snkrdunkColumn >= 0
    ? snkrdunkColumn
    : guess(h, ['スニダン直近取引','直近取引','現在相場','相場','数字','金額','価格','ポイント','value','単価'], 9);
  setOptions($('valueColumn'), h, valueGuess);
  const stockGuess = guess(h, ['保管場所別在庫','在庫数','在庫','数量','stock','個数'], 6);
  setOptions($('stockColumn'), h, stockGuess, true);
  $('fileStatus').textContent = `${file.name}（${rows.length - 1}件）を読み込みました`;
  $('mappingCard').classList.remove('hidden');
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[,，￥¥円\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function toStock(value) {
  const source = String(value ?? '').trim();
  if (!source) return 0;
  // 「fred:84」「東京:3 / 大阪:2」など、保管場所ごとの数量を合算する。
  const locationCounts = [...source.matchAll(/(?:^|[\s,，/／;；|｜])[^\d:,，/／;；|｜]*[:：]\s*(-?[\d,]+)/g)];
  if (locationCounts.length) return locationCounts.reduce((sum, match) => sum + Math.max(0, toNumber(match[1]) || 0), 0);
  const plain = toNumber(source);
  return Number.isFinite(plain) ? Math.max(0, Math.floor(plain)) : 0;
}

function applyMapping() {
  const ni = +$('nameColumn').value, vi = +$('valueColumn').value, si = +$('stockColumn').value;
  const mapped = rows.slice(1).map((r, i) => ({
    name: (r[ni] || `商品${i + 1}`).trim(), value: toNumber(r[vi]), stock: si < 0 ? 1 : toStock(r[si])
  })).filter(x => x.name && Number.isFinite(x.value) && x.value > 0 && Number.isFinite(x.stock) && x.stock > 0);
  inventory = mapped.filter(x => !isExcludedName(x.name));
  excludedCount = mapped.length - inventory.length;
  if (!inventory.length) return alert('有効な在庫を読み込めませんでした。列の選択とデータを確認してください。');
  $('inventorySummary').textContent = `${inventory.length}種類・合計${inventory.reduce((s,x)=>s+x.stock,0)}個の在庫を使用します（名称条件で${excludedCount}種類を除外）。`;
  $('searchCard').classList.remove('hidden');
  $('target').focus();
}

function isExcludedName(name) {
  const normalized = String(name).normalize('NFKC').toUpperCase();
  return normalized.includes('なにかのPSA10'.toUpperCase()) || normalized.includes('BOX');
}

function findCombinations(target, limit) {
  const min = target * .8, max = target * .83, found = [];
  const inRange = sum => sum >= min - 1e-9 && sum <= max + 1e-9;
  // まず1個で完結する候補。
  inventory.forEach(item => {
    if (inRange(item.value)) found.push({items:[{...item,qty:1}], sum:item.value, count:1});
  });
  // 次に2個の候補。同一商品は在庫が2個以上ある場合だけ使う。
  for (let i = 0; i < inventory.length; i++) {
    for (let j = i; j < inventory.length; j++) {
      if (i === j && inventory[i].stock < 2) continue;
      const sum = inventory[i].value + inventory[j].value;
      if (!inRange(sum)) continue;
      const items = i === j
        ? [{...inventory[i],qty:2}]
        : [{...inventory[i],qty:1},{...inventory[j],qty:1}];
      found.push({items,sum,count:2});
    }
  }
  if ($('randomize').checked) {
    const singles = found.filter(x=>x.count===1).sort(()=>Math.random()-.5);
    const pairs = found.filter(x=>x.count===2).sort(()=>Math.random()-.5);
    return [...singles,...pairs].slice(0,limit);
  }
  return found.sort((a,b) => a.count-b.count || b.sum-a.sum).slice(0,limit);
}

function search() {
  const target = toNumber($('target').value);
  if (!(target > 0)) return alert('0より大きい数字を入力してください。');
  lastResults = findCombinations(target, +$('resultLimit').value);
  const wrap = $('results'); wrap.innerHTML = '';
  if (!lastResults.length) wrap.innerHTML = '<div class="empty">基準値の80%〜83%に収まる、1〜2個の組み合わせが見つかりませんでした。<br>数字や在庫データを確認してください。</div>';
  lastResults.forEach((result, i) => {
    const combo = result.items, count = result.count, ratio = result.sum / target * 100;
    const div = document.createElement('div'); div.className = 'result-card';
    div.innerHTML = `<div class="result-number">${i+1}</div><div class="result-items">${combo.map(x=>`${escapeHTML(x.name)} × ${x.qty}<span class="stock-badge">現在庫 ${x.stock}</span>`).join('<br>')}</div><div class="result-meta">相場合計 ${result.sum.toLocaleString()}<br>${ratio.toFixed(1)}%・${count}個</div>`;
    wrap.appendChild(div);
  });
  $('resultsSection').classList.remove('hidden');
  $('resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
}

function escapeHTML(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function resultsText(){const target=toNumber($('target').value);return lastResults.map((r,i)=>`候補${i+1}: ${r.items.map(x=>`${x.name} × ${x.qty}［現在庫 ${x.stock}］`).join('、')}（相場合計 ${r.sum} / 基準の${(r.sum/target*100).toFixed(1)}%）`).join('\n')}
async function copyAll(){if(!lastResults.length)return;await navigator.clipboard.writeText(resultsText());$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),1500)}

$('csvFile').addEventListener('change', e => loadFile(e.target.files[0]));
const drop=$('dropZone'); ['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
$('applyMapping').addEventListener('click',applyMapping);
$('findButton').addEventListener('click',search);
$('target').addEventListener('input', e => {
  const digits = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  e.target.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
});
$('target').addEventListener('keydown',e=>{if(e.key==='Enter')search()});
$('copyAll').addEventListener('click',copyAll);
