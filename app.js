const state = { usage: '', budget: '', pain: new Set() };
const profileForm = document.querySelector('#profile-form');
const briefEmpty = document.querySelector('#brief-empty');
const briefContent = document.querySelector('#brief-content');
const briefTitle = document.querySelector('#brief-title');
const briefList = document.querySelector('#brief-list');
const ecosystem = document.querySelector('#ecosystem');
const chatLog = document.querySelector('#chat-log');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const modelAInput = document.querySelector('#model-a');
const modelBInput = document.querySelector('#model-b');
const compareButton = document.querySelector('#compare-button');
const report = document.querySelector('#report');

function addMessage(content, role = 'advisor') {
  const article = document.createElement('article'); article.className = `message ${role === 'user' ? 'user-message' : 'advisor-message'}`;
  const badge = document.createElement('span'); badge.textContent = role === 'user' ? '你' : 'DM';
  const paragraph = document.createElement('p'); paragraph.textContent = content;
  article.append(badge, paragraph); chatLog.append(article); chatLog.scrollTop = chatLog.scrollHeight;
}
function choose(button, group) {
  const value = button.dataset.value;
  if (group === 'pain') { state.pain.has(value) ? state.pain.delete(value) : state.pain.add(value); button.classList.toggle('active', state.pain.has(value)); return; }
  state[group] = value; button.closest('[data-choice]').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
}
document.querySelectorAll('[data-choice]').forEach((group) => group.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => choose(button, group.dataset.choice))));
function priorities() {
  const result = [];
  if (state.usage === '游戏与性能') result.push('散热与持续性能', '触控与屏幕体验', '续航和充电节奏');
  else if (state.usage === '拍照与创作') result.push('算法风格与成片稳定性', '长焦和人像能力', '握持与出片效率');
  else if (state.usage === '商务与办公') result.push('系统稳定性与信号', '轻薄手感', '护眼屏与续航');
  else result.push('系统顺滑和续航', '手感与重量', '主摄成片稳定性');
  if (state.pain.size) result.push(`优先排除：${[...state.pain].join('、')}`);
  return result;
}
function profile() { return { usage: state.usage, budget: state.budget, pain: [...state.pain], ecosystem: ecosystem.value }; }
function buildBrief() {
  const items = priorities(); briefEmpty.hidden = true; briefContent.hidden = false;
  briefTitle.textContent = `你需要的是一台偏「${state.usage}」的设备。`; briefList.replaceChildren();
  items.forEach((item) => { const li = document.createElement('li'); li.textContent = item; briefList.append(li); });
}
profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.usage || !state.budget) { addMessage('先补充主要用途和预算。参数会说话，但这两项才决定什么适合你。'); return; }
  buildBrief();
  addMessage(`档案已建立：${state.usage}，预算 ${state.budget}，${ecosystem.value}。不需要先填型号，我直接给你选购建议。`);
  consult('我还没有候选产品。请根据我的需求直接推荐最适合购买的产品方向，给出明确选择、加钱方案和避坑点，并提供购买搜索关键词。', true);
});
function showReport(answer, links, modelA, modelB) {
  const hasModels = Boolean(modelA || modelB);
  report.hidden = false; document.querySelector('#report-a').textContent = modelA || '推荐方案'; document.querySelector('#report-b').textContent = modelB || '购买入口';
  document.querySelector('#report-summary').textContent = '以下建议由 DigiMind 基于你的需求生成；价格和商家信息请以购物平台实时页面为准。';
  document.querySelector('#sharp-take').textContent = answer;
  const table = document.querySelector('#report-table'); table.replaceChildren();
  const row = document.createElement('tr'); row.innerHTML = `<td>${hasModels ? '多平台购买入口' : '按需求直达搜索'}</td><td colspan="3"><div id="shopping-links" class="shopping-links"></div></td>`; table.append(row);
  const container = row.querySelector('#shopping-links');
  if (!links.length) container.textContent = '请填入候选型号后生成平台入口。';
  links.forEach((platform) => { const group = document.createElement('div'); group.className = 'shopping-platform'; const title = document.createElement('strong'); title.textContent = platform.name; group.append(title); platform.items.forEach((item) => { const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `搜索 ${item.label}`; group.append(link); }); container.append(group); });
  document.querySelector('#avoid-copy').textContent = '平台价格、补贴、库存、店铺资质和售后政策变化很快。建议优先选择官方旗舰店或平台自营，付款前核对型号、版本、保修和退换条件。';
}
async function consult(message, showResult = false) {
  const modelA = modelAInput.value.trim(); const modelB = modelBInput.value.trim();
  try {
    compareButton.disabled = true; compareButton.textContent = 'DigiMind 正在分析…';
    const response = await fetch('/api/advice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, profile: profile(), modelA, modelB }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败');
    addMessage(data.answer);
    if (showResult) { showReport(data.answer, data.links || [], modelA, modelB); report.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  } catch (error) { addMessage(error.message || 'DigiMind 暂时不可用，请稍后再试。'); }
  finally { compareButton.disabled = false; compareButton.textContent = '直接推荐 / 比较并购买'; }
}
function ask(question) { const text = question.trim(); if (!text) return; addMessage(text, 'user'); consult(text); }
chatForm.addEventListener('submit', (event) => { event.preventDefault(); ask(chatInput.value); chatInput.value = ''; });
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => ask(button.dataset.prompt || '')));
compareButton.addEventListener('click', () => {
  const modelA = modelAInput.value.trim(); const modelB = modelBInput.value.trim();
  if (modelA && modelB) { consult(`请比较 ${modelA} 与 ${modelB}，给我明确的购买建议和避坑点。`, true); return; }
  if (modelA || modelB) { consult(`我暂时只看 ${modelA || modelB}。请判断它是否适合我的需求，并给一个更值得比较的替代方向。`, true); return; }
  consult('我没有候选产品。请根据我的需求，直接给出明确的购买建议、加钱方案、降级方案和避坑点。', true);
});
document.querySelector('#reset-profile').addEventListener('click', () => { state.usage = ''; state.budget = ''; state.pain.clear(); ecosystem.value = '无强绑定'; document.querySelectorAll('[data-choice] button').forEach((button) => button.classList.remove('active')); briefContent.hidden = true; briefEmpty.hidden = false; });
