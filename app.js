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
  inventory = []; lastResults = [];
  $('searchCard').classList.add('hidden'); $('resultsSection').classList.add('hidden');
  if (typeof invalidateBatch === 'function') invalidateBatch();
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
  inventory = []; lastResults = [];
  $('resultsSection').classList.add('hidden');
  if (typeof invalidateBatch === 'function') invalidateBatch();
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
  if (typeof invalidateBatch === 'function') invalidateBatch();
  $('target').focus();
}

function isExcludedName(name) {
  const normalized = String(name).normalize('NFKC').toUpperCase();
  return normalized.includes('なにかのPSA10'.toUpperCase()) || normalized.includes('BOX');
}

let extraSearchLimited = false;

function selectedCounts() {
  return [1, 2, ...($('includeThree').checked ? [3] : []), ...($('includeFour').checked ? [4] : [])];
}

function findExtraCombinations(target, limit, percent, count, randomize) {
  const candidates = inventory.filter(item => item.value * 100 < target * (percent + 1))
    .slice().sort((a, b) => a.value - b.value);
  const best = [], chosen = [], used = new Map();
  let steps = 0;
  const compare = (a, b) => a.balanceGap - b.balanceGap
    || (randomize ? a.tie - b.tie : b.sum - a.sum);
  function visit(start, remaining, sum) {
    if (++steps > 200000) { extraSearchLimited = true; return; }
    if (!remaining) {
      if (sum * 100 < target * percent || sum * 100 >= target * (percent + 1)) return;
      const items = [...used].map(([index, qty]) => ({...candidates[index], qty}));
      const result = {items, sum, count,
        balanceGap: (candidates[chosen[count - 1]].value - candidates[chosen[0]].value) / sum,
        tie: randomize ? Math.random() : 0};
      best.push(result); best.sort(compare);
      if (best.length > limit) best.pop();
      return;
    }
    if (start >= candidates.length || (sum + candidates[candidates.length - 1].value * remaining) * 100 < target * percent) return;
    for (let i = start; i < candidates.length; i++) {
      if (++steps > 200000) { extraSearchLimited = true; return; }
      const item = candidates[i], qty = used.get(i) || 0;
      if ((sum + item.value * remaining) * 100 >= target * (percent + 1)) break;
      if (qty || chosen.some(index => candidates[index].name.normalize('NFKC').trim() === item.name.normalize('NFKC').trim())) continue;
      chosen.push(i); used.set(i, qty + 1);
      visit(i + 1, remaining - 1, sum + item.value);
      chosen.pop();
      if (qty) used.set(i, qty); else used.delete(i);
      if (steps > 200000) return;
    }
  }
  visit(0, count, 0);
  return best;
}

