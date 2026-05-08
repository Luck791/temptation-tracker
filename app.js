let CONFIG = null;

const els = {
  todayScore: document.getElementById('todayScore'),
  todayMeta: document.getElementById('todayMeta'),
  discreteTempGrid: document.getElementById('discreteTempGrid'),
  continuousTempGrid: document.getElementById('continuousTempGrid'),
  continuousRewardGrid: document.getElementById('continuousRewardGrid'),
  discreteRewardGrid: document.getElementById('discreteRewardGrid'),
  extraBtn: document.getElementById('extraBtn'),
  todayLog: document.getElementById('todayLog'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalCancel: document.getElementById('modalCancel'),
  modalConfirm: document.getElementById('modalConfirm'),
  toast: document.getElementById('toast'),
};

// ============= 启动 =============
async function init() {
  hideModal();
  try {
    const res = await fetch('config.json?_=' + Date.now());
    CONFIG = await res.json();
  } catch (e) {
    els.todayMeta.textContent = '配置加载失败：' + e.message;
    return;
  }
  renderTiles();
  await refreshToday();
}

// ============= 后端通信 =============
async function callBackend(action, body = {}) {
  const payload = { secret: CONFIG.secret, action, ...body };
  const res = await fetch(CONFIG.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'unknown error');
  return data;
}

// ============= 渲染瓦片 =============
function renderTiles() {
  els.discreteTempGrid.innerHTML = '';
  CONFIG.discreteTemptations.forEach(item => {
    const tile = createTile(item.emoji, item.name);
    tile.onclick = () => onDiscreteTempClick(item);
    els.discreteTempGrid.appendChild(tile);
  });

  els.continuousTempGrid.innerHTML = '';
  CONFIG.continuousTemptations.forEach(item => {
    const tile = createTile(item.emoji, item.name, `阈值 ${item.threshold}${item.unit}`);
    tile.onclick = () => onContinuousTempClick(item);
    els.continuousTempGrid.appendChild(tile);
  });

  els.continuousRewardGrid.innerHTML = '';
  CONFIG.continuousRewards.forEach(item => {
    const tile = createTile(item.emoji, item.name, `基线 ${item.baseline}${item.unit}`);
    tile.onclick = () => onContinuousRewardClick(item);
    els.continuousRewardGrid.appendChild(tile);
  });

  els.discreteRewardGrid.innerHTML = '';
  CONFIG.discreteRewards.forEach(item => {
    const tile = createTile(item.emoji, item.name, `+${item.score}/次`);
    tile.onclick = () => onDiscreteRewardClick(item);
    els.discreteRewardGrid.appendChild(tile);
  });

  els.extraBtn.onclick = onExtraClick;
}

function createTile(emoji, name, sub = '') {
  const div = document.createElement('div');
  div.className = 'tile';
  div.innerHTML = `<div class="tile-emoji">${emoji}</div><div class="tile-name">${name}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}`;
  return div;
}

// ============= 离散诱惑 =============
async function onDiscreteTempClick(item) {
  let subitem = null;
  if (item.subItems && item.subItems.length) {
    subitem = await pickSubItem(item);
    if (!subitem) return;
  }
  const result = await openTemptationModal({
    title: subitem ? `${item.name} - ${subitem.name}` : item.name,
    needAmount: false,
  });
  if (!result) return;

  const score = result.resisted
    ? result.desire
    : -result.desire * CONFIG.scoring.discreteSurrenderMultiplier;

  await logEvent({
    category: 'discrete_temp',
    item: item.id,
    subitem: subitem ? subitem.id : '',
    desire: result.desire,
    resisted: result.resisted,
    score: round1(score),
  });
}

function pickSubItem(item) {
  return new Promise(resolve => {
    const html = `<div class="choice-row" id="subPick">${
      item.subItems.map(s => `<div class="choice" data-id="${s.id}">${s.name}</div>`).join('')
    }</div>`;
    showModal({
      title: `选择${item.name}种类`,
      bodyHTML: html,
      onConfirm: () => {
        const sel = document.querySelector('#subPick .choice.active');
        if (!sel) { showToast('请选择一项'); return; }
        const sub = item.subItems.find(s => s.id === sel.dataset.id);
        hideModal();
        resolve(sub);
      },
      onCancel: () => { hideModal(); resolve(null); },
    });
    document.querySelectorAll('#subPick .choice').forEach(c => {
      c.onclick = () => {
        document.querySelectorAll('#subPick .choice').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
      };
    });
  });
}

// ============= 连续诱惑 =============
async function onContinuousTempClick(item) {
  const result = await openTemptationModal({
    title: item.name,
    needAmount: true,
    amountUnit: item.unit,
    amountStep: item.step,
    threshold: item.threshold,
  });
  if (!result) return;

  let score;
  if (result.resisted) {
    score = result.desire;
  } else {
    const overage = Math.max(0, result.amount - item.threshold);
    score = (result.desire - overage) * CONFIG.scoring.continuousSurrenderMultiplier;
  }

  await logEvent({
    category: 'continuous_temp',
    item: item.id,
    desire: result.desire,
    resisted: result.resisted,
    amount: result.resisted ? '' : result.amount,
    score: round1(score),
  });
}

// ============= 连续奖励（增量计分）=============
async function onContinuousRewardClick(item) {
  const amount = await openAmountModal({
    title: `记录${item.name}`,
    label: `本次${item.name}（${item.unit}）`,
    step: item.step,
  });
  if (amount === null) return;

  let prev;
  try {
    prev = await callBackend('getRewardTotal', { item: item.id });
  } catch (e) {
    showToast('查询失败：' + e.message);
    return;
  }
  const oldAmount = prev.totalAmount || 0;
  const oldScore = prev.totalScore || 0;
  const newAmount = oldAmount + amount;
  const newScore = computeRewardScore(newAmount, item);
  const incrementScore = newScore - oldScore;

  await logEvent({
    category: 'continuous_reward',
    item: item.id,
    amount: amount,
    score: round1(incrementScore),
    note: `累积 ${round1(newAmount)}${item.unit}`,
  });
}

function computeRewardScore(totalAmount, item) {
  if (totalAmount <= item.baseline) return 0;
  const over = totalAmount - item.baseline;
  const raw = (over / item.ratePer) * item.rate;
  return Math.min(raw, item.cap);
}

// ============= 离散奖励 =============
async function onDiscreteRewardClick(item) {
  await logEvent({
    category: 'discrete_reward',
    item: item.id,
    score: item.score,
  });
}

// ============= 临时诱惑 =============
async function onExtraClick() {
  const name = await openTextModal('临时诱惑名称', '比如：吃炸鸡');
  if (!name) return;

  const result = await openTemptationModal({
    title: `临时：${name}`,
    needAmount: false,
  });
  if (!result) return;

  const score = result.resisted
    ? result.desire
    : -result.desire * CONFIG.scoring.discreteSurrenderMultiplier;

  await logEvent({
    category: 'extra_temp',
    item: name,
    desire: result.desire,
    resisted: result.resisted,
    score: round1(score),
    note: '临时',
  });
}

// ============= 通用模态：诱惑表单 =============
function openTemptationModal({ title, needAmount, amountUnit, amountStep, threshold }) {
  return new Promise(resolve => {
    let html = `
      <div class="field">
        <label>欲望强度</label>
        <div class="slider-row">
          <input type="range" min="1" max="10" step="1" value="5" id="desireSlider">
          <div class="slider-val" id="desireVal">5</div>
        </div>
      </div>
      <div class="field">
        <label>结果</label>
        <div class="choice-row" id="resultPick">
          <div class="choice" data-value="resist">✊ 战胜</div>
          <div class="choice" data-value="surrender">😩 屈服</div>
        </div>
      </div>
    `;
    if (needAmount) {
      html += `
        <div class="field" id="amountField" style="display:none">
          <label>实际${amountUnit}（阈值 ${threshold}${amountUnit}）</label>
          <input type="number" min="0" step="${amountStep}" id="amountInput" placeholder="${threshold}">
        </div>
      `;
    }
    showModal({
      title, bodyHTML: html,
      onConfirm: () => {
        const desire = parseInt(document.getElementById('desireSlider').value);
        const resultEl = document.querySelector('#resultPick .choice.active');
        if (!resultEl) { showToast('请选择结果'); return; }
        const resisted = resultEl.dataset.value === 'resist';
        let amount = 0;
        if (needAmount && !resisted) {
          const a = parseFloat(document.getElementById('amountInput').value);
          if (isNaN(a) || a < 0) { showToast(`请输入${amountUnit}数`); return; }
          amount = a;
        }
        hideModal();
        resolve({ desire, resisted, amount });
      },
      onCancel: () => { hideModal(); resolve(null); },
    });

    const slider = document.getElementById('desireSlider');
    const val = document.getElementById('desireVal');
    slider.oninput = () => { val.textContent = slider.value; };

    document.querySelectorAll('#resultPick .choice').forEach(c => {
      c.onclick = () => {
        document.querySelectorAll('#resultPick .choice').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        const af = document.getElementById('amountField');
        if (af) af.style.display = (needAmount && c.dataset.value === 'surrender') ? '' : 'none';
      };
    });
  });
}

function openAmountModal({ title, label, step }) {
  return new Promise(resolve => {
    const html = `<div class="field"><label>${label}</label><input type="number" min="0" step="${step}" id="onlyAmountInput"></div>`;
    showModal({
      title, bodyHTML: html,
      onConfirm: () => {
        const a = parseFloat(document.getElementById('onlyAmountInput').value);
        if (isNaN(a) || a <= 0) { showToast('请输入有效数量'); return; }
        hideModal(); resolve(a);
      },
      onCancel: () => { hideModal(); resolve(null); },
    });
    setTimeout(() => document.getElementById('onlyAmountInput').focus(), 100);
  });
}

function openTextModal(title, placeholder) {
  return new Promise(resolve => {
    const html = `<div class="field"><input type="text" id="textInput" placeholder="${placeholder}"></div>`;
    showModal({
      title, bodyHTML: html,
      onConfirm: () => {
        const v = document.getElementById('textInput').value.trim();
        if (!v) { showToast('请输入名称'); return; }
        hideModal(); resolve(v);
      },
      onCancel: () => { hideModal(); resolve(null); },
    });
    setTimeout(() => document.getElementById('textInput').focus(), 100);
  });
}

// ============= 模态控制 =============
function showModal({ title, bodyHTML, onConfirm, onCancel }) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHTML;
  els.modal.hidden = false;
  els.modalConfirm.onclick = () => onConfirm && onConfirm();
  els.modalCancel.onclick = () => onCancel && onCancel();
}

