// openclaw-bridge.js — OpenAI-compatible shim that wraps Friday's /api/chat
// OpenClaw thinks this is a normal LLM provider; it calls Friday's brain instead.
// Run: node openclaw-bridge.js (starts on PORT_BRIDGE, default 4322)
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.PORT_BRIDGE || 4322);
const FRIDAY_URL = `http://localhost:${process.env.PORT || 4321}`;
const FRIDAY_PASSCODE = process.env.FRIDAY_PASSCODE || '';
// Key OpenClaw sends in Authorization: Bearer <key>
const BRIDGE_KEY = process.env.OPENCLAW_API_KEY || '';

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(json);
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' }); return res.end(); }

  // Health / model list — OpenClaw probes these.
  if (req.method === 'GET' && req.url === '/v1/models') {
    return send(res, 200, { object: 'list', data: [{ id: 'friday', object: 'model', owned_by: 'friday' }] });
  }

  if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
    return send(res, 404, { error: 'not found' });
  }

  // Check bridge key.
  if (BRIDGE_KEY) {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (auth !== BRIDGE_KEY) return send(res, 401, { error: 'unauthorized' });
  }

  let raw = '';
  for await (const chunk of req) { raw += chunk; }
  const body = JSON.parse(raw || '{}');
  const messages = (body.messages || []).filter((m) => m.role !== 'system');

  // Forward to Friday.
  const headers = { 'Content-Type': 'application/json' };
  if (FRIDAY_PASSCODE) headers['x-friday-passcode'] = FRIDAY_PASSCODE;
  const r = await fetch(`${FRIDAY_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) {
    const err = await r.text();
    return send(res, 502, { error: `Friday returned ${r.status}: ${err}` });
  }
  const { reply, model } = await r.json();
  send(res, 200, {
    id: 'friday-' + Date.now(),
    object: 'chat.completion',
    model: model || 'friday',
    choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Friday bridge on http://localhost:${PORT}`));
