const $ = (id) => document.getElementById(id);
const history = [];
let passcode = localStorage.getItem('friday-passcode') || '';
let lang = localStorage.getItem('friday-lang') || 'en-IN';
let audio = null;
let recognizer = null;
let speaking = false; // the browser's own voice is talking
let fastVoice = localStorage.getItem('friday-voice') !== 'gemini';
let wakeOn = localStorage.getItem('friday-wake') === '1';
let wakeRec = null;

const setState = (text, mode = '') => {
  $('state').textContent = text;
  document.body.className = mode;
};

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Friday-Passcode': passcode },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    passcode = prompt('Friday passcode') || '';
    localStorage.setItem('friday-passcode', passcode);
    return api(path, body);
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r;
}

function add(role, text, note) {
  $('empty')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (role === 'friday') el.innerHTML = '<div class="who">FRIDAY</div>';
  el.append(document.createTextNode(text));
  if (note) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = note;
    el.append(n);
  }
  $('log').append(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function refreshStatus() {
  try {
    const s = await (await api('/api/status')).json();
    $('dot-brain').className = 'dot ' + (s.brain ? 'on' : 'off');
    showVoice();
  } catch {
    $('dot-brain').className = 'dot off';
  }
}

function stopSpeaking() {
  if (audio) { audio.pause(); audio = null; }
  if (speaking) { speaking = false; speechSynthesis.cancel(); }
}

async function ask(text) {
  text = text.trim();
  if (!text) return;
  stopSpeaking();
  wakeStop();
  add('you', text);
  history.push({ role: 'user', content: text });
  setState('Thinking…', 'thinking');
  try {
    // Only the last few turns go to the model, to keep each request small.
    const { reply, saved } = await (await api('/api/chat', { messages: history.slice(-6) })).json();
    history.push({ role: 'assistant', content: reply });
    add('friday', reply, saved.length ? 'Saved to memory: ' + saved.join('; ') : '');
    await say(reply);
  } catch (e) {
    add('err', 'Something broke: ' + e.message);
    idle();
  }
}

// Two voices: "fast" is the browser's own voice (starts at once); "gemini" is
// FreeLLMAPI's Gemini voice (nicer, but about 7 seconds before it starts).
async function say(text) {
  setState('Speaking… tap to stop', 'speaking');
  if (fastVoice && 'speechSynthesis' in window) speakFast(text);
  else await speakGemini(text);
}

function pickVoice() {
  const want = lang.slice(0, 2).toLowerCase();
  const score = (v) => (/natural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0)
    + (v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase() ? 1 : 0);
  return speechSynthesis.getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(want))
    .sort((a, b) => score(b) - score(a))[0];
}

function speakFast(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1.1;
  const v = pickVoice();
  if (v) u.voice = v;
  let started = false;
  const done = () => { if (speaking) { speaking = false; idle(); } };
  u.onstart = () => { started = true; };
  u.onend = done;
  u.onerror = done;
  speaking = true;
  speechSynthesis.speak(u);
  // No sound within 4 seconds (no voice installed, or blocked): use the Gemini voice instead.
  setTimeout(() => {
    if (speaking && !started) { speechSynthesis.cancel(); speaking = false; speakGemini(text).catch(() => idle()); }
  }, 4000);
}

async function speakGemini(text) {
  const r = await api('/api/speak', { text });
  audio = new Audio(URL.createObjectURL(await r.blob()));
  audio.onended = () => { audio = null; idle(); };
  try {
    await audio.play();
  } catch {
    // Browsers block sound until the page has been tapped once.
    setState('Tap the page once so Friday can speak');
    document.addEventListener('click', () => audio?.play(), { once: true });
  }
}

function showVoice() {
  $('dot-voice').className = 'dot on';
  $('dot-voice').textContent = fastVoice ? 'fast voice' : 'gemini voice';
}

