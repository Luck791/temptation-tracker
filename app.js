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
    const tile = createTile(item.emoji, item.name,
      item.inverse ? `目标 ≤${item.baseline}${item.unit}` : `基线 ${item.baseline}${item.unit}`);
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

// ============= 一念之间（离散诱惑）=============
async function onDiscreteTempClick(item) {
  let subitem = null;
  if (item.subItems && item.subItems.length) {
    subitem = await pickSubItem(item);
    if (!subitem) return;
  }
  const result = await openDiscreteTempModal({
    title: subitem ? `${item.name} - ${subitem.name}` : item.name,
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
      hideConfirm: true,
      onCancel: () => { hideModal(); resolve(null); },
    });
    document.querySelectorAll('#subPick .choice').forEach(c => {
      c.onclick = () => {
        const sub = item.subItems.find(s => s.id === c.dataset.id);
        hideModal();
        resolve(sub);
      };
    });
  });
}

function openDiscreteTempModal({ title }) {
  return new Promise(resolve => {
    const html = `
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
      </div>`;
    showModal({
      title, bodyHTML: html,
      onConfirm: () => {
        const desire = parseInt(document.getElementById('desireSlider').value);
        const sel = document.querySelector('#resultPick .choice.active');
        if (!sel) { showToast('请选择结果'); return; }
        hideModal();
        resolve({ desire, resisted: sel.dataset.value === 'resist' });
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
      };
    });
  });
}

// ============= 适可而止（连续诱惑）=============
async function onContinuousTempClick(item) {
  const result = await openContinuousTempModal({
    title: item.name,
    threshold: item.threshold,
    unit: item.unit,
    min: item.min,
    max: item.max,
    step: item.step,
  });
  if (!result) return;
  const score = computeContinuousTempScore(result.desire, result.amount, item.threshold);
  await logEvent({
    category: 'continuous_temp',
    item: item.id,
    desire: result.desire,
    resisted: '',
    amount: result.amount,
    score: round1(score),
    note: `${result.amount}${item.unit}`,
  });
}

function computeContinuousTempScore(desire, amount, threshold) {
  let factor = 1 - amount / threshold;
  if (factor < 0) factor *= CONFIG.scoring.continuousPenaltyMultiplier;
  return desire * factor;
}

function openContinuousTempModal({ title, threshold, unit, min, max, step }) {
  return new Promise(resolve => {
    const html = `
      <div class="field">
        <label>欲望强度</label>
        <div class="slider-row">
          <input type="range" min="1" max="10" step="1" value="5" id="desireSlider">
          <div class="slider-val" id="desireVal">5</div>
        </div>
      </div>
      <div class="field">
        <label>实际${unit}（阈值 ${threshold}${unit}）</label>
        <div class="slider-row">
          <input type="range" min="${min}" max="${max}" step="${step}" value="0" id="amountSlider">
          <div class="slider-val" id="amountVal">0</div>
        </div>
      </div>`;
    showModal({
      title, bodyHTML: html,
      onConfirm: () => {
        const desire = parseInt(document.getElementById('desireSlider').value);
        const amount = parseFloat(document.getElementById('amountSlider').value);
        hideModal();
        resolve({ desire, amount });
      },
      onCancel: () => { hideModal(); resolve(null); },
    });
    const ds = document.getElementById('desireSlider');
    const dv = document.getElementById('desireVal');
    ds.oninput = () => { dv.textContent = ds.value; };
    const as = document.getElementById('amountSlider');
    const av = document.getElementById('amountVal');
    as.oninput = () => { av.textContent = as.value; };
  });
}

// ============= 身心强大（连续奖励，今日累计模型）=============
async function onContinuousRewardClick(item) {
  let prev;
  try {
    prev = await callBackend('getRewardTotal', { item: item.id });
  } catch (e) { showToast('查询失败：' + e.message); return; }
  const prevTotal = Number(prev.totalAmount) || 0;
  const prevScore = Number(prev.totalScore) || 0;

  const initial = Math.min(Math.max(prevTotal, item.min), item.max);

  const newTotal = await openSingleSliderModal({
    title: `记录${item.name}`,
    label: `今日累计${item.unit}（之前 ${prevTotal}${item.unit}）`,
    min: item.min, max: item.max, step: item.step, initial,
  });
  if (newTotal === null) return;

  const delta = newTotal - prevTotal;
  if (!item.inverse && delta < 0) { showToast('累计值不能减少'); return; }

  const newScore = computeRewardScore(newTotal, item);
  const incrementScore = newScore - prevScore;

  await logEvent({
    category: 'continuous_reward',
    item: item.id,
    amount: round1(delta),
    score: round1(incrementScore),
    note: `累计 ${round1(newTotal)}${item.unit}`,
  });
}

