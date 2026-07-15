const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadLocalEnv();

const port = Number.parseInt(process.env.PORT || '8091', 10);
const rootDir = __dirname;
const apiKey = process.env.DEEPSEEK_API_KEY || '';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const apiBase = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const requests = new Map();

const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let content = ''; let bytes = 0;
    request.on('data', (chunk) => { bytes += chunk.length; if (bytes > 16_000) { const error = new Error('too large'); error.status = 413; reject(error); request.resume(); return; } content += chunk; });
    request.on('end', () => { try { resolve(JSON.parse(content || '{}')); } catch { const error = new Error('invalid json'); error.status = 400; reject(error); } });
    request.on('error', reject);
  });
}
function allow(request) {
  const now = Date.now(); const key = request.socket.remoteAddress || 'local';
  const valid = (requests.get(key) || []).filter((time) => now - time < 60_000);
  if (valid.length >= 10) return false;
  valid.push(now); requests.set(key, valid); return true;
}
function clean(value, max = 240) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function recommendationQuery(profile) {
  const usage = clean(profile?.usage, 60);
  const budget = clean(profile?.budget, 60);
  const category = usage.includes('游戏') ? '游戏手机' : usage.includes('拍照') ? '拍照手机' : usage.includes('商务') ? '商务手机' : '手机';
  return [category, budget].filter(Boolean).join(' ');
}
function shoppingLinks(modelA, modelB, profile) {
  const models = [modelA, modelB].filter(Boolean);
  const queries = models.length ? models : [recommendationQuery(profile)];
  const platforms = [
    { name: '京东', make: (query) => `https://search.jd.com/Search?keyword=${encodeURIComponent(query)}` },
    { name: '淘宝', make: (query) => `https://s.taobao.com/search?q=${encodeURIComponent(query)}` },
    { name: '拼多多', make: (query) => `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(query)}` },
    { name: '品牌官网', make: (query) => `https://www.bing.com/search?q=${encodeURIComponent(`${query} 官网`)}` },
  ];
  return platforms.map((platform) => ({ name: platform.name, items: queries.map((item) => ({ label: item, url: platform.make(item) })) }));
}
function buildPrompt(payload) {
  const profile = payload.profile || {};
  const modelA = clean(payload.modelA, 80); const modelB = clean(payload.modelB, 80);
  const question = clean(payload.message, 400);
  return {
    system: [
      '你是 DigiMind，一位资深、客观、说话直接但贴心的数码产品比较顾问。',
      '先重视使用需求和实际体验，少报纸面参数。回答时重点考虑手感、发热、系统稳定性、续航焦虑和生态适配。',
      '禁止使用“智商税”羞辱用户；不要虚构实时价格、库存、促销、评测分数或型号规格。遇到需实时核实的信息，明确提示用户去平台链接确认。',
      '如果用户未给明确用途、预算、痛点或生态，请先提出最多三条“灵魂三问”。但只要用途和预算已提供，即使没有候选型号，也必须直接给出选购建议，不能要求用户先输入产品。',
      '没有候选型号时，先给适合的产品类型和 2–3 个可在主流正规渠道搜索的具体机型方向；若无法确认具体型号是否仍在售或其规格，明确提示用户点购买入口核对。不要虚构价格。',
      '无论是否已有型号，使用严格格式输出：\n【一句话锐评】\n【核心差异】列 3–4 条真正影响体验的差异或选购标准\n【避坑指南】\n【终局建议】给明确选择，并说明何时加钱或降级。',
      '价格只可写“参考当前电商大促均价，价格波动快”，不得编造具体金额。字数控制在 450 个汉字以内。',
    ].join(''),
    user: [
      `用户问题：${question || '请根据我的需求开始选购。'}`,
      `候选产品 A：${modelA || '未提供'}；候选产品 B：${modelB || '未提供'}。`,
      `主要用途：${clean(profile.usage, 60) || '未提供'}；预算：${clean(profile.budget, 60) || '未提供'}；痛点：${Array.isArray(profile.pain) ? profile.pain.map((item) => clean(item, 30)).filter(Boolean).join('、') || '未提供' : '未提供'}；生态倾向：${clean(profile.ecosystem, 60) || '无强绑定'}。`,
    ].join('\n'),
  };
}
async function consult(payload) {
  const prompt = buildPrompt(payload);
  if (!apiKey) return { answer: 'DigiMind 的智能问答尚未配置。请在本机 .env 填入 DeepSeek API Key 后重启服务；在此之前，你仍可使用下方多平台搜索入口核对产品与价格。', source: 'local' };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
      body: JSON.stringify({ model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], thinking: { type: 'disabled' }, temperature: 0.2, max_tokens: 720, stream: false }),
    });
    if (!response.ok) throw new Error(`provider status ${response.status}`);
    const data = await response.json(); const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('empty provider response');
    return { answer, source: 'deepseek' };
  } finally { clearTimeout(timer); }
}
function serveFile(urlPath, response) {
  const filename = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(rootDir, filename);
  if (!file.startsWith(`${rootDir}${path.sep}`) && file !== path.join(rootDir, 'index.html')) return send(response, 403, { error: 'Forbidden' });
  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) return send(response, 404, { error: 'Not found' });
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(response);
  });
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { status: 'ok', advisor: apiKey ? 'configured' : 'local-only' });
  if (request.method === 'POST' && url.pathname === '/api/advice') {
    if (!allow(request)) return send(response, 429, { error: '提问过于频繁，请稍后再试。' });
    try {
      const payload = await readBody(request);
      const result = await consult(payload);
      return send(response, 200, { ...result, links: shoppingLinks(clean(payload.modelA, 80), clean(payload.modelB, 80), payload.profile || {}) });
    } catch (error) {
      console.warn(`[digimind] advice unavailable: ${error.name}: ${error.message}`);
      return send(response, 200, { answer: '智能顾问暂时无法响应。请稍后再试，并先通过下方平台入口核实价格、商家和售后。', source: 'fallback', links: [] });
    }
  }
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed' });
  serveFile(url.pathname, response);
});
server.listen(port, '0.0.0.0', () => console.log(`DigiMind is running at http://localhost:${port}`));