function hideModal() {
  els.modal.hidden = true;
  els.modalBody.innerHTML = '';
}

// ============= 提交记录 + 刷新 =============
async function logEvent(payload) {
  showToast('记录中…');
  try {
    await callBackend('log', { payload });
    const s = round1(payload.score);
    const sign = s > 0 ? '+' : '';
    showToast(`${sign}${s} 分`);
    await refreshToday();
  } catch (e) {
    showToast('失败：' + e.message);
  }
}

// ============= 刷新今日 =============
async function refreshToday() {
  els.todayMeta.textContent = '加载中…';
  try {
    const data = await callBackend('getToday');
    els.todayScore.textContent = round1(data.total).toString();
    els.todayMeta.textContent = `${data.events.length} 条记录`;

    if (!data.events.length) {
      els.todayLog.innerHTML = '<div class="muted">暂无记录</div>';
      return;
    }
    els.todayLog.innerHTML = data.events.map(e => {
      const time = (e.timestamp || '').split(' ')[1] || '';
      const itemLabel = formatItemLabel(e);
      const s = round1(Number(e.score) || 0);
      const cls = s > 0 ? 'pos' : s < 0 ? 'neg' : '';
      const sign = s > 0 ? '+' : '';
      return `<div class="log-item"><div><div>${itemLabel}</div><div class="t">${time}</div></div><div class="s ${cls}">${sign}${s}</div></div>`;
    }).join('');
  } catch (e) {
    els.todayMeta.textContent = '加载失败：' + e.message;
  }
}