// "Hey Friday" wake mode: the browser listens for the name, then Friday answers.
// Only works while this page is open. Chrome's speech recogniser sends the audio
// it hears to the browser maker's servers, so this is off until you switch it on.
const WAKE = /^\s*(?:(?:hey|hi|hello|ok|okay|हे|हेलो|हैलो)[\s,]+)?(?:friday|fri day|fry day|फ्राइडे|फ्रायडे)(?![\p{L}\p{M}])[\s,.!?।]*/iu;

function handleHeard(text) {
  text = text.trim();
  const m = text.match(WAKE);
  if (!m) return; // not said to Friday, so ignore it
  const rest = text.slice(m[0].length).trim();
  wakeStop();
  if (rest) ask(rest);
  else { listen(); setState('Yes?', 'listening'); }
}

function wakeStart() {
  if (!wakeOn || !SR || wakeRec || recognizer || audio || speaking) return;
  const r = new SR();
  r.lang = lang;
  r.continuous = true;
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) handleHeard(e.results[i][0].transcript);
    }
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      setWake(false);
      setState('Mic blocked. Allow the mic for this page.');
    }
  };
  // Chrome ends a listening session every so often, so start a new one.
  r.onend = () => { if (wakeRec === r) { wakeRec = null; if (wakeOn) setTimeout(wakeStart, 500); } };
  wakeRec = r;
  try { r.start(); } catch { wakeRec = null; }
}

function wakeStop() {
  const r = wakeRec;
  wakeRec = null;
  if (r) { r.onend = null; try { r.abort(); } catch {} }
}

function idle() {
  if (audio || recognizer || speaking) return;
  setState(wakeOn && SR ? 'Say "Hey Friday"' : 'Tap to talk', wakeOn && SR ? 'waking' : '');
  wakeStart();
}

function setWake(on) {
  wakeOn = on;
  localStorage.setItem('friday-wake', on ? '1' : '0');
  $('wake').textContent = on ? 'Wake on' : 'Wake off';
  $('wake').classList.toggle('on', on);
  if (!on) wakeStop();
  idle();
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  if (!SR) { setState('This browser has no voice input. Use Chrome, or type.'); return; }
  wakeStop();
  recognizer = new SR();
  recognizer.lang = lang;
  recognizer.interimResults = true;
  let finalText = '';
  recognizer.onresult = (e) => {
    let interim = '';
    for (const r of e.results) {
      if (r.isFinal) finalText = r[0].transcript;
      else interim += r[0].transcript;
    }
    setState(interim || finalText || 'Listening…', 'listening');
  };
  recognizer.onerror = (e) => setState(e.error === 'not-allowed'
    ? 'Mic blocked. Allow the mic for this page.'
    : "Didn't catch that. Tap to try again.");
  recognizer.onend = () => {
    recognizer = null;
    if (finalText) ask(finalText);
    else if (document.body.className === 'listening') idle();
    else wakeStart();
  };
  setState('Listening…', 'listening');
  recognizer.start();
}

$('mic').onclick = () => {
  if (audio || speaking) { stopSpeaking(); idle(); return; }
  if (recognizer) { recognizer.stop(); return; }
  listen();
};
$('form').onsubmit = (e) => {
  e.preventDefault();
  const t = $('text').value;
  $('text').value = '';
  ask(t);
};
const showLang = () => ($('lang').textContent = lang === 'hi-IN' ? 'हिं' : 'EN');
$('lang').onclick = () => {
  lang = lang === 'hi-IN' ? 'en-IN' : 'hi-IN';
  localStorage.setItem('friday-lang', lang);
  showLang();
  if (wakeRec) { wakeStop(); wakeStart(); }
};
$('wake').onclick = () => setWake(!wakeOn);
$('dot-voice').onclick = () => {
  fastVoice = !fastVoice;
  localStorage.setItem('friday-voice', fastVoice ? 'fast' : 'gemini');
  showVoice();
};
$('dot-voice').title = 'Tap to switch voice: fast (instant) or Gemini (nicer, slower)';
if (!SR) $('wake').hidden = true;
showLang();
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // starts loading the voice list
setWake(wakeOn && Boolean(SR));
refreshStatus();
setInterval(refreshStatus, 30000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