function computeRewardScore(totalAmount, item) {
  if (item.inverse) {
    const diff = item.baseline - totalAmount;
    if (diff <= 0) return 0;
    return Math.min((diff / item.ratePer) * item.rate, item.cap);
  }
  if (totalAmount <= item.baseline) return 0;
  return Math.min(((totalAmount - item.baseline) / item.ratePer) * item.rate, item.cap);
}

function openSingleSliderModal({ title, label, min, max, step, initial }) {
  return new Promise(resolve => {
    const html = `
      <div class="field">
        <label>${label}</label>
        <div class="slider-row">
          <input type="range" min="${min}" max="${max}" step="${step}" value="${initial}" id="onlySlider">
          <div class="slider-val" id="onlyVal">${initial}</div>
        </div>
      </div>`;
    showModal({
      title, bodyHTML: html,
      onConfirm: () => {
        const v = parseFloat(document.getElementById('onlySlider').value);
        hideModal(); resolve(v);
      },
      onCancel: () => { hideModal(); resolve(null); },
    });
    const s = document.getElementById('onlySlider');
    const v = document.getElementById('onlyVal');
    s.oninput = () => { v.textContent = s.value; };
  });
}

// ============= 健康饮食（离散奖励）=============
async function onDiscreteRewardClick(item) {
  await logEvent({
    category: 'discrete_reward', item: item.id, score: item.score,
  });
}

// ============= 临时诱惑 =============
async function onExtraClick() {
  const name = await openTextModal('临时诱惑名称', '比如：吃炸鸡');
  if (!name) return;
  const result = await openDiscreteTempModal({ title: `临时：${name}` });
  if (!result) return;
  const score = result.resisted ? result.desire : -result.desire * CONFIG.scoring.discreteSurrenderMultiplier;
  await logEvent({
    category: 'extra_temp', item: name,
    desire: result.desire, resisted: result.resisted,
    score: round1(score), note: '临时',
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
function showModal({ title, bodyHTML, onConfirm, onCancel, hideConfirm }) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHTML;
  els.modal.hidden = false;
  els.modalConfirm.style.display = hideConfirm ? 'none' : '';
  els.modalConfirm.onclick = () => onConfirm && onConfirm();
  els.modalCancel.onclick = () => onCancel && onCancel();
}
function hideModal() {
  els.modal.hidden = true;
  els.modalBody.innerHTML = '';
  els.modalConfirm.style.display = '';
}

// ============= 提交 + 刷新 =============
async function logEvent(payload) {
  showToast('记录中…');
  try {
    await callBackend('log', { payload });
    const s = round1(payload.score);
    const sign = s > 0 ? '+' : '';
    showToast(`${sign}${s} 分`);
    await refreshToday();
  } catch (e) { showToast('失败：' + e.message); }
}

async function refreshToday() {
  els.todayMeta.textContent = '加载中…';
  try {
    const data = await callBackend('getToday');
    els.todayScore.textContent = round1(data.total).toString();
    els.todayMeta.textContent = `${data.events.length} 条战报`;
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
  } catch (e) { els.todayMeta.textContent = '加载失败：' + e.message; }
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

  let detail = '';
  if (ev.category === 'discrete_temp' || ev.category === 'extra_temp') {
    const isResist = ev.resisted === true || ev.resisted === 'TRUE' || ev.resisted === 'true';
    detail = isResist ? ' ✊战胜' : ' 😩屈服';
  } else if (ev.category === 'continuous_temp') {
    detail = ` D${ev.desire}/${ev.amount}h`;
  } else if (ev.category === 'continuous_reward' && ev.note) {
    detail = ` ${ev.note}`;
  }
  return `${name}${detail}`;
}

function round1(n) { return Math.round(Number(n) * 10) / 10; }

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, 1500);
}

init();