function formatItemLabel(ev) {
  const idMap = {};
  CONFIG.discreteTemptations.forEach(i => {
    idMap[i.id] = i.name;
    if (i.subItems) i.subItems.forEach(s => idMap[`${i.id}:${s.id}`] = `${i.name}-${s.name}`);
  });
  CONFIG.continuousTemptations.forEach(i => idMap[i.id] = i.name);
  CONFIG.continuousRewards.forEach(i => idMap[i.id] = i.name);
  CONFIG.discreteRewards.forEach(i => idMap[i.id] = i.name);

  let name = ev.subitem
    ? (idMap[`${ev.item}:${ev.subitem}`] || `${ev.item}-${ev.subitem}`)
    : (idMap[ev.item] || ev.item);

  let result = '';
  if (['discrete_temp', 'continuous_temp', 'extra_temp'].includes(ev.category)) {
    const r = ev.resisted;
    const isResist = r === true || r === 'TRUE' || r === 'true';
    result = isResist ? ' ✊战胜' : ' 😩屈服';
  }
  let amt = '';
  if (ev.amount !== '' && ev.amount != null && ev.amount !== 0) amt = ` (${ev.amount})`;
  return `${name}${result}${amt}`;
}

function round1(n) { return Math.round(Number(n) * 10) / 10; }

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, 1500);
}

init();
