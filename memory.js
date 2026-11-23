// Friday's long-term memory. Uses Supabase (free, survives Render redeploys) when
// SUPABASE_URL + SUPABASE_SERVICE_KEY are set; otherwise falls back to RAM + memory/*.json.
// Tables: see supabase/friday-memory.sql. No npm packages.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const STOP = new Set('a an the and or but i me my you your is are was were be to of in on at for with it this that what how do does did can will just so up im its about from have has had not no yes ok okay hey friday pookie please'.split(' '));
const words = (t) => String(t || '').toLowerCase().match(/[a-z0-9ऀ-࿿]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) || [];

export function createMemory({ root }) {
  const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = process.env.SUPABASE_SERVICE_KEY || '';
  const enabled = Boolean(URL_ && KEY);

  async function db(path, { method = 'GET', body, prefer } = {}) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (!KEY.startsWith('sb_')) headers.Authorization = `Bearer ${KEY}`; // old JWT-style keys
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (r.status === 409) return { conflict: true };
    if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  }

  // ---- local fallback (laptop without Supabase keys) ----
  const ram = { messages: new Map(), summaries: new Map(), seen: new Set(), kv: new Map() };
  const FACTS_FILE = join(root, 'memory', 'facts.json');
  const RULES_FILE = join(root, 'memory', 'rules.json');
  const readJ = async (f) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return []; } };
  const writeJ = async (f, v) => { await mkdir(dirname(f), { recursive: true }); await writeFile(f, JSON.stringify(v, null, 2)); };

  async function listFacts(kind = 'fact') {
    if (enabled) return db(`friday_facts?kind=eq.${kind}&select=id,fact,created_at&order=id.asc&limit=500`);
    const rows = await readJ(kind === 'rule' ? RULES_FILE : FACTS_FILE);
    return rows.map((r, i) => ({ id: i, fact: r.fact || r.rule, created_at: r.saved }));
  }

  // Returns true when it was new.
  async function addFact(fact, kind = 'fact') {
    fact = String(fact).trim().slice(0, 300);
    if (!fact) return false;
    if (enabled) { const r = await db('friday_facts', { method: 'POST', body: { fact, kind } }); return !r.conflict; }
    const f = kind === 'rule' ? RULES_FILE : FACTS_FILE;
    const rows = await readJ(f);
    if (rows.some((r) => (r.fact || r.rule || '').toLowerCase() === fact.toLowerCase())) return false;
    rows.push(kind === 'rule' ? { rule: fact, saved: new Date().toISOString().slice(0, 10) } : { fact, saved: new Date().toISOString().slice(0, 10) });
    await writeJ(f, rows.slice(-200));
    return true;
  }

  // "forget my gym timing" -> deletes the facts/rules that best match those words. Returns what was removed.
  async function forget(query) {
    const q = words(query);
    if (!q.length) return [];
    const all = [...(await listFacts('fact')).map((r) => ({ ...r, kind: 'fact' })), ...(await listFacts('rule')).map((r) => ({ ...r, kind: 'rule' }))];
    const scored = all.map((r) => { const w = new Set(words(r.fact)); return { r, s: q.filter((x) => w.has(x)).length / q.length }; });
    const best = Math.max(0, ...scored.map((x) => x.s));
    if (best < 0.5) return [];
    const gone = scored.filter((x) => x.s === best).map((x) => x.r);
    if (enabled) {
      const ids = gone.map((r) => r.id).join(',');
      await db(`friday_facts?id=in.(${ids})`, { method: 'DELETE' });
    } else {
      for (const kind of ['fact', 'rule']) {
        const f = kind === 'rule' ? RULES_FILE : FACTS_FILE;
        const drop = new Set(gone.filter((r) => r.kind === kind).map((r) => r.fact.toLowerCase()));
        if (drop.size) await writeJ(f, (await readJ(f)).filter((r) => !drop.has((r.fact || r.rule || '').toLowerCase())));
      }
    }
    return gone.map((r) => r.fact);
  }

  // The few facts that share words with what she is talking about now (not all of them every turn).
  async function relevantFacts(text, n = 6) {
    const q = new Set(words(text));
    if (!q.size) return [];
    return (await listFacts('fact'))
      .map((r) => ({ fact: r.fact, s: words(r.fact).filter((w) => q.has(w)).length }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.fact);
  }

  async function addMessage(channel, role, content) {
    content = String(content || '').slice(0, 4000);
    if (!content) return;
    if (enabled) return db('friday_messages', { method: 'POST', body: { channel, role, content } });
    const list = ram.messages.get(channel) || [];
    list.push({ role, content, summarized: false });
    ram.messages.set(channel, list.slice(-200));
  }

  async function recentMessages(channel, n = 8) {
    if (enabled) {
      const rows = await db(`friday_messages?channel=eq.${encodeURIComponent(channel)}&select=role,content&order=id.desc&limit=${n}`);
      return rows.reverse();
    }
    return (ram.messages.get(channel) || []).slice(-n).map(({ role, content }) => ({ role, content }));
  }

  async function getSummary(channel) {
    if (enabled) return (await db(`friday_summaries?channel=eq.${encodeURIComponent(channel)}&select=summary`))[0]?.summary || '';
    return ram.summaries.get(channel) || '';
  }

  // Folds older turns into one short running summary so the bot keeps the gist without replaying them.
  // summarize(oldSummary, turns) -> new summary text. Runs after the reply, never blocks it.
  async function maybeSummarize(channel, summarize, { keep = 8, every = 20 } = {}) {
    let pending;
    if (enabled) pending = await db(`friday_messages?channel=eq.${encodeURIComponent(channel)}&summarized=eq.false&select=id,role,content&order=id.asc&limit=200`);
    else pending = (ram.messages.get(channel) || []).filter((m) => !m.summarized);
    if (pending.length < every + keep) return;
    const fold = pending.slice(0, pending.length - keep);
    const next = String(await summarize(await getSummary(channel), fold) || '').trim();
    if (!next) return;
    if (enabled) {
      await db('friday_summaries', { method: 'POST', body: { channel, summary: next, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
      await db(`friday_messages?id=in.(${fold.map((m) => m.id).join(',')})`, { method: 'PATCH', body: { summarized: true } });
    } else {
      ram.summaries.set(channel, next);
      for (const m of fold) m.summarized = true;
    }
  }

  // True the first time an id is seen (WhatsApp can redeliver a message, also after a restart).
  async function firstSeen(id) {
    if (!id) return true;
    if (enabled) {
      try { const r = await db('friday_seen', { method: 'POST', body: { id } }); return !r.conflict; }
      catch { return !ram.seen.has(id) && ram.seen.add(id); }
    }
    if (ram.seen.has(id)) return false;
    ram.seen.add(id);
    if (ram.seen.size > 500) ram.seen.delete(ram.seen.values().next().value);
    return true;
  }

  async function kvGet(key, fallback) {
    if (enabled) { const r = await db(`friday_kv?key=eq.${encodeURIComponent(key)}&select=value`); return r[0] ? r[0].value : fallback; }
    return ram.kv.has(key) ? ram.kv.get(key) : fallback;
  }

  async function kvSet(key, value) {
    if (enabled) return db('friday_kv', { method: 'POST', body: { key, value, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
    ram.kv.set(key, value);
  }

  return { enabled, listFacts, addFact, forget, relevantFacts, addMessage, recentMessages, getSummary, maybeSummarize, firstSeen, kvGet, kvSet };
}
