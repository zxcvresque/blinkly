// Blinkly background worker: keeps the packaged toolbar icon and badge countdown.
if (typeof importScripts === 'function' && !globalThis.BlinklySleep) importScripts('sleep-schedule.js');
if (typeof importScripts === 'function' && !globalThis.BlinklyPreferences) importScripts('reminder-preferences.js');
if (typeof importScripts === 'function' && !globalThis.BlinklyVoiceCadence) importScripts('voice-cadence.js');
const Sleep = globalThis.BlinklySleep;
const Preferences = globalThis.BlinklyPreferences;
const Cadence = globalThis.BlinklyVoiceCadence;
const ACCENT = '#ef5b78', BREAK = '#7dd3c0';
let lastKey = '';

// Serve only the pre-generated local pack. The extension never relays TTS calls.
const CLIP_KEY = /^vo_[a-z0-9]+$/;
const CLIP_FILE = /^audio\/vo_[a-z0-9]+\.mp3$/;
const audioCache = new Map();
let packPromise, brandIconPromise;
function brandIcon() {
  if (!brandIconPromise) brandIconPromise = fetch(chrome.runtime.getURL('icons/icon48.png'))
    .then(response => {
      if (!response.ok) throw new Error('Packaged brand icon is unavailable');
      return response.arrayBuffer();
    }).then(buffer => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }).catch(error => { brandIconPromise = null; throw error; });
  return brandIconPromise;
}
function readPack() {
  if (!packPromise) packPromise = fetch(chrome.runtime.getURL('audio/manifest.json'))
    .then(r => { if (!r.ok) throw new Error('Voice pack is unavailable'); return r.json(); })
    .then(pack => {
      if (!pack || !pack.clips || typeof pack.clips !== 'object' || Array.isArray(pack.clips))
        throw new Error('Invalid voice pack');
      return pack;
    }).catch(error => { packPromise = null; throw error; });
  return packPromise;
}
function validClips(pack) {
  return Object.entries(pack.clips).filter(([key, clip]) =>
    CLIP_KEY.test(key) && clip && CLIP_FILE.test(clip.file) && clip.file === `audio/${key}.mp3`);
}
async function bundledAudio(key) {
  if (typeof key !== 'string' || !CLIP_KEY.test(key)) throw new Error('Invalid clip key');
  if (audioCache.has(key)) {
    const cached = audioCache.get(key);
    audioCache.delete(key); audioCache.set(key, cached);
    return cached;
  }
  const pack = await readPack(), clip = Object.hasOwn(pack.clips, key) && pack.clips[key];
  if (!clip || typeof clip.file !== 'string' || !CLIP_FILE.test(clip.file) || clip.file !== `audio/${key}.mp3`)
    throw new Error('Clip is not in the bundled voice pack');
  const response = await fetch(chrome.runtime.getURL(clip.file));
  if (!response.ok) throw new Error('Bundled clip is unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(binary);
  audioCache.set(key, b64);
  while (audioCache.size > 12) audioCache.delete(audioCache.keys().next().value);
  return b64;
}
async function canSpeak(sender) {
  try {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return false;
    const [tabs, window] = await Promise.all([
      chrome.tabs.query({ active: true, lastFocusedWindow: true }),
      chrome.windows.getLastFocused()
    ]);
    return window?.focused === true && tabs[0]?.id === tabId;
  } catch { return false; }
}

const ROTATION_GROUP = /^(day|night|drunk):(?:(?:warn|step):[0-3]|(?:snooze|done):0)$/;
const SESSION_ID = /^\d{1,16}$/;
const ACTION_ID = /^[A-Za-z0-9:_-]{1,160}$/;
let selectionQueue = Promise.resolve();
function selectFromBag(groups, group, keys, petForKey = () => '', lastPet = '') {
  const pool = [...new Set(keys)].sort();
  const signature = pool.join('|'), saved = groups[group];
  const last = typeof saved?.last === 'string' ? saved.last : '';
  let bag = saved?.signature === signature && Array.isArray(saved.bag) ? [...saved.bag] : [];
  if (new Set(bag).size !== bag.length || bag.some(key => !pool.includes(key))) bag = [];
  if (!bag.length) {
    bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // pop() is the next selection, including after a changed pool.
    if (bag.length > 1 && bag[bag.length - 1] === last)
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  // Prefer a different spoken nickname across all alert/rest groups and worker restarts.
  // Keep skipped entries for a later draw rather than consuming them silently.
  let next = bag.length - 1;
  if (lastPet && petForKey(bag[next]) === lastPet) {
    next = bag.findIndex(key => petForKey(key) !== lastPet);
    if (next < 0) {
      const alternative = pool.find(key => petForKey(key) !== lastPet);
      if (alternative) bag.push(alternative), next = bag.length - 1;
      else return null; // A sole favorite using the same nickname waits for another name.
    }
  }
  const [key] = bag.splice(next, 1);
  groups[group] = { signature, bag, last: key };
  return key;
}
async function selectClip(message, sender) {
  if (!(await canSpeak(sender))) return { ok: true, key: null };
  if (typeof message.group !== 'string' || !ROTATION_GROUP.test(message.group))
    throw new Error('Invalid voice rotation group');
  const step = /:step:([0-3])$/.exec(message.group);
  const reaction = /:(snooze|done):0$/.exec(message.group);
  if ((step || reaction?.[1] === 'done' || reaction && message.sessionId !== undefined)
    && (typeof message.sessionId !== 'string' || !SESSION_ID.test(message.sessionId)))
    throw new Error('Invalid break session');
  if (reaction && (typeof message.actionId !== 'string' || !ACTION_ID.test(message.actionId)))
    throw new Error('Invalid voice action');
  if (message.restGuidance !== undefined && !['quiet', 'balanced'].includes(message.restGuidance))
    throw new Error('Invalid rest guidance');
  if (message.factKeys !== undefined && (!step || step[1] !== '0'))
    throw new Error('Facts can only replace the opening rest guidance');
  if (message.duration !== undefined && (typeof message.duration !== 'number' || !Number.isFinite(message.duration)
    || message.duration < 10 || message.duration > 120)) throw new Error('Invalid rest duration');
  const factsEvery = message.factsEvery === undefined ? Preferences.defaults.factsEvery : message.factsEvery;
  if (!Preferences.FACT_FREQUENCIES.includes(factsEvery)) throw new Error('Invalid fact frequency');
  const pack = await readPack();
  const validateKeys = (keys, allowEmpty = false) => {
    if (!Array.isArray(keys) || keys.length > 64 || (!allowEmpty && !keys.length))
      throw new Error('Invalid clip selection pool');
    for (const key of keys) {
      const clip = typeof key === 'string' && CLIP_KEY.test(key) && Object.hasOwn(pack.clips, key) && pack.clips[key];
      if (!clip || typeof clip.file !== 'string' || !CLIP_FILE.test(clip.file) || clip.file !== `audio/${key}.mp3`)
        throw new Error('Clip is not in the bundled voice pack');
    }
    return [...new Set(keys)];
  };
  let keys = validateKeys(message.keys, !!step || !!reaction);
  const factKeys = message.factKeys === undefined ? [] : validateKeys(message.factKeys, true);
  const stored = (await chrome.storage.local.get(['voiceRotation'])).voiceRotation;
  const rotation = stored?.schema === 1 && stored.groups && typeof stored.groups === 'object' && !Array.isArray(stored.groups)
    ? stored : { schema: 1, groups: {}, sessionCount: 0, sessions: [] };
  rotation.sessions = Array.isArray(rotation.sessions) ? rotation.sessions.filter(s => s && SESSION_ID.test(s.id)).slice(-64) : [];
  rotation.sessionCount = Number.isSafeInteger(rotation.sessionCount) && rotation.sessionCount >= 0 ? rotation.sessionCount : 0;
  rotation.actions = Array.isArray(rotation.actions) ? rotation.actions.filter(action => action && typeof action.id === 'string' && ACTION_ID.test(action.id)).slice(-128) : [];
  if (reaction && rotation.actions.some(action => action.id === message.actionId)) return { ok: true, key: null };
  let session = (step || reaction) && rotation.sessions.find(s => s.id === message.sessionId);
  if (step?.[1] === '0' && !session) {
    ++rotation.sessionCount;
    session = { id: message.sessionId, duration: message.duration ?? 20, restGuidance: message.restGuidance || 'balanced', factsEvery,
      factDue: factsEvery > 0 && rotation.sessionCount % factsEvery === 0, factUsed: false, selectedSteps: {}, pet: '' };
    rotation.sessions.push(session);
    rotation.sessions = rotation.sessions.slice(-64);
  }
  if (step) {
    if (!session) return { ok: true, key: null };
    // Old records were created when their opening was selected. Conservatively
    // mark that opening consumed so upgrading cannot narrate the same rest twice.
    if (!session.selectedSteps || typeof session.selectedSteps !== 'object' || Array.isArray(session.selectedSteps))
      session.selectedSteps = { 0: null };
    if (!Cadence.restStepAllowed(session.duration, Number(step[1]), session.restGuidance || 'quiet') || Object.hasOwn(session.selectedSteps, step[1]))
      return { ok: true, key: null };
  }
  let group = message.group;
  let usingFact = false;
  if (step?.[1] === '0' && factsEvery > 0 && session.factDue && factKeys.length) {
    group = message.group.replace(/:step:0$/, ':fact:0');
    keys = factKeys; usingFact = true;
  }
  if (!(await canSpeak(sender))) return { ok: true, key: null };
  // Silent muted steps still count the rest, without creating an empty rotation bag.
  const petForKey = key => {
    const clip = pack.clips[key];
    if (typeof clip?.pet === 'string' && clip.pet.trim()) return clip.pet.trim().toLowerCase();
    // Names already spoken in the recorded copy also count toward consistency.
    if (clip?.mood !== 'flirty' && !clip?.memberships?.length) return '';
    return typeof clip.text === 'string'
      ? clip.text.match(/\b(daddy|handsome|handshome|babeee|hot shtuff|trouble|mister|beautiful|vixen|gorgeoush?)\b/i)?.[0].toLowerCase() || '' : '';
  };
  const lastPet = typeof rotation.lastPet === 'string' ? rotation.lastPet : '';
  const sessionConsistent = step?.[1] === '2' || reaction && !!session;
  if (sessionConsistent) {
    const pet = typeof session.pet === 'string' ? session.pet : '';
    const matching = pet ? keys.filter(key => petForKey(key) === pet) : [];
    keys = matching.length ? matching : keys.filter(key => !petForKey(key));
  }
  const key = keys.length ? selectFromBag(rotation.groups, group, keys, petForKey, sessionConsistent ? '' : lastPet) : null;
  if (step) {
    session.selectedSteps[step[1]] = key;
    if (step[1] === '0') session.pet = key ? petForKey(key) : '';
    if (usingFact && key) session.factUsed = true;
  }
  if (reaction) { rotation.actions.push({ id: message.actionId }); rotation.actions = rotation.actions.slice(-128); }
  if (key && petForKey(key)) rotation.lastPet = petForKey(key);
  await chrome.storage.local.set({ voiceRotation: rotation });
  return { ok: true, key };
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'blinkly-brand-icon') {
    brandIcon().then(b64 => respond({ ok: true, b64, mime: 'image/png' }))
      .catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'blinkly-can-speak') {
    canSpeak(_sender).then(allowed => respond({ ok: true, allowed }));
    return true;
  }
  if (message?.type === 'blinkly-select-clip') {
    const result = selectionQueue.then(() => selectClip(message, _sender));
    selectionQueue = result.catch(() => {});
    result.then(respond).catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'blinkly-audio') {
    bundledAudio(message.key).then(b64 => respond({ ok: true, b64 }))
      .catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'blinkly-audio-library') {
    readPack().then(pack => respond({ ok: true, clips: validClips(pack).map(([key, clip]) => {
      const text = typeof clip.text === 'string' ? clip.text : '';
      const transcript = typeof clip.transcript === 'string' ? clip.transcript : text.replace(/\[[^\]]*\]\s*/g, '').trim();
      return {
        key,
        ...(typeof clip.gender === 'string' ? { gender: clip.gender } : {}),
        title: typeof clip.title === 'string' ? clip.title : transcript,
        category: typeof clip.category === 'string' ? clip.category : 'voice',
        context: typeof clip.context === 'string' ? clip.context : 'any',
        mood: typeof clip.mood === 'string' ? clip.mood : '',
        usage: typeof clip.usage === 'string' ? clip.usage : '',
        transcript,
        tags: Array.isArray(clip.tags) ? clip.tags.filter(tag => typeof tag === 'string') : [...text.matchAll(/\[([^\]]+)\]/g)].map(match => match[1])
      };
    }) })).catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'blinkly-pack-status') {
    readPack().then(pack => {
      const clips = validClips(pack);
      respond({ ok: true, count: clips.length, availableKeys: clips.map(([key]) => key), expectedCount: pack.expectedCount || clips.length, complete: pack.complete === true,
        bytes: clips.reduce((sum, [, clip]) => sum + (Number(clip.bytes) || 0), 0),
        duration: clips.reduce((sum, [, clip]) => sum + (Number(clip.duration) || 0), 0),
        voiceId: pack.voiceId || '', model: pack.model || '' });
    }).catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
});

