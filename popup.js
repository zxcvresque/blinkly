const $ = id => document.getElementById(id);
const Sleep = globalThis.BlinklySleep;
const Preferences = globalThis.BlinklyPreferences;
const DEF = { ...Sleep.defaults, ...Preferences.defaults, workMin: 20, breakSec: 20, accent: '#ef5b78', idleMin: 2 };
let S = {}, C = { ...DEF }, sceneProgress = null, scene, frameId = 0, frameAt, sceneClock = 0;
const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let reducedMotion = !!motionPreference?.matches;
const normalizeConfig = value => {
  const cfg = { ...DEF, ...(value || {}) };
  if (!cfg.accent || /^#f4a259$/i.test(cfg.accent)) cfg.accent = DEF.accent;
  return cfg;
};

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function drawScene(dt = 0) {
  scene?.draw({ progress: sceneProgress ?? 0, clock: reducedMotion ? 0 : sceneClock, dt: reducedMotion ? 0 : dt, accent: C.accent });
}
function animate(now) {
  frameId = 0;
  if (!scene || reducedMotion) return;
  const dt = frameAt === undefined ? 0 : Math.max(0, Math.min(.1, (now - frameAt) / 1000));
  frameAt = now; sceneClock += dt; drawScene(dt);
  frameId = requestAnimationFrame(animate);
}
function motionChanged() {
  reducedMotion = !!motionPreference?.matches;
  if (frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
  frameId = 0; frameAt = undefined; sceneClock = 0;
  drawScene();
  if (scene && !reducedMotion && typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(animate);
}
function startScene() {
  if (!globalThis.BlinklyScenes?.createWindow) return;
  try {
    scene = BlinklyScenes.createWindow($('window-scene'));
    drawScene();
    if (!reducedMotion && typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(animate);
  } catch { scene = null; }
}
function stopScene() {
  if (frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
  frameId = 0; scene?.destroy(); scene = null;
  if (motionPreference?.removeEventListener) motionPreference.removeEventListener('change', motionChanged);
  else motionPreference?.removeListener?.(motionChanged);
}

function render() {
  const now = Date.now(), brk = S.phase === 'break', workMin = Sleep.effectiveWorkMin(C), work = workMin * 60;
  document.documentElement.style.setProperty('--ac', C.accent);
  const idle = now - (S.lastAct || 0) > C.idleMin * 60000;
  // Stored elapsed time already pauses; explicit timer changes must stay authoritative.
  if (sceneProgress === null || !brk)
    sceneProgress = Math.max(0, Math.min(1, (S.elapsed || 0) / work));
  let big, small;
  if (brk) {
    const remain = Math.max(0, (S.breakEnd || 0) - now);
    big = Math.ceil(remain / 1000); small = 'look 20 feet away';
  } else {
    const left = Math.max(0, work - (S.elapsed || 0));
    big = fmt(left);
    small = Preferences.quietNow(C) ? 'Quiet hours' : S.paused ? 'paused' : idle ? 'away, timer waiting' : 'until your next break';
  }
  $('t').textContent = big; $('l').textContent = small;
  drawScene();
  $('b-pause').textContent = S.paused ? 'Resume' : 'Pause';
  $('b-snooze').hidden = !!C.strict;
  $('b-snooze').parentElement.style.gridTemplateColumns = C.strict ? 'repeat(2,1fr)' : '';
  const d = (S.days || {})[new Date().toLocaleDateString('en-CA')] || { d: 0, s: 0, a: 0 };
  $('s-d').textContent = d.d; $('s-s').textContent = d.s;
  $('s-a').textContent = d.a >= 3600 ? (d.a / 3600).toFixed(1) + 'h' : Math.round(d.a / 60) + 'm';
}

async function load() {
  const [r, reply] = await Promise.all([chrome.storage.local.get(['cfg']),
    chrome.runtime.sendMessage({ type: 'blinkly-timer', action: 'snapshot' })]);
  S = reply?.state || {}; C = normalizeConfig(r.cfg); render();
}
async function command(action, extra = {}) {
  const reply = await chrome.runtime.sendMessage({ type: 'blinkly-timer', action, ...extra });
  if (!reply?.ok) throw new Error(reply?.error || 'Blinkly timer is unavailable');
  if ((reply.state.revision || 0) >= (S.revision || 0)) S = reply.state;
  render();
}

$('b-now').onclick = () => command('start', { manual: true });
$('b-pause').onclick = () => command('pause');
$('b-snooze').onclick = () => command('snooze');
$('b-set').onclick = async () => {
  const status = $('settings-status');
  status.textContent = ''; status.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error('No active tab');
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'panel', open: true });
    if (reply?.ok !== true) throw new Error('Panel did not acknowledge opening');
    window.close();
  } catch {
    status.textContent = 'Refresh this tab once after updating Blinkly, then try Settings again. Browser settings and extension-store pages do not allow the panel.';
    status.hidden = false;
  }
};

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.state?.newValue?.timerSchema === 1 && (ch.state.newValue.revision || 0) >= (S.revision || 0)) S = ch.state.newValue;
  if (ch.cfg) C = normalizeConfig(ch.cfg.newValue);
  render();
});
if (motionPreference?.addEventListener) motionPreference.addEventListener('change', motionChanged);
else motionPreference?.addListener?.(motionChanged);
startScene(); load(); setInterval(render, 500);
if (typeof addEventListener === 'function') addEventListener('pagehide', stopScene, { once: true });