function findCombinations(target, limit, percent = 83, counts = [1, 2]) {
  extraSearchLimited = false;
  const found = [];
  // 選択した%台のみ。下限は含め、次の%台は含めない。
  const inRange = sum => sum * 100 >= target * percent && sum * 100 < target * (percent + 1);
  // まず1個で完結する候補。
  inventory.forEach(item => {
    if (inRange(item.value)) found.push({items:[{...item,qty:1}], sum:item.value, count:1});
  });
  // 次に2個の候補。同一商品は在庫が2個以上ある場合だけ使う。
  for (let i = 0; i < inventory.length; i++) {
    for (let j = i + 1; j < inventory.length; j++) {
      if (inventory[i].name.normalize('NFKC').trim() === inventory[j].name.normalize('NFKC').trim()) continue;
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
  const standard = found.sort((a,b) => a.count-b.count
    || (a.balanceGap ?? 0)-(b.balanceGap ?? 0)
    || (randomize ? 0 : b.sum-a.sum)).slice(0,limit);
  return [...standard, ...[3, 4].filter(count => counts.includes(count))
    .flatMap(count => findExtraCombinations(target, limit, percent, count, randomize))];
}

function selectedPercent() {
  const percent = Number($('percentBand').value);
  return [83, 84, 85].includes(percent) ? percent : 83;
}

function search() {
  const target = toNumber($('target').value);
  if (!(target > 0)) return alert('0より大きい数字を入力してください。');
  const percent = selectedPercent();
  const counts = selectedCounts();
  lastResults = findCombinations(target, +$('resultLimit').value, percent, counts);
  const wrap = $('results'); wrap.innerHTML = '';
  if (!lastResults.length) wrap.innerHTML = `<div class="empty">基準値の${percent}%台（${percent}%以上${percent + 1}%未満）に収まる、${counts.join("・")}枚の組み合わせが見つかりませんでした。<br>数字や在庫データを確認してください。</div>`;
  const hasExtras = counts.length > 2;
  if (hasExtras) {
    const notice = document.createElement('p');
    notice.className = 'hint';
    notice.textContent = '通常（1〜2枚）と、選択した追加枚数ごとに最大' + $('resultLimit').value + '件を表示します。';
    if (extraSearchLimited) notice.textContent += ' 追加候補の探索上限に達したため、探索済みの範囲から表示しています。';
    wrap.appendChild(notice);
    for (const count of counts.filter(n => n >= 3)) {
      if (!lastResults.some(result => result.count === count)) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = count + '枚の候補は' + (extraSearchLimited ? '探索済みの範囲では' : '') + '見つかりませんでした。';
        wrap.appendChild(empty);
      }
    }
  }
  let previousGroup = '';
  lastResults.forEach((result, i) => {
    const group = result.count <= 2 ? '通常（1〜2枚）' : result.count + '枚の組み合わせ';
    if (hasExtras && group !== previousGroup) {
      const heading = document.createElement('h3');
      heading.textContent = group;
      wrap.appendChild(heading);
      previousGroup = group;
    }
    const combo = result.items, count = result.count, ratio = result.sum / target * 100;
    const div = document.createElement('div'); div.className = 'result-card';
    div.innerHTML = `<div class="result-number">${i+1}</div><div class="result-items">${combo.map(x=>`<div class="result-item"><div class="product-details">${escapeHTML(x.name)} × ${x.qty}<span class="stock-badge">現在庫 ${x.stock}</span><br><small class="hint">${itemMarketText(x)}</small></div></div>`).join('')}</div><div class="result-meta">相場合計 ${marketTotalText(result)}<br>${(Math.floor(ratio * 10) / 10).toFixed(1)}%・${count}枚</div>`;
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

['includeThree', 'includeFour'].forEach(id => $(id).addEventListener('change', () => {
  lastResults = [];
  $('results').innerHTML = '';
  $('resultsSection').classList.add('hidden');
}));

/* BUNDLED BATCH FEATURES */
/* Shared by the browser worker and local verification. No stock is mutated. */
(function (scope) {
  function allocateBatch(products, people, percent, maxSteps = 100000) {
    if (![83, 84, 85].includes(percent)) throw new Error('割合を確認してください。');
    if (products.some(p => !Number.isFinite(p.value) || p.value <= 0 || !Number.isSafeInteger(p.stock) || p.stock < 0)) throw new Error('在庫データが不正です。');
    if (people.some(p => !Number.isSafeInteger(p.target) || p.target <= 0)) throw new Error('基準coinは正の整数にしてください。');
    const candidates = people.map(person => {
      const found = [], valid = sum => sum * 100 >= person.target * percent && sum * 100 < person.target * (percent + 1);
      for (let i = 0; i < products.length; i++) {
        if (!products[i].stock) continue;
        if (valid(products[i].value)) found.push({ ids: [i], sum: products[i].value, gap: 0 });
        for (let j = i + 1; j < products.length; j++) {
          if (!products[j].stock || products[i].name.normalize('NFKC').trim() === products[j].name.normalize('NFKC').trim()) continue;
          const sum = products[i].value + products[j].value;
          if (valid(sum)) found.push({ ids: [i, j], sum, gap: Math.abs(products[i].value - products[j].value) / sum });
        }
      }
      return found.sort((a, b) => a.ids.length - b.ids.length || a.gap - b.gap || b.sum - a.sum);
    });
    const remaining = products.map(p => p.stock), current = Array(people.length).fill(null);
    let best = current.slice(), bestCount = 0, steps = 0, limited = false;
    const eligible = people.map((_, i) => i).filter(i => candidates[i].length);
    function visit(todo, count) {
      if (count > bestCount) { bestCount = count; best = current.slice(); }
      if (bestCount === eligible.length || count + todo.length <= bestCount) return;
      if (++steps > maxSteps) { limited = true; return; }
      let index, options;
      for (const i of todo) {
        const available = candidates[i].filter(c => c.ids.every(id => remaining[id] > 0));
        if (!options || available.length < options.length) { index = i; options = available; }
      }
      const next = todo.filter(i => i !== index);
      for (const combo of options) {
        combo.ids.forEach(id => remaining[id]--); current[index] = combo;
        visit(next, count + 1);
        combo.ids.forEach(id => remaining[id]++); current[index] = null;
        if (bestCount === eligible.length || limited) return;
      }
      visit(next, count);
    }
    visit(eligible, 0);
    const used = products.map(() => 0);
    best.forEach(combo => combo?.ids.forEach(id => used[id]++));
    if (used.some((n, i) => n > products[i].stock)) throw new Error('在庫検証に失敗しました。');
    return { percent, people: people.map((person, i) => {
      const options = candidates[i].slice(0, 20);
      // Keep the jointly feasible recommendation available even if it ranked below 20.
      if (best[i] && !options.includes(best[i])) options[options.length - 1] = best[i];
      return { ...person, combo: best[i], candidates: options, choice: best[i] ? options.indexOf(best[i]) : options.length ? 0 : -1, confirmed: false, reason: best[i] ? '' : !candidates[i].length ? '相場範囲内の1〜2枚の候補なし' : limited ? '探索上限までに割当できず' : '全員で在庫を共有すると割当できず' };
    }), products: products.map((p, i) => ({ ...p, used: used[i], remaining: p.stock - used[i] })), assigned: bestCount, limited, steps };
  }
  function confirmedState(result, excludeIndex = -1) {
    const used = result.products.map(() => 0), selected = [];
    result.people.forEach((person, i) => {
      if (!person.confirmed || i === excludeIndex) return;
      const combo = person.candidates[person.choice];
      if (!combo || new Set(combo.ids).size !== combo.ids.length) throw new Error('選択した候補を確認してください。');
      const names = combo.ids.map(id => result.products[id]?.name.normalize('NFKC').trim());
      if (names.includes(undefined) || new Set(names).size !== names.length) throw new Error('同じ商品は1人につき1枚までです。');
      const sum = combo.ids.reduce((total, id) => total + result.products[id].value, 0);
      if (sum !== combo.sum || sum * 100 < person.target * result.percent || sum * 100 >= person.target * (result.percent + 1)) throw new Error('選択した候補の相場範囲を確認してください。');
      combo.ids.forEach(id => used[id]++); selected.push({ ...person, combo });
    });
    if (used.some((n, i) => n > result.products[i].stock)) throw new Error('確定した組み合わせが残在庫を超えています。');
    return { selected, products: result.products.map((p, i) => ({ ...p, used: used[i], remaining: p.stock - used[i] })) };
  }
  function canSelectCandidate(result, personIndex, choice) {
    const combo = result.people[personIndex]?.candidates[choice];
    if (!combo) return false;
    const state = confirmedState(result, personIndex);
    return combo.ids.every(id => state.products[id]?.remaining > 0);
  }
  scope.allocateBatch = allocateBatch;
  scope.confirmedState = confirmedState;
  scope.canSelectCandidate = canSelectCandidate;
  if (typeof module !== 'undefined') module.exports = { allocateBatch, confirmedState, canSelectCandidate };
})(globalThis);

let peopleRows = [], batchResult = null, batchWorker = null, batchWorkerURL = null;
function stopBatchWorker() {
  batchWorker?.terminate(); batchWorker = null;
  if (batchWorkerURL) URL.revokeObjectURL(batchWorkerURL);
  batchWorkerURL = null;
}
function invalidateBatch() {
  stopBatchWorker(); batchResult = null;
  $('batchResultsSection').classList.add('hidden');
  $('downloadAllocations').disabled = true; $('downloadStock').disabled = true;
  $('allocateButton').disabled = !inventory.length || !peopleRows.length;
  const percent = selectedPercent();
  $('batchRules').textContent = `相場合計は${percent}%以上${percent + 1}%未満。1〜2枚で割り当てます。`;
  $('batchStatus').textContent = inventory.length && peopleRows.length ? 'CSVを確認して、全員分の組み合わせを作ってください。' : '在庫CSVと名前・基準coinのCSVを読み込んでください。';
}
async function readPeopleFile(file) {
  if (!file) return;
  let text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
  if (text.includes('\uFFFD')) text = new TextDecoder('shift-jis').decode(await file.arrayBuffer());
  setPeopleRows(parseCSV(text), file.name);
}
function setPeopleRows(data, filename) {
  peopleRows = []; invalidateBatch();
  if (data.length < 2) throw new Error('名前・基準coinのCSVにデータ行がありません。');
  peopleRows = data;
  const headers = data[0].map(v => v.trim());
  setOptions($('personNameColumn'), headers, guess(headers, ['名前', '氏名', 'name'], 0));
  setOptions($('personTargetColumn'), headers, guess(headers, ['coin', 'コイン', '基準', '相場', '商品名', '金額'], 1));
  $('peopleMapping').classList.remove('hidden');
  $('peopleStatus').textContent = `${filename}（${data.length - 1}名）を読み込みました`;
  invalidateBatch();
}
function parsePeople() {
  const ni = +$('personNameColumn').value, ti = +$('personTargetColumn').value;
  if (ni === ti) throw new Error('名前と基準coinは別の列を選んでください。');
  return peopleRows.slice(1).map((row, i) => {
    const name = (row[ni] || '').trim(), original = (row[ti] || '').trim();
    const match = original.match(/([\d,，]+)\s*coin/i);
    const target = match ? toNumber(match[1]) : /^[\d,，\s]+$/.test(original) ? toNumber(original) : NaN;
    if (!name || !Number.isSafeInteger(target) || target <= 0) throw new Error(`${i + 2}行目の名前・基準coinを確認してください。`);
    return { name, target, original };
  });
}
function runBatch() {
  try {
    const people = parsePeople();
    if (!inventory.length) throw new Error('在庫CSVを読み込んでください。');
    invalidateBatch();
    $('allocateButton').disabled = true;
    $('batchStatus').textContent = `${people.length}名分の組み合わせを探索しています…`;
    const workerSource = `self.onmessage=({data})=>{try{self.postMessage({result:(${allocateBatch.toString()})(data.products,data.people,data.percent)})}catch(error){self.postMessage({error:error.message})}};`;
    batchWorkerURL = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    batchWorker = new Worker(batchWorkerURL);
    batchWorker.onmessage = ({ data }) => {
      stopBatchWorker(); $('allocateButton').disabled = false;
      if (data.error) { $('batchStatus').textContent = data.error; return; }
      batchResult = data.result;
      $('batchStatus').textContent = '候補を作成しました。各人のドロップダウンで選び、チェックで確定してください。' + (batchResult.limited ? ' おすすめの割り当て探索は上限に達したため、全員分の同時割当は未確認です。' : '');
      renderBatch(); $('batchResultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    batchWorker.onerror = () => { stopBatchWorker(); $('allocateButton').disabled = false; $('batchStatus').textContent = '探索を開始できませんでした。ページを再読み込みしてください。'; };
    batchWorker.postMessage({ products: inventory, people, percent: selectedPercent() });
  } catch (error) { stopBatchWorker(); $('allocateButton').disabled = !inventory.length || !peopleRows.length; $('batchStatus').textContent = error.message; }
}
function renderBatch() {
  if (!batchResult) return;
  const r = batchResult, state = confirmedState(r), used = state.products.reduce((sum, p) => sum + p.used, 0);
  $('batchSummary').textContent = `${r.people.length}名 ／ 候補あり ${r.people.filter(p => p.candidates.length).length}名 ／ 確定 ${state.selected.length}名 ／ 未確定 ${r.people.length - state.selected.length}名 ／ 使用 ${used}枚 ／ 相場 ${r.percent}%台`;
  $('downloadAllocations').disabled = !state.selected.length; $('downloadStock').disabled = !state.selected.length;
  $('batchResults').replaceChildren();
  const filter = $('personFilter').value.trim();
  r.people.forEach((person, personIndex) => {
    if (filter && !person.name.includes(filter)) return;
    const card = document.createElement('article'); card.className = 'allocation-card';
    if (person.confirmed) card.classList.add('confirmed');
    const heading = document.createElement('h3'); heading.textContent = person.name; card.appendChild(heading);
    const meta = document.createElement('p'); meta.className = 'hint';
    meta.textContent = `基準 ${person.target.toLocaleString('ja-JP')}coin ／ 相場範囲 ${Math.ceil(person.target * r.percent / 100).toLocaleString('ja-JP')}円以上 ${Math.ceil(person.target * (r.percent + 1) / 100).toLocaleString('ja-JP')}円未満`;
    card.appendChild(meta);
    const combo = person.candidates[person.choice];
    if (combo) {
      const controls = document.createElement('div'); controls.className = 'candidate-controls';
      const label = document.createElement('p'); label.className = 'candidate-label'; label.textContent = `組み合わせ候補（${person.candidates.length}件）`;
      controls.appendChild(label);
      const dropdown = document.createElement('details'); dropdown.className = 'image-candidate-dropdown';
      const summary = document.createElement('summary'); summary.id = `candidate-${personIndex}`;
      const summaryImages = document.createElement('span'); summaryImages.className = 'candidate-thumbnails';
      combo.ids.forEach(id => {
        const p = r.products[id];
        if (!p.imageUrl) return;
        const image = document.createElement('img'); image.className = 'candidate-thumbnail'; image.src = p.imageUrl; image.alt = p.name; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove()); summaryImages.appendChild(image);
      });
      summary.appendChild(summaryImages);
      const summaryText = document.createElement('span'); summaryText.className = 'candidate-summary-text';
      summaryText.textContent = `候補${person.choice + 1}：${combo.ids.map(id => r.products[id].name).join(' ＋ ')} ／ ${combo.sum.toLocaleString('ja-JP')}円`;
      summary.appendChild(summaryText); dropdown.appendChild(summary);
      const options = document.createElement('div'); options.className = 'image-candidate-options';
      person.candidates.forEach((candidate, choice) => {
        const available = canSelectCandidate(r, personIndex, choice);
        const recommended = person.combo && candidate.ids.join(',') === person.combo.ids.join(',');
        const option = document.createElement('div'); option.className = 'image-candidate-option';
        if (choice === person.choice) option.classList.add('selected');
        if (!available) option.classList.add('unavailable');
        const pickLabel = document.createElement('label'); pickLabel.className = 'candidate-pick';
        const radio = document.createElement('input'); radio.type = 'radio'; radio.name = `person-candidate-${personIndex}`; radio.id = `candidate-option-${personIndex}-${choice}`; radio.value = String(choice); radio.checked = choice === person.choice; radio.disabled = !available;
        radio.addEventListener('change', () => { if (radio.checked) updateSelection(personIndex, choice, person.confirmed, summary.id); });
        const title = document.createElement('span'); title.textContent = `候補${choice + 1}${recommended ? '・おすすめ' : ''} ／ ${candidate.sum.toLocaleString('ja-JP')}円 ／ ${(candidate.sum / person.target * 100).toFixed(2)}% ／ ${candidate.ids.length}枚`;
        pickLabel.append(radio, title); option.appendChild(pickLabel);
        candidate.ids.forEach(id => {
          const p = r.products[id], row = document.createElement('div'); row.className = 'result-item candidate-product';
          const image = createProductImage(p); if (image) row.appendChild(image);
          const text = document.createElement('div'); text.className = 'product-details'; text.textContent = p.name;
          const value = document.createElement('p'); value.className = 'hint'; value.textContent = `相場単価 ${p.value.toLocaleString('ja-JP')}円`;
          text.appendChild(value); row.appendChild(text); option.appendChild(row);
        });
        if (!available) { const reason = document.createElement('p'); reason.className = 'hint'; reason.textContent = '確定済みの他の人と在庫が競合しているため選択できません。'; option.appendChild(reason); }
        options.appendChild(option);
      });
      dropdown.appendChild(options); controls.appendChild(dropdown);
      const checkLabel = document.createElement('label'); checkLabel.className = 'confirm-choice';
      const check = document.createElement('input'); check.type = 'checkbox'; check.id = `confirm-${personIndex}`; check.checked = person.confirmed;
      check.disabled = !person.confirmed && !canSelectCandidate(r, personIndex, person.choice);
      check.addEventListener('change', () => updateSelection(personIndex, person.choice, check.checked, check.id));
      checkLabel.append(check, document.createTextNode('この組み合わせで確定')); controls.appendChild(checkLabel); card.appendChild(controls);
      const status = document.createElement('p'); status.className = 'selection-status'; status.textContent = person.confirmed ? '確定済み・CSV出力対象' : check.disabled ? 'この候補は在庫不足です。他の候補を選ぶか、他の人の確定を外してください。' : '未確定・チェックするとCSV出力対象になります。'; card.appendChild(status);
      combo.ids.forEach(id => {
        const p = r.products[id], row = document.createElement('div'); row.className = 'result-item';
        const image = createProductImage(p); if (image) row.appendChild(image);
        const detail = document.createElement('div'); detail.className = 'product-details';
        detail.textContent = `${p.name} × 1`; const value = document.createElement('p'); value.className = 'hint'; value.textContent = `相場単価 ${p.value.toLocaleString('ja-JP')}円`; detail.appendChild(value); row.appendChild(detail); card.appendChild(row);
      });
      const total = document.createElement('p'); total.className = 'allocation-total'; total.textContent = `相場合計 ${combo.sum.toLocaleString('ja-JP')}円 ／ ${(combo.sum / person.target * 100).toFixed(2)}% ／ ${combo.ids.length}枚`; card.appendChild(total);
    } else { card.classList.add('unassigned'); const reason = document.createElement('p'); reason.textContent = `未割当：${person.reason}`; card.appendChild(reason); }
    $('batchResults').appendChild(card);
  });
  $('batchStock').replaceChildren();
  state.products.forEach(p => {
    const row = document.createElement('tr');
    [p.name, p.value.toLocaleString('ja-JP') + '円', p.stock, p.used, p.remaining].forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); });
    $('batchStock').appendChild(row);
  });
  $('batchResultsSection').classList.remove('hidden');
}
function updateSelection(personIndex, choice, confirmed, focusId) {
  const person = batchResult.people[personIndex], previous = { choice: person.choice, confirmed: person.confirmed };
  try {
    if (!canSelectCandidate(batchResult, personIndex, choice)) throw new Error('他の人の確定分と在庫が競合しています。別の候補を選んでください。');
    person.choice = choice; person.confirmed = confirmed; confirmedState(batchResult);
    $('batchStatus').textContent = `${person.name}さんの組み合わせを${confirmed ? '確定' : '未確定に変更'}しました。`;
  } catch (error) { Object.assign(person, previous); $('batchStatus').textContent = error.message; }
  renderBatch(); $(focusId)?.focus();
}
function saveBatchCSV(filename, rows) {
  const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('downloadAllocations').addEventListener('click', () => {
  if (!batchResult) return;
  let state;
  try { state = confirmedState(batchResult); } catch (error) { $('batchStatus').textContent = error.message; return; }
  if (!state.selected.length) return;
  saveBatchCSV('確定した組み合わせ.csv', [['名前', '元の引換券', '基準coin', '商品1', '商品1相場', '商品2', '商品2相場', '相場合計', '割合_%', '枚数', '結果'], ...state.selected.map(p => {
    const a = p.combo && batchResult.products[p.combo.ids[0]], b = p.combo && batchResult.products[p.combo.ids[1]];
    return [p.name, p.original, p.target, a?.name, a?.value, b?.name, b?.value, p.combo.sum, (p.combo.sum / p.target * 100).toFixed(4), p.combo.ids.length, '確定済み'];
  })]);
});
$('downloadStock').addEventListener('click', () => {
  if (!batchResult) return;
  try {
    const state = confirmedState(batchResult);
    if (state.selected.length) saveBatchCSV('確定分の使用数と残在庫.csv', [['商品名', '相場単価', '読込在庫', '使用数', '残在庫'], ...state.products.map(p => [p.name, p.value, p.stock, p.used, p.remaining])]);
  } catch (error) { $('batchStatus').textContent = error.message; }
});
$('peopleFile').addEventListener('change', e => readPeopleFile(e.target.files[0]).catch(error => { $('batchStatus').textContent = error.message; }));
$('allocateButton').addEventListener('click', runBatch);
$('personFilter').addEventListener('input', renderBatch);
['personNameColumn', 'personTargetColumn', 'percentBand'].forEach(id => $(id).addEventListener('change', invalidateBatch));
if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('local-example')) {
  $('localExample').classList.remove('hidden');
  $('localExample').addEventListener('click', async () => {
    try {
      const responses = await Promise.all([fetch('/local-data/inventory'), fetch('/local-data/people')]);
      if (responses.some(r => !r.ok)) throw new Error('今回のCSVを読み込めませんでした。CSV選択から読み込んでください。');
      const [stockText, peopleText] = await Promise.all(responses.map(r => r.text()));
      await loadFile(new File([stockText], 'zaiko-20261008.csv')); applyMapping();
      setPeopleRows(parseCSV(peopleText), '今回の名前・基準coin.csv'); runBatch();
    } catch (error) { $('batchStatus').textContent = error.message; }
  });
}