async function read() {
  const r = await chrome.storage.local.get(['state', 'cfg']);
  return { S: r.state || {}, C: { ...Sleep.defaults, ...Preferences.defaults, ...(r.cfg || {}) } };
}

async function refresh() {
  const { S, C } = await read();
  const work = Sleep.effectiveWorkMin(C) * 60, brk = S.phase === 'break';
  const now = Date.now(), quiet = !brk && Preferences.quietNow(C);
  let frac, text, title, color = C.accent === '#f4a259' ? ACCENT : C.accent || ACCENT;
  const stale = !brk && now - (S.lastTick || 0) > 4000;
  if (brk) {
    const total = (S.breakLen || 20) * 1000, remain = Math.max(0, (S.breakEnd || 0) - now);
    frac = 1 - remain / total; text = Math.ceil(remain / 1000) + 's'; color = BREAK;
    title = 'Blinkly: look 20 feet away';
  } else if (quiet) {
    frac = 1 - (S.elapsed || 0) / work; text = 'Zz'; title = 'Blinkly: quiet hours';
  } else {
    const left = Math.max(0, work - (S.elapsed || 0));
    frac = 1 - (S.elapsed || 0) / work;
    text = S.paused ? 'II' : left >= 60 ? String(Math.ceil(left / 60)) : left + 's';
    title = `Blinkly: ${S.paused ? 'paused' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' until your next break'}`;
  }
  const dim = !brk && (S.paused || stale || quiet);
  const key = [brk, text, Math.round(frac * 48), dim, color].join('|');
  if (key === lastKey) return;
  lastKey = key;
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: brk ? '#2a7f6e' : dim ? '#4a4766' : '#c9743a' });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' });
  chrome.action.setTitle({ title });
}

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.state || ch.cfg)) refresh(); });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('ev', { periodInMinutes: 0.5 }); refresh(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('ev', { periodInMinutes: 0.5 }); refresh(); });
chrome.alarms.onAlarm.addListener(() => { lastKey = ''; refresh(); });
refresh();
