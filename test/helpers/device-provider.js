// Disposable HTTP endpoints for the pinned OMP's *built-in* Codex device flow.
// The extension reroutes auth requests locally and blocks all other external fetches.
const http = require('node:http');
const DEVICE_CODE = 'TEST-4242';
const ACCESS = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ email: 'device-test@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'device-test' } })).toString('base64url')}.test`;
async function deviceProvider() {
  const state = { approved: false, deny: false, calls: [], probes: [] };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const server = http.createServer((req, res) => {
    state.calls.push(req.url);
    req.resume();
    if (req.url === '/api/accounts/deviceauth/usercode') return json(res, state.deny ? 403 : 200, { device_auth_id: 'private-device-id', user_code: DEVICE_CODE, interval: 0 });
    if (req.url === '/api/accounts/deviceauth/token') return json(res, state.approved ? 200 : 403, { authorization_code: 'private-authorization-code', code_verifier: 'private-verifier' });
    if (req.url === '/oauth/token') return json(res, 200, { access_token: ACCESS, refresh_token: 'private-refresh-token', expires_in: 3600 });
    if (req.url === '/approve') { state.approved = true; return json(res, 200, { ok: true }); }
    if (req.url === '/v1/chat/completions') {
      state.probes.push(req.headers.authorization);
      if (req.headers.authorization !== `Bearer ${ACCESS}`) return json(res, 401, { error: { message: 'invalid test token' } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'device-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return res.end(chunk({ role: 'assistant', content: 'OK' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, state, base: `http://127.0.0.1:${server.address().port}` };
}
function deviceExtension(base) {
  return `export default function(pi) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin === 'https://auth.openai.com') return originalFetch('${base}' + url.pathname + url.search, init);
      if (url.origin === '${base}') return originalFetch(input, init);
      throw new Error('External fetch blocked in disposable device test: ' + url.origin);
    };
    pi.registerProvider('openai-codex', {
      baseUrl: '${base}/v1', api: 'openai-completions', authHeader: true,
      models: [{ id: 'device-test', name: 'Device test', reasoning: false, input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:8000,maxTokens:1000 }],
      oauth: { name: 'ChatGPT test', async login() { throw new Error('Unexpected browser login in device test'); }, getApiKey(credentials) { return credentials.access; } }
    });
  }`;
}
module.exports = { deviceProvider, deviceExtension, DEVICE_CODE, ACCESS };
