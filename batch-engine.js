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
