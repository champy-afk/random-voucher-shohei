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
  // 保管場所が fred の数量だけを使用し、他の場所や数字だけの値は無視する。
  const fredCounts = [...source.matchAll(/(?:^|[\s,，/／;；|｜])fred\s*[:：]\s*(\d{1,3}(?:,\d{3})+|\d+)(?=$|[\s,，/／;；|｜])/g)];
  return fredCounts.reduce((sum, match) => sum + toNumber(match[1]), 0);
}

function imageUrlFromCell(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function createProductImage(item) {
  if (!item.imageUrl) return null;
  const image = document.createElement('img');
  image.className = 'product-image';
  image.alt = item.name;
  image.width = 56;
  image.height = 72;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'product-image-button';
  button.setAttribute('aria-label', item.name + 'の画像を拡大');
  button.title = 'クリック・タップで拡大';
  button.addEventListener('click', () => openProductImage(item));
  image.addEventListener('error', () => button.remove(), {once: true});
  image.src = item.imageUrl;
  button.appendChild(image);
  return button;
}

function openProductImage(item) {
  const url = imageUrlFromCell(item.imageUrl);
  if (!url) return;
  const dialog = $('imageDialog');
  $('imageDialogTitle').textContent = item.name;
  const image = document.createElement('img');
  image.className = 'image-preview';
  image.alt = item.name;
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  const status = document.createElement('p');
  status.className = 'hint';
  status.setAttribute('role', 'status');
  status.textContent = '画像を読み込み中…';
  image.addEventListener('load', () => status.remove(), {once: true});
  image.addEventListener('error', () => {
    image.remove();
    status.textContent = '画像を読み込めませんでした。閉じてもう一度お試しください。';
  }, {once: true});
  $('imageDialogBody').replaceChildren(status, image);
  image.src = url;
  if (!dialog.open) dialog.showModal();
  document.documentElement.classList.add('image-dialog-open');
}

function applyMapping() {
  const ni = +$('nameColumn').value, vi = +$('valueColumn').value, si = +$('stockColumn').value;
  const mapped = rows.slice(1).map((r, i) => ({
    name: (r[ni] || `商品${i + 1}`).trim(), value: toNumber(r[vi]), stock: si < 0 ? 1 : toStock(r[si]),
    imageUrl: imageUrlFromCell(r[13])
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

function findCombinations(target, limit, percent = 83) {
  const found = [];
  // 選択した%台のみ。下限は含め、次の%台は含めない。
  const inRange = sum => sum * 100 >= target * percent && sum * 100 < target * (percent + 1);
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
      const balanceGap = Math.abs(inventory[i].value - inventory[j].value) / sum;
      found.push({items,sum,count:2,balanceGap});
    }
  }
  const randomize = $('randomize').checked;
  if (randomize) {
    for (let i = found.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [found[i], found[j]] = [found[j], found[i]];
    }
  }
  // 1個の候補を優先し、2個の候補は金額比率が5:5に近い順に並べる。
  // ランダム設定は優先度が同じ候補同士にだけ適用する。
  return found.sort((a,b) => a.count-b.count
    || (a.balanceGap ?? 0)-(b.balanceGap ?? 0)
    || (randomize ? 0 : b.sum-a.sum)).slice(0,limit);
}

function selectedPercent() {
  const percent = Number($('percentBand').value);
  return [83, 84, 85].includes(percent) ? percent : 83;
}

function search() {
  const target = toNumber($('target').value);
  if (!(target > 0)) return alert('0より大きい数字を入力してください。');
  const percent = selectedPercent();
  lastResults = findCombinations(target, +$('resultLimit').value, percent);
  const wrap = $('results'); wrap.innerHTML = '';
  if (!lastResults.length) wrap.innerHTML = `<div class="empty">基準値の${percent}%台（${percent}%以上${percent + 1}%未満）に収まる、1〜2個の組み合わせが見つかりませんでした。<br>数字や在庫データを確認してください。</div>`;
  lastResults.forEach((result, i) => {
    const combo = result.items, count = result.count, ratio = result.sum / target * 100;
    const div = document.createElement('div'); div.className = 'result-card';
    div.innerHTML = `<div class="result-number">${i+1}</div><div class="result-items">${combo.map(x=>`<div class="result-item"><div class="product-details">${escapeHTML(x.name)} × ${x.qty}<span class="stock-badge">現在庫 ${x.stock}</span><br><small class="hint">${itemMarketText(x)}</small></div></div>`).join('')}</div><div class="result-meta">相場合計 ${marketTotalText(result)}<br>${(Math.floor(ratio * 10) / 10).toFixed(1)}%・${count}個</div>`;
    div.querySelectorAll('.result-item').forEach((row, index) => {
      const image = createProductImage(combo[index]);
      if (image) row.prepend(image);
    });
    wrap.appendChild(div);
  });
  $('resultsSection').classList.remove('hidden');
  $('resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
}

function itemMarketText(item) {
  const unit = item.value.toLocaleString('ja-JP') + '円';
  return item.qty === 1 ? '相場単価 ' + unit
    : '相場単価 ' + unit + ' × ' + item.qty + '個 ＝ 小計 ' + (item.value * item.qty).toLocaleString('ja-JP') + '円';
}

function marketTotalText(result) {
  const total = result.sum.toLocaleString('ja-JP') + '円';
  return result.items.length > 1
    ? result.items.map(item => (item.value * item.qty).toLocaleString('ja-JP') + '円').join(' ＋ ') + ' ＝ ' + total
    : total;
}

function escapeHTML(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function resultsText(){const target=toNumber($('target').value);return lastResults.map((r,i)=>`候補${i+1}: ${r.items.map(x=>`${x.name} × ${x.qty}［${itemMarketText(x)}／現在庫 ${x.stock}］`).join('、')}（相場合計 ${marketTotalText(r)} / 基準の${(Math.floor(r.sum/target*1000)/10).toFixed(1)}%）`).join('\n')}
async function copyAll(){if(!lastResults.length)return;await navigator.clipboard.writeText(resultsText());$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),1500)}

$('csvFile').addEventListener('change', e => loadFile(e.target.files[0]));
const drop=$('dropZone'); ['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
$('applyMapping').addEventListener('click',applyMapping);
$('findButton').addEventListener('click',search);
$('percentBand').addEventListener('change', () => {
  $('findButton').textContent = selectedPercent() + '%台の組み合わせを探す';
  lastResults = [];
  $('results').innerHTML = '';
  $('resultsSection').classList.add('hidden');
});
$('target').addEventListener('input', e => {
  const digits = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  e.target.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
});
$('target').addEventListener('keydown',e=>{if(e.key==='Enter')search()});
$('copyAll').addEventListener('click',copyAll);

$('imageDialogClose').addEventListener('click', () => $('imageDialog').close());
$('imageDialog').addEventListener('click', event => {
  if (event.target === $('imageDialog')) $('imageDialog').close();
});
$('imageDialog').addEventListener('close', () => {
  $('imageDialogBody').replaceChildren();
  document.documentElement.classList.remove('image-dialog-open');
});
