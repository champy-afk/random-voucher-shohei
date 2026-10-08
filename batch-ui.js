let peopleRows = [], batchResult = null, batchWorker = null;
function invalidateBatch() {
  batchWorker?.terminate(); batchWorker = null; batchResult = null;
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
    batchWorker = new Worker('batch-worker.js');
    batchWorker.onmessage = ({ data }) => {
      batchWorker?.terminate(); batchWorker = null; $('allocateButton').disabled = false;
      if (data.error) { $('batchStatus').textContent = data.error; return; }
      batchResult = data.result;
      $('batchStatus').textContent = '候補を作成しました。各人のドロップダウンで選び、チェックで確定してください。' + (batchResult.limited ? ' おすすめの割り当て探索は上限に達したため、全員分の同時割当は未確認です。' : '');
      renderBatch(); $('batchResultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    batchWorker.onerror = () => { batchWorker?.terminate(); batchWorker = null; $('allocateButton').disabled = false; $('batchStatus').textContent = '探索を開始できませんでした。ローカルサーバーで開いてください。'; };
    batchWorker.postMessage({ products: inventory, people, percent: selectedPercent() });
  } catch (error) { $('batchStatus').textContent = error.message; }
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
