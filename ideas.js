// Daily "Claude ideas" digest: free public sources -> free Gemini picks the top 5 -> one WhatsApp block.
// Never calls a paid model. Sources only look back ~36 h, so repeats stay rare even when Render wipes the disk.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const UA = { 'User-Agent': 'friday-ideas/1.0 (personal digest)' };
const SEEN_FILE = (root) => join(root, 'memory', 'ideas-seen.json');
const LOOKBACK_H = 36;

// What the user cares about and what they already ruled out (keep in sync with Claude's memory).
const INTERESTS = `Things that make Claude / Claude Code better or cheaper for a non-technical beginner:
token/usage savers, free skills, plugins, mods, MCP servers, agent workflows, automation ideas,
and ideas for these projects: Zenith Club (pickleball wristband brand, India, website + Instagram),
Friday (personal WhatsApp/voice assistant), fleet dashcam business, internship email outreach, reels/animation.`;
const SKIP = `Skip: paid-only tools, anything "leaked"/pirated, cloning other people's apps or sites, bot-protection bypass,
macOS-only or US-only tools, heavy self-hosted apps, things that burn usage 24/7, generic motivation,
and these already-known items: claude-mem, Paperclip, OmniRoute, Headroom, Craft Anything, Replica, Atticus,
VoiceStudio, OpenJarvis, Understand Anything, agent-browser, n8n installs, Free Claude Code, caveman, ruflo.`;

async function get(url, ms = 15000, headers = UA) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function fromHN() {
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_H * 3600;
  const out = [];
  for (const q of ['claude', 'anthropic', 'mcp server']) {
    const j = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>8`);
    for (const h of j.hits || []) out.push({ src: 'HN', title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, score: h.points || 0 });
  }
  return out;
}

async function fromGitHub() {
  const day = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
  const out = [];
  for (const q of [`claude created:>${day}`, `claude-code skill created:>${day}`, `mcp server created:>${day}`]) {
    const j = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`);
    for (const r of j.items || []) if (r.stargazers_count >= 20) out.push({ src: 'GitHub', title: `${r.full_name}: ${r.description || ''}`.slice(0, 200), url: r.html_url, score: r.stargazers_count });
  }
  return out;
}

// The same creators whose Instagram reels the user saves mostly post the videos/Shorts on YouTube too.
// YouTube channel feeds are free and need no key or login.
const YT_CHANNELS = {
  'Nick Saraev': 'UCbo-KbSjJDG6JWQ_MTZ_rNA', 'Simon Scrapes': 'UCdCR4-uYOg5ju-IUuDnfnQA',
  'Mark Kashef': 'UCHkzp52CldSPZqU5T49mOnA', 'ByteGrad': 'UCf6AGqO98eGk11nfazociVQ',
  'Context Window': 'UCv-QSppaeK3bhJBLm_KheNQ', 'CorgiMind': 'UCZ30wo5bhVhF_BA2X3hkk5g',
  'Jack Roberts': 'UCavC5NALKXKwzg2Xst2EQNA', 'The Hype Kevin': 'UCaU3h5OqvHWhzWFthCGr3gg',
};
async function fromYouTube() {
  const since = Date.now() - LOOKBACK_H * 3600e3;
  const feeds = await Promise.allSettled(Object.entries(YT_CHANNELS).map(async ([name, id]) => {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${r.status} ${name}`);
    const xml = await r.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
      src: `YouTube ${name}`,
      title: (e.match(/<title>([^<]*)<\/title>/) || [])[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") || '',
      url: (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '',
      published: Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1] || 0),
      score: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0) / 100,
    })).filter((v) => v.url && v.published >= since);
  }));
  return feeds.flatMap((f) => (f.status === 'fulfilled' ? f.value : []));
}

async function loadSeen(root) { try { return new Set(JSON.parse(await readFile(SEEN_FILE(root), 'utf8'))); } catch { return new Set(); } }
async function saveSeen(root, seen) {
  await mkdir(dirname(SEEN_FILE(root)), { recursive: true });
  await writeFile(SEEN_FILE(root), JSON.stringify([...seen].slice(-800)));
}

// Free Gemini only (no fallback to any paid model).
async function pickTop(items, { key, model, baseUrl }) {
  const list = items.map((it, i) => `${i}. [${it.src}] ${it.title}`).join('\n');
  const prompt = `${INTERESTS}\n\n${SKIP}\n\nFrom the numbered list, pick up to 5 items most useful to this person.
Reply with ONLY JSON: [{"i": <number>, "idea": "<one plain-English line, max 16 words, what it is + why it helps them>"}]\n\n${list}`;
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(40000),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const text = (await r.json()).choices?.[0]?.message?.content || '';
  const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  return arr.filter((x) => items[x.i]).slice(0, 5).map((x) => ({ ...items[x.i], idea: String(x.idea || '').slice(0, 160) }));
}

// Returns { text, picks } or null when nothing new.
export async function buildIdeas({ root, gemini, log = console.log }) {
  // Reddit is left out on purpose: it blocks bots, and getting around that would break the no-bypass rule.
  const results = await Promise.allSettled([fromHN(), fromGitHub(), fromYouTube()]);
  const names = ['HN', 'GitHub', 'YouTube creators'];
  results.forEach((r, i) => log(`[ideas] ${names[i]}: ${r.status === 'fulfilled' ? `${r.value.length} items` : `failed (${r.reason?.message})`}`));
  const seen = await loadSeen(root);
  const byUrl = new Map();
  for (const r of results) if (r.status === 'fulfilled') for (const it of r.value) if (!seen.has(it.url) && it.title) byUrl.set(it.url, it);
  const items = [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, 45);
  if (!items.length) return null;
  let picks;
  try { picks = gemini?.key ? await pickTop(items, gemini) : null; } catch (e) { log(`[ideas] gemini pick failed: ${e.message}`); }
  if (!picks?.length) picks = items.slice(0, 5).map((it) => ({ ...it, idea: it.title.slice(0, 120) }));
  for (const p of picks) seen.add(p.url);
  await saveSeen(root, seen).catch(() => {});
  const text = `💡 CLAUDE IDEAS (reply "do 2" or "do 1,3"):\n${picks.map((p, n) => `${n + 1}. ${p.idea}\n   ${p.url}`).join('\n')}`;
  return { text, picks };
}

// "do 3" / "do 1,4" / "do 1 and 3" -> [3] / [1,4] / [1,3]; anything else -> null.
export function parseDo(text) {
  const m = String(text || '').trim().toLowerCase().match(/^do\s+(\d(?:\s*(?:,|and|&)\s*\d)*)\s*$/);
  return m ? [...new Set(m[1].match(/\d/g).map(Number))].filter((n) => n >= 1 && n <= 5) : null;
}
