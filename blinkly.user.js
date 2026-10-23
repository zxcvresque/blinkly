// ==UserScript==
// @name         Blinkly: 20-20-20 eye care
// @namespace    https://blinkly.local
// @version      2.6.3
// @description  Blinkly extension runtime: window light, misty mountains, guided eye breaks, cross-tab sync, and bundled offline ElevenLabs guidance.
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_deleteValue
// ==/UserScript==

(async () => {
  'use strict';
  const Voice = globalThis.BlinklyVoice, Sleep = globalThis.BlinklySleep, Prefs = globalThis.BlinklyPreferences;
  const Placement = globalThis.BlinklyPlacement, Cadence = globalThis.BlinklyVoiceCadence, AudioActivation = globalThis.BlinklyAudioActivation;
  if (!Voice || !Sleep || !Prefs || !Placement || !Cadence || !AudioActivation) { console.error('Blinkly: load the complete extension folder.'); return; }
  const PAGE = /^[a-z-]*extension:$/.test(location.protocol); // extension settings page
  if (window.top !== window.self || document.getElementById('blinkly-root')) return;

  /* ───────────── storage: Violentmonkey, extension, or localStorage ───────────── */
  const hasGM = typeof GM_getValue === 'function';
  const hasCR = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const cache = {}, subs = [];
  const copy = value => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  const Store = {
    coordinated: !!(hasCR && !hasGM && chrome.runtime?.id),
    async init() {
      if (!hasCR || hasGM) return;
      try {
        const changed = new Set();
        // Subscribe before the async read: another tab may advance while this
        // document starts. Never replace that newer event with an older snapshot.
        chrome.storage.onChanged.addListener((ch, area) => {
          if (area !== 'local') return;
          for (const k in ch) { if (k !== 'cfg' && k !== 'state') continue; changed.add(k); cache[k] = copy(ch[k].newValue); subs.forEach(f => f(k, copy(ch[k].newValue))); }
        });
        const stored = await chrome.storage.local.get(['cfg', 'state']);
        for (const k of ['cfg', 'state']) if (!changed.has(k) && k in stored) cache[k] = copy(stored[k]);
        if (this.coordinated) {
          const reply = await this.command('snapshot');
          if (!cache.state || (reply.state.revision || 0) >= (cache.state.revision || 0)) cache.state = copy(reply.state);
        }
      } catch {}
    },
    async command(action, details = {}) {
      const reply = await chrome.runtime.sendMessage({ type: 'blinkly-timer', action, ...details });
      if (!reply?.ok || !reply.state) throw new Error(reply?.error || 'Blinkly timer is unavailable. Refresh this tab after updating the extension.');
      return reply;
    },
    get(k, d) {
      if (hasGM) return GM_getValue(k, d);
      if (hasCR) return k in cache ? copy(cache[k]) : d;
      try { const v = localStorage.getItem('ev_' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try {
        if (hasGM) GM_setValue(k, v);
        else if (hasCR) { cache[k] = copy(v); chrome.storage.local.set({ [k]: copy(v) }); }
        else localStorage.setItem('ev_' + k, JSON.stringify(v));
      } catch {}
    },
    on(f) {
      if (hasGM && typeof GM_addValueChangeListener === 'function')
        ['state', 'cfg'].forEach(k => GM_addValueChangeListener(k, (n, o, nv, remote) => remote && f(k, nv)));
      else if (hasCR) subs.push(f);
      else addEventListener('storage', e => { if (e.key && e.key.startsWith('ev_') && e.newValue) f(e.key.slice(3), JSON.parse(e.newValue)); });
    }
  };
  await Store.init();

  /* ───────────── config + state ───────────── */
  const DEFAULTS = {
    ...Sleep.defaults, ...Prefs.defaults, ...Placement.defaults, libraryPreference: 'all', settingsTab: 'rhythm', libraryCategory: '', librarySearch: '', flirty: false, recipientGender: 'male',
    workMin: 20, breakSec: 20, warnSec: 30, mode: 'overlay', strict: false,
    warm: 0, warmNight: false, accent: '#ef5b78', sound: true, volume: 0.4, notify: false,
    idleMin: 2, deferMedia: true, widget: true, corner: 'br', blocklist: '',
    voiceOn: true, voiceId: Voice.VOICE_ID, voiceModel: Voice.MODEL, voiceVol: 0.9,
    restGuidance: 'balanced', voiceSnooze: true, voiceDone: true
  };
  const readConfig = value => {
    const config = Placement.normalize(Prefs.normalize(Sleep.normalize({ ...DEFAULTS, ...value, voiceId: Voice.VOICE_ID, voiceModel: Voice.MODEL })));
    if (typeof value?.warmNow !== 'boolean' && value?.warm > 0 && !value?.warmNight) config.warmNow = true;
    return { ...config, restGuidance: config.restGuidance === 'quiet' ? 'quiet' : 'balanced',
      libraryCategory: config.libraryCategory === 'Completion (preview only)' ? 'Completion' : config.libraryCategory,
      voiceSnooze: typeof config.voiceSnooze === 'boolean' ? config.voiceSnooze : true,
      voiceDone: typeof config.voiceDone === 'boolean' ? config.voiceDone : true,
      corner: ['tl', 'tr', 'bl', 'br', 'custom'].includes(config.corner) ? config.corner : 'br', accent: config.accent === '#f4a259' ? '#ef5b78' : config.accent, recipientGender: config.recipientGender === 'female' ? 'female' : 'male' };
  };
  let cfg = readConfig(Store.get('cfg', {}));
  // Migrate old settings without retaining the generation credential.
  if ('voiceKey' in cfg) { delete cfg.voiceKey; Store.set('cfg', cfg); }
  const ME = Math.random().toString(36).slice(2);
  const freshState = () => ({ phase: 'work', elapsed: 0, breakEnd: 0, breakLen: 20, paused: false, lastTick: 0, owner: '', lastAct: Date.now(), res: '', resAt: 0, resUntil: 0, days: {}, snoozeCount: 0, voiceEvent: null, mediaNotified: false, manualBreak: false, w: '' });
  let S = { ...freshState(), ...Store.get('state', {}) };

  if (!PAGE && cfg.blocklist.split(/[\s,]+/).filter(Boolean).some(h => location.hostname === h || location.hostname.endsWith('.' + h))) return;

  const save = () => {
    if (Store.coordinated) {
      // Playback can extend the visible Rested state; it cannot replace timer
      // fields using a content script's potentially stale local snapshot.
      return sharedCommand('presentation', { sessionId: String(S.breakEnd), resAt: S.resAt, resUntil: S.resUntil });
    }
    S.w = ME; Store.set('state', S);
  };
  async function sharedCommand(action, details = {}) {
    try {
      const reply = await Store.command(action, details);
      receiveState(reply.state);
      return reply;
    } catch (error) { console.warn('Blinkly:', error.message); return null; }
  }
  const dayKey = () => new Date().toLocaleDateString('en-CA');
  const day = () => {
    const k = dayKey();
    if (!S.days[k]) {
      S.days[k] = { d: 0, s: 0, a: 0 };
      Object.keys(S.days).sort().slice(0, -14).forEach(x => delete S.days[x]);
    }
    return S.days[k];
  };
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const limit = () => Sleep.effectiveWorkMin(cfg) * 60;

  /* ───────────── sound ───────────── */
  const audio = AudioActivation.create({ onReady: resumeBlockedVoice });
  async function playbackContext() {
    const context = await audio.ready();
    // A prior genuine page interaction also permits recovery after suspension.
    return context || audio.unlock();
  }
  async function chime(kind) {
    if (!cfg.sound || document.visibilityState !== 'visible') return;
    if (extensionPlayback) {
      const token = `${ME}:chime:${++playbackSequence}`;
      vCur = { remote: true, token, force: false, context: null };
      try { await packMessage({ type: 'blinkly-audio-play', chime: kind, token, volume: cfg.volume,
        event: S.phase === 'break' ? 'step' : 'done', sessionId: String(S.breakEnd), actionId: S.voiceEvent?.id }); }
      catch (error) { vstat(error.message); }
      finally { if (vCur?.token === token) vCur = null; }
      return;
    }
    const phase = S.phase, end = S.breakEnd;
    try {
      const ac = await playbackContext();
      if (!ac || phase !== S.phase || end !== S.breakEnd || document.visibilityState !== 'visible') return;
      const t = ac.currentTime, notes = kind === 'start' ? [523.25, 659.25] : [659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.2;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(cfg.volume * 0.5, s + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 1.3);
        o.connect(g).connect(ac.destination); o.start(s); o.stop(s + 1.4);
      });
    } catch {}
  }

  /* ───────────── UI ───────────── */
  const host = document.createElement('div');
  host.id = 'blinkly-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });

  const row = (l, sub, c) => `<div class="row"><div class="lbl"><b>${l}</b>${sub ? `<span>${sub}</span>` : ''}</div>${c}</div>`;
  const rng = (k, a, b, st, u) => `<div class="rg"><input type="range" data-k="${k}" min="${a}" max="${b}" step="${st}" aria-label="${k}"><output data-o="${k}" data-u="${u}"></output></div>`;
  const tog = k => `<label class="sw"><input type="checkbox" role="switch" aria-label="${({ flirty: 'Flirty lines', voiceOn: 'Spoken guidance', voiceSnooze: 'Snooze response', voiceDone: 'Rested response', strict: 'Strict mode', sleepEnabled: 'Sleep schedule', quietEnabled: 'Quiet hours', warmNight: 'Tint only at night', warmNow: 'Tint now', sound: 'Chime', notify: 'Desktop notification', deferMedia: 'Wait for video', widget: 'Show timer' })[k] || k}" data-k="${k}"><i aria-hidden="true"></i></label>`;
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div>`;
  const ACCENTS = ['#ef5b78', '#7dd3c0', '#8ab4ff', '#f08fb0', '#c4b5fd'];


  root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;margin:0}
.wrap{position:fixed;inset:0;pointer-events:none;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#ece9f5;--ac:#ef5b78;--ink:#17162b;--ink2:#201f3a;--line:rgba(255,255,255,.09);--mute:rgba(236,233,245,.56);--serif:"Iowan Old Style","Palatino Linotype",Charter,Georgia,serif;--ease:cubic-bezier(.2,.8,.2,1)}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
@keyframes breathe{50%{transform:scale(1.07)}}

/* timer dial */
.w{position:fixed;display:flex;align-items:center;border-radius:99px;background:var(--ink);border:1px solid var(--line);box-shadow:0 6px 24px rgba(8,6,20,.4);pointer-events:auto;cursor:pointer;opacity:.6;transition:opacity .3s;user-select:none}
.w.br{right:16px;bottom:16px}.w.bl{left:16px;bottom:16px;flex-direction:row-reverse}.w.tr{right:16px;top:16px}.w.tl{left:16px;top:16px;flex-direction:row-reverse}
.w.custom .dial{cursor:grab;touch-action:none}.w.custom.dragging .dial{cursor:grabbing}
.w.custom.label-right{flex-direction:row-reverse}
.w.custom:hover .lab,.w.custom:focus-within .lab{max-width:min(240px,var(--label-space,240px));padding:0 2px 0 16px}
.w.custom.label-right:hover .lab,.w.custom.label-right:focus-within .lab{padding:0 16px 0 2px}
.w.custom .lt{min-width:0;overflow:hidden;text-overflow:ellipsis}.w.custom .pb{flex-shrink:0}
.w.dragging{opacity:1}.w.dragging .lab{max-width:0!important;opacity:0!important;padding:0!important}
.w:hover,.w:focus-within,.w.warn{opacity:1}
.lab{display:flex;align-items:center;gap:8px;max-width:0;opacity:0;overflow:hidden;white-space:nowrap;padding:0;transition:max-width .5s var(--ease),opacity .3s,padding .5s var(--ease)}
.w:hover .lab,.w:focus-within .lab{max-width:240px;opacity:1}
.w.br:hover .lab,.w.tr:hover .lab,.w.br:focus-within .lab,.w.tr:focus-within .lab{padding:0 2px 0 16px}
.w.bl:hover .lab,.w.tl:hover .lab,.w.bl:focus-within .lab,.w.tl:focus-within .lab{padding:0 16px 0 2px}
.lt{font:italic 14px var(--serif);color:var(--mute)}.lt b{font:500 15px var(--serif);font-style:normal;color:#ece9f5;font-variant-numeric:tabular-nums}
.pb{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line)}.pb:hover{background:rgba(255,255,255,.1)}
.dial{position:relative;width:46px;height:46px;flex:none}
.dial svg{position:absolute;inset:0;transform:rotate(-90deg)}
.dial b{position:absolute;inset:0;display:grid;place-items:center;font:500 15px var(--serif);font-variant-numeric:tabular-nums}
.w.warn .dial{animation:breathe 2.4s ease-in-out infinite}
.w.paused .dial b,.w.idle .dial b{opacity:.55}

/* heads-up */
.toast{position:fixed;top:16px;left:50%;translate:-50% -170%;display:flex;align-items:center;gap:20px;padding:12px 14px 15px 18px;border-radius:12px;background:var(--ink);border:1px solid var(--line);box-shadow:0 14px 40px rgba(8,6,20,.5);transition:translate .7s var(--ease);pointer-events:auto;overflow:hidden;max-width:calc(100vw - 24px)}
.toast.on{translate:-50% 0}
.toast b{display:block;font:400 18px/1.2 var(--serif)}.toast span{color:var(--mute);font-size:12px}
.tb{display:flex;gap:6px}.tb button{padding:6px 11px;border-radius:8px;border:1px solid var(--line)}.tb button:hover{background:rgba(255,255,255,.08)}
.tb .pri{background:var(--ac);color:#1c1530;border-color:transparent;font-weight:600}.tb .pri:hover{filter:brightness(1.08)}
.toast .tl{position:absolute;left:0;bottom:0;height:2px;width:calc(var(--tp,1)*100%);background:var(--ac);transition:width 1s linear}
.toast.plain .tb,.toast.plain .tl{display:none}

/* break screen */
.ov{position:fixed;inset:0;opacity:0;visibility:hidden;transition:opacity 1.4s ease,visibility 1.4s;pointer-events:none;overflow:hidden}
.ov.on{opacity:1;visibility:visible;pointer-events:auto}
.scene{position:absolute;inset:0;--p:0}
.scene canvas{position:absolute;inset:0;display:block;width:100%;height:100%}
.lid{position:absolute;left:0;right:0;height:50%;pointer-events:none;will-change:transform;z-index:2}
.lid.t{top:0;background:linear-gradient(#020206 60%,transparent);transform:translateY(-100%)}
.lid.b{bottom:0;background:linear-gradient(transparent,#020206 40%);transform:translateY(100%)}
.box{position:absolute;inset:0;z-index:3;pointer-events:none}
.top{position:absolute;left:0;right:0;top:10%;display:grid;justify-items:center;gap:8px;text-align:center;padding:0 24px}
.num{font:300 clamp(72px,14vmin,132px)/1 var(--serif);font-variant-numeric:tabular-nums;letter-spacing:-.03em;text-shadow:0 6px 50px rgba(5,4,16,.55)}
.ttl{font:400 clamp(22px,3.8vmin,34px)/1.2 var(--serif);max-width:20em;animation:rise .9s var(--ease) both}
.sub{color:rgba(236,233,245,.72);font-size:15px;max-width:30em;animation:rise .9s .08s var(--ease) both}
.ov.on .num{animation:rise 1.2s .7s var(--ease) both}
.ov.on .ttl.first{animation-delay:1.1s}.ov.on .sub.first{animation-delay:1.2s}
.bot{position:absolute;left:0;right:0;bottom:6%;display:grid;justify-items:center;gap:22px;padding:0 24px;text-align:center}
.tip{max-width:34em;color:var(--mute);font:italic 15px/1.55 var(--serif)}
.btns{display:flex;gap:8px;pointer-events:auto}
.btn{padding:8px 16px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);transition:background .2s,border-color .2s}
.btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3)}
.ov.on .bot{animation:rise 1s 1.6s both}
.cbar{display:none}
.ov.done .num{font-size:clamp(48px,9vmin,84px)}
.ov.card{pointer-events:none}.ov.card .scene{display:none}
.ov.card .box{inset:auto;right:16px;bottom:16px;width:min(330px,calc(100vw - 32px));padding:18px 20px 20px;border-radius:14px;background:var(--ink);border:1px solid var(--line);box-shadow:0 24px 60px rgba(8,6,20,.55);pointer-events:auto;display:grid;gap:12px;overflow:hidden;translate:0 24px;transition:translate .9s var(--ease)}
.ov.card.on .box{translate:0 0}
.ov.card .top,.ov.card .bot{position:static;padding:0;gap:4px;justify-items:start;text-align:left;animation:none!important}
.ov.card .num{font-size:46px;animation:none!important;text-shadow:none}.ov.card .ttl{font-size:19px}.ov.card .sub{font-size:13px}.ov.card .tip{display:none}.ov.card .bot{gap:10px}

/* Countdown stays quiet above the moving landscape. */
.ring{display:grid;place-items:center}
.ring .num{font:400 clamp(18px,2.8vmin,28px)/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.06em;color:rgba(255,255,255,.7)}
.ov.done .ring .num{font:300 clamp(28px,4vmin,40px)/1.1 var(--serif);color:#fff}
.ov.card .ring .num{font-size:24px;letter-spacing:0}
.ov.card.done .ring .num{font-size:24px}

/* settings */
.p{position:fixed;top:12px;right:12px;bottom:12px;width:min(392px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:18px;background:var(--ink);border:1px solid var(--line);box-shadow:0 30px 80px rgba(8,6,20,.6);translate:110% 0;transition:translate .6s var(--ease);pointer-events:auto;overflow:hidden}
.p.on{translate:0 0}
.p.page{position:fixed;inset:auto;left:50%;top:50%;width:min(460px,calc(100vw - 24px));height:min(740px,calc(100vh - 32px));translate:-50% -50%}
.p.page .x{display:none}
.ph{display:flex;align-items:center;gap:12px;padding:20px 20px 4px}
.ph .logo{color:var(--ac);display:grid}.ph h2{font:400 24px/1 var(--serif);flex:1}
.x{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--mute)}.x:hover{background:rgba(255,255,255,.08);color:#fff}
.ps{padding:0 20px 14px 54px;font:italic 14px var(--serif);color:var(--mute)}
.tabs{position:relative;display:flex;margin:0 20px;border-bottom:1px solid var(--line)}
.tabs button{flex:1;padding:9px 0 11px;color:var(--mute);transition:color .25s}
.tabs button.on{color:#fff}
.ind{position:absolute;bottom:-1px;height:2px;background:var(--ac);border-radius:2px;transition:left .45s var(--ease),width .45s var(--ease)}
.body{flex:1;overflow:auto;padding:4px 20px 12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
.tab{display:none}.tab.on{display:block}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}
.row:last-of-type{border-bottom:0}
.row.col{flex-direction:column;align-items:stretch;gap:0}
.lbl{display:grid;gap:2px}.lbl b{font-weight:500}.lbl span{color:var(--mute);font-size:12px}
.rg{display:flex;align-items:center;gap:12px}.rg output{min-width:54px;text-align:right;font:500 15px var(--serif);font-variant-numeric:tabular-nums}
input[type=range]{-webkit-appearance:none;appearance:none;width:124px;height:3px;border-radius:3px;background:linear-gradient(90deg,var(--ac) var(--p,50%),rgba(255,255,255,.14) var(--p,50%));outline-offset:8px;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--ink);border:2px solid #fff;transition:transform .2s var(--ease),border-color .2s}
input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.25);border-color:var(--ac)}
input[type=range]::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:var(--ink);border:2px solid #fff}
.sw input{position:absolute;opacity:0}
.sw i{display:block;width:38px;height:22px;border-radius:99px;background:rgba(255,255,255,.16);position:relative;transition:background .3s;cursor:pointer}
.sw i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .35s var(--ease)}
.sw input:checked+i{background:var(--ac)}.sw input:checked+i::after{transform:translateX(16px);background:var(--toggle-thumb,#171717)}
.sw input:focus-visible+i{outline:2px solid var(--ac);outline-offset:2px}
.seg{display:flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.seg button{padding:6px 12px;color:var(--mute);transition:background .2s,color .2s}.seg button+button{border-left:1px solid var(--line)}
.seg button:hover{color:#fff}.seg button.on{background:rgba(255,255,255,.1);color:#fff}
.sws{display:flex;gap:10px}.sws button{width:20px;height:20px;border-radius:50%;box-shadow:0 0 0 2px var(--ink),0 0 0 3px transparent;transition:box-shadow .25s}
.sws button.on{box-shadow:0 0 0 2px var(--ink),0 0 0 4px #fff}
textarea{width:100%;min-height:64px;margin-top:10px;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--ink2);color:inherit;font:12px/1.5 ui-monospace,Menlo,monospace;resize:vertical}
.pf{display:flex;align-items:center;gap:6px;padding:14px 20px 18px;border-top:1px solid var(--line)}
.pf .go{flex:1;padding:10px;border-radius:10px;background:var(--ac);color:#1c1530;font-weight:600;transition:filter .2s}.pf .go:hover{filter:brightness(1.08)}
.pf .ln{padding:10px 8px;color:var(--mute);font-size:12.5px}.pf .ln:hover{color:#fff}
.stats{display:grid;grid-template-columns:repeat(3,1fr);padding:18px 0 14px}
.stat{padding:0 14px}.stat+.stat{border-left:1px solid var(--line)}.stat:first-child{padding-left:0}
.stat b{display:block;font:300 36px/1.1 var(--serif);font-variant-numeric:tabular-nums}.stat span{color:var(--mute);font-size:12px}
.chart{display:flex;align-items:flex-end;gap:10px;height:120px;padding-top:12px}
.bar{flex:1;display:grid;justify-items:center;gap:8px;height:100%;align-content:end}
.bar i{display:block;width:10px;border-radius:5px;background:color-mix(in srgb,var(--ac) 38%,transparent);min-height:3px;transform-origin:bottom;animation:grow .8s var(--ease) both}
.bar.today i{background:var(--ac)}
.bar span{font-size:11px;color:var(--mute)}
@keyframes grow{from{transform:scaleY(0)}}
.hint{color:var(--mute);font-size:12px;padding-top:14px}
input.tx{width:100%;margin-top:10px;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--ink2);color:inherit;font:12px/1.5 ui-monospace,Menlo,monospace}
.brand-icon{width:30px;height:30px;border-radius:8px;display:block}
input[type=color]{width:42px;height:32px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--ink2);cursor:pointer}
.field{max-width:160px;min-width:0;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--ink2);color:inherit;font:inherit;color-scheme:dark}
.hex{width:98px;font-family:ui-monospace,monospace}.custom-accent{display:flex;gap:8px;align-items:center}
select.field{width:100%;max-width:none;margin-top:8px}.sleep-note{padding:12px;background:rgba(255,255,255,.04);border-radius:10px;margin-top:12px;color:var(--mute);font-size:12px;line-height:1.6}
.library-tools{display:grid;gap:8px;margin-top:14px}.library-tools input{margin:0}.library-tools select{margin:0}.library-group{border-top:1px solid var(--line);margin-top:14px}.library-group h3{font-weight:500;font-size:13px;padding:13px 0 3px}.audio-item{padding:12px 0;border-bottom:1px solid var(--line)}.audio-head{display:flex;gap:10px;align-items:start}.audio-head>div{flex:1;min-width:0}.audio-head b{font-weight:500;display:block}.audio-meta{font-size:11px;color:var(--mute);display:block;margin-top:3px}.audio-text{font-size:12px;line-height:1.55;color:var(--mute);padding-top:7px}.audio-play{padding:6px 10px;border:1px solid var(--line);border-radius:8px;min-width:52px}.audio-play.on{border-color:var(--ac);color:var(--ac)}.audio-actions{display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:end;max-width:132px}.audio-pref{padding:5px 7px;border-radius:7px;color:var(--mute);border:1px solid var(--line);font-size:11px}.audio-pref[aria-pressed=true]{color:var(--ac);border-color:var(--ac)}.library-count{font-size:12px;color:var(--mute);padding-top:10px}.library-empty{padding:18px 0;color:var(--mute)}
/* Charcoal assistant-panel treatment; user-supplied visual reference. */
.wrap{--ink:#1d1d1d;--ink2:#292929;--line:rgba(255,255,255,.085);--mute:#b4b4b7;color:#f0f0f0}
.p{width:min(432px,calc(100vw - 24px));border:2px solid transparent;border-radius:22px;background:linear-gradient(#1d1d1d,#1d1d1d) padding-box,linear-gradient(135deg,#e9bad8 0%,#bfb6ea 30%,#a4dfe2 60%,#f0dfa8 84%,#e5b3d6 100%) border-box;box-shadow:0 16px 64px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.025);font:13px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;transition:translate .3s ease}
.p.page{width:min(510px,calc(100vw - 28px));height:min(820px,calc(100dvh - 32px))}
.ph{padding:20px 22px 4px;gap:10px}.ph h2{font:550 19px/1.35 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.025em}
.brand-icon{width:30px;height:30px;border-radius:9px}.ph .logo{color:#d7dbdf}.ps{padding:0 22px 17px 62px;font:12px/1.5 system-ui,sans-serif;color:#a5a5a9}
.x{border:1px solid rgba(255,255,255,.07);border-radius:9px;width:30px;height:30px;color:#c2c2c5}.x:hover{background:#303030}
.tabs{display:flex;gap:3px;padding:5px;margin:0 17px 8px;border:1px solid rgba(255,255,255,.045);border-radius:999px;background:#242424;flex:none}
.tabs button{border-radius:999px;padding:7px 5px;font-size:11.5px;color:#aaaab0;min-width:0;white-space:nowrap;transition:color .15s,background .15s}.tabs button:hover{background:#2c2c2c;color:#efeff0}.tabs button.on{background:#393939;color:#fafafa;box-shadow:0 1px 3px #0003}.ind{display:none}
.body{padding:0 20px 18px;scrollbar-color:#505050 transparent;scrollbar-gutter:stable}.p .row{padding:16px 0;gap:18px;min-width:0}.p .row.col{gap:0}.p .lbl{min-width:0;gap:4px}.p .lbl b{font-weight:500;color:#e9e9eb;font-size:13px}.p .lbl span{font-size:11.5px;color:#b2b2b6;line-height:1.5}
.p .rg{gap:10px;flex-shrink:0}.p .rg output{font:500 12px/1.4 system-ui,sans-serif;min-width:45px;color:#e0e0e4}.p input[type=range]{width:105px;height:3px}.p input[type=range]::-webkit-slider-thumb{width:13px;height:13px;background:#292929}
.field,.p input.tx,.p textarea{border:1px solid rgba(255,255,255,.095);background:#292929;border-radius:11px;color:#ececef;font:12px/1.5 system-ui,sans-serif;box-shadow:inset 0 1px 1px #0001}.field{padding:9px 10px}.field[type=time]{flex-shrink:0;min-width:118px;max-width:140px;color-scheme:dark}.field.hex{width:96px;font-family:ui-monospace,monospace}.custom-accent{flex-shrink:0}
.p input.tx::placeholder,.p textarea::placeholder{color:#96969d}.p input.tx[type=search]{padding:10px 12px;border-radius:999px}.p textarea{padding:10px 12px}.p select.field{padding:10px 11px;min-width:0}.p input[type=color]{background:#292929;border-radius:9px;border-color:#ffffff19}
.sw{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:32px;cursor:pointer}
.sw input{appearance:none;-webkit-appearance:none;position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1}
.sw i{position:relative;display:block;flex:none;width:42px;height:26px;border:0;border-radius:999px;background:#404043;box-shadow:inset 0 0 0 1px #ffffff14;pointer-events:none}
.sw i::after{top:3px;left:3px;width:20px;height:20px;border-radius:50%;box-shadow:0 1px 2px #0002;transform:translateX(0);transition:transform .18s ease}
.sw input:checked+i{background:var(--ac)}.sw input:checked+i::after{transform:translateX(16px);background:var(--toggle-thumb,#171717)}
.sw input:focus-visible+i{outline:2px solid var(--ac);outline-offset:3px}
.seg{border-radius:999px;background:#272727;border-color:#ffffff12;flex-shrink:0}.seg button{padding:6px 11px;color:#b6b6bc;font-size:11.5px}.seg button.on{background:#414141;color:#fff}.seg button+button{border-color:#ffffff0d}
.sws{gap:9px;flex-shrink:0}.sws button{width:19px;height:19px}.sws button.on{box-shadow:0 0 0 2px #1d1d1d,0 0 0 3px #e6e6e6}
.sleep-note{background:#272727;border:1px solid #ffffff05;padding:13px;border-radius:12px;color:#b9b9bd;font-size:11.5px;line-height:1.65}.hint{font-size:11.5px;line-height:1.6;color:#aaaab0}
.p .btn,.audio-play,.audio-pref{border:1px solid #ffffff17;background:#242424;border-radius:999px;font-size:11.5px;color:#e7e7eb;padding:7px 11px;transition:background .15s,border-color .15s}.p .btn:hover,.audio-play:hover,.audio-pref:hover{background:#333;border-color:#ffffff28}.audio-play.on,.audio-pref[aria-pressed=true]{border-color:color-mix(in srgb,var(--ac) 65%,#ffffff20);color:var(--ac);background:color-mix(in srgb,var(--ac) 8%,#242424)}
.library-tools{gap:9px;margin-top:17px}.library-tools select{border-radius:12px}#library-preference{margin-top:9px;border-radius:999px}.library-count{padding-top:12px;font-size:11px;color:#96969d}
.library-group{border:0;margin-top:19px}.library-group h3{padding:0 2px 3px;font-size:12px;font-weight:550;color:#cfcfd4}.audio-item{background:#262626;border:1px solid #ffffff05;border-radius:14px;padding:13px;margin-top:9px}.audio-head{gap:8px}.audio-head b{font-size:12px;font-weight:500;line-height:1.45;color:#eeeeef}.audio-actions{max-width:132px;gap:5px}.audio-play{min-width:48px}.audio-pref{font-size:10.5px;padding:6px 8px}.audio-meta{font-size:10px;line-height:1.6;color:#a2a2aa}.audio-text{font-size:11.5px;color:#b9b9bf;line-height:1.6;padding-top:8px}
.pf{padding:14px 18px 17px;background:transparent;border-top:1px solid #ffffff09;gap:4px;flex:none}.pf .go{background:#e8e8eb;color:#202022;border:1px solid #fff2;border-radius:999px;font-size:12px;font-weight:600;padding:11px 13px;white-space:nowrap}.pf .go:hover{background:#fff}.pf .ln{font-size:11px;padding:9px 7px;color:#b6b6bd;white-space:nowrap}.pf .ln:hover{color:white}
.p .stat b{font:500 29px/1.2 system-ui,sans-serif;letter-spacing:-.04em}.p .stat span{font-size:10.5px}.p .stats{padding:20px 0}.p .bar span{font-size:10px}.p .row>b{font-family:system-ui,sans-serif!important;font-size:26px!important}
.w{border:1px solid #ffffff1a;background:#242424;box-shadow:0 5px 20px #0004}.dial b{font-family:system-ui,sans-serif;font-size:12px}.lt,.lt b{font-family:system-ui,sans-serif;font-size:11.5px;font-style:normal}.pb{border-color:#ffffff1c}
.toast{border:2px solid transparent;border-radius:16px;background:linear-gradient(#232323,#232323) padding-box,linear-gradient(135deg,#e9bad8,#bfb6ea 30%,#a4dfe2 60%,#f0dfa8 84%,#e5b3d6) border-box;box-shadow:0 10px 32px #0005}.toast b{font:500 15px/1.4 system-ui,sans-serif}.toast span{font-size:11px;color:#b8b8bd}.tb button{border-radius:999px;font-size:11px;border-color:#ffffff1a}.tb .pri{background:#e8e8eb;color:#1d1d1f}.toast .tl{opacity:.45}
.ov.card .box{border:2px solid transparent;border-radius:20px;background:linear-gradient(#202020,#202020) padding-box,linear-gradient(135deg,#e9bad8,#bfb6ea 30%,#a4dfe2 60%,#f0dfa8 84%,#e5b3d6) border-box;box-shadow:0 12px 48px #0005}.ov.card .ttl{font:500 15px/1.4 system-ui,sans-serif}.ov.card .sub{font:12px/1.5 system-ui,sans-serif;color:#b7b7bf}.ov.card .btn{border-radius:999px;font-size:11px}.ov.card .ring .num{font-family:system-ui,sans-serif;font-size:21px}.ov.card.done .ring .num{font-size:12px}
@media(max-width:400px){.p{width:calc(100vw - 16px);right:8px;top:8px;bottom:8px}.p.page{width:calc(100vw - 16px)}.body{padding-left:16px;padding-right:14px}.tabs{margin-left:12px;margin-right:12px}.tabs button{font-size:10.5px;padding:7px 3px}.p .rg{gap:6px}.p input[type=range]{width:86px}.p .row{gap:11px}.pf{padding-left:14px;padding-right:14px}.pf .ln{font-size:10px;padding-left:5px;padding-right:5px}.field[type=time]{min-width:112px}.custom-accent{gap:6px}.field.hex{width:88px}.sws{gap:7px}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style>

<div class="wrap" id="wrap">
  <div class="w br" id="w" tabindex="0" role="button" aria-label="Eye break timer. Open settings">
    <div class="lab"><span class="lt" id="wl">Next break in <b id="wt">20:00</b></span><button class="pb" data-a="pause" id="wp" aria-label="Pause or resume"></button></div>
    <div class="dial"><svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19.5" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2.5"/><circle id="wr" cx="23" cy="23" r="19.5" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="122.5" style="transition:stroke-dashoffset 1s linear"/></svg><b id="wn">20</b></div>
  </div>

  <div class="toast" id="toast" role="status"><div><b id="tt"></b><span id="ts"></span></div><div class="tb"><button data-a="snooze">Snooze 5 min</button><button class="pri" data-a="now">Start now</button></div><i class="tl" id="tl"></i></div>

  <div class="ov" id="ov" aria-live="polite">
    <div class="scene" id="scene">
      <canvas id="rest-landscape" aria-label="Mist clearing over a mountain lake"></canvas>
      <div class="lid t"></div><div class="lid b"></div>
    </div>
    <div class="box">
      <div class="top"><div class="ring" id="ring"><div class="num" id="num">20</div></div><h1 class="ttl first" id="ttl"></h1><p class="sub first" id="sub"></p></div>
      <div class="bot"><p class="tip" id="tip"></p><div class="btns" id="btns"><button class="btn" data-a="snooze">Snooze 5 min</button><button class="btn" data-a="skip">Skip break</button></div></div>
      <div class="cbar" id="cbar"><i></i></div>
    </div>
  </div>

  <aside class="p" id="panel" aria-label="Blinkly settings">
    <div class="ph"><span class="logo"><canvas class="brand-icon" width="96" height="96" role="img" aria-label="Blinkly logo"></canvas></span><h2>Blinkly</h2><button class="x" data-a="close" aria-label="Close settings"><svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg></button></div>
    <p class="ps" id="ps"></p>
    <div class="tabs" id="tabs"><button data-t="rhythm" class="on">Rhythm</button><button data-t="comfort">Comfort</button><button data-t="smart">Smart</button><button data-t="sleep">Sleep</button><button data-t="voice">Voice</button><button data-t="today">Today</button><i class="ind" id="ind"></i></div>
    <div class="body">
      <section class="tab on" data-t="rhythm">
        ${row('Work interval', 'Screen time before a break', rng('workMin', 1, 60, 1, ' min'))}
        ${row('Break length', 'How long to look away', rng('breakSec', 10, 120, 5, ' s'))}
        ${row('Heads-up', 'Notice before the break begins', rng('warnSec', 0, 60, 5, ' s'))}
        ${row('Break style', '', seg('mode', [['overlay', 'Full screen'], ['card', 'Corner card']]))}
        ${row('Strict mode', 'Hide snooze and skip', tog('strict'))}
      </section>
      <section class="tab" data-t="comfort">
        ${row('Warm tint', 'Softens blue light on every page', rng('warm', 0, 40, 1, '%'))}
        ${row('Tint now', 'Apply immediately, overriding the night schedule', tog('warmNow'))}
        ${row('Tint only at night', '7 pm to 7 am; resumes when Tint now is off', tog('warmNight'))}
        ${row('Accent', '', `<div class="sws" data-k="accent">${ACCENTS.map(c => `<button data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`)}
        ${row('Custom accent', 'Choose a color or enter its hex code', `<div class="custom-accent"><input type="color" data-k="accent" aria-label="Custom accent color"><input class="field hex" type="text" data-k="accent" aria-label="Accent hex code" maxlength="7" spellcheck="false"></div>`)}
        ${row('Chime', '', tog('sound'))}
        ${row('Chime volume', '', rng('volume', 0, 1, 0.05, ''))}
        ${row('Desktop notification', 'When a break starts while you are in another window', tog('notify'))}<p class="hint" id="notification-status" role="status"></p>
      </section>
      <section class="tab" data-t="smart">
        ${row('Pause when away', 'Minutes without input. Coming back after this restarts the timer.', rng('idleMin', 1, 10, 1, ' min'))}
        ${row('Wait for video', 'Hold the break while a video plays or a page is fullscreen', tog('deferMedia'))}
        ${row('Show timer', '', tog('widget'))}
        <div class="row col"><div class="lbl"><b>Timer placement</b><span>Choose Custom, then drag the page icon. Your position is saved.</span></div><select class="field" data-k="corner" aria-label="Timer placement"><option value="tl">Top left</option><option value="tr">Top right</option><option value="bl">Bottom left</option><option value="br">Bottom right</option><option value="custom">Custom · drag on page</option></select></div>
        <div class="row col"><div class="lbl"><b>Disabled sites</b><span>One domain per line. Reload the page after changing.</span></div><textarea data-k="blocklist" placeholder="example.com" spellcheck="false"></textarea></div>
        <p class="hint">Alt+Shift+E settings, Alt+Shift+B break now, Alt+Shift+P pause.</p>
      </section>
      <section class="tab" data-t="sleep">
        ${row('Sleep schedule', 'Adapt late-night voices to your bedtime', tog('sleepEnabled'))}
        ${row('I usually sleep at', 'Your usual bedtime', '<input class="field" type="time" data-k="bedtime" aria-label="Usual bedtime">')}
        <div class="row col"><div class="lbl"><b>Timezone</b><span>Use your device timezone or keep the schedule on India time.</span></div><select class="field" data-k="sleepTimezone" aria-label="Sleep timezone"><option value="local">Device timezone</option><option value="Asia/Kolkata">India · Asia/Kolkata</option><option value="UTC">UTC</option></select></div>
        ${row('Wind down before bed', '', rng('sleepLeadMin', 30, 300, 15, ' min'))}
        <div class="row col"><div class="lbl"><b>Near-bedtime behavior</b><span>Choose whether your timer also changes.</span></div><select class="field" data-k="sleepMode" aria-label="Near-bedtime behavior"><option value="voices">Change voice only</option><option value="frequent">More frequent reminders</option></select></div>
        ${row('Near-bedtime interval', 'Used only in More frequent reminders mode', rng('sleepWorkMin', 1, 60, 1, ' min'))}
        <div class="row col"><div class="lbl"><b>Near-bedtime voice</b></div><select class="field" data-k="sleepLateStyle" aria-label="Near-bedtime voice"><option value="drunk">Drunken and playful</option><option value="sleepy">Sleepy and gentle</option></select></div>
        <p class="sleep-note" id="sleep-note"></p>
        ${row('Quiet hours', 'Pause automatic reminders; manual breaks and previews still work', tog('quietEnabled'))}
        ${row('Quiet from', '', '<input class="field" type="time" data-k="quietStart" aria-label="Quiet hours start">')}
        ${row('Until', 'Uses the selected timezone above. Matching times means all day.', '<input class="field" type="time" data-k="quietEnd" aria-label="Quiet hours end">')}
        <p class="hint" id="quiet-note"></p>
      </section>
      <section class="tab" data-t="voice">
        ${row('Spoken guidance', 'Guidance, with optional snooze and Rested responses', tog('voiceOn'))}
        <div class="row col"><div class="lbl"><b>Rest guidance</b><span>Spaced prompts keep the same pet name or use neutral wording.</span></div><select class="field" data-k="restGuidance" aria-label="Rest guidance"><option value="balanced">Balanced · two spaced lines</option><option value="quiet">Quiet · one opening line</option></select></div>
        ${row('Snooze response', 'A short response when you choose Snooze 5 min', tog('voiceSnooze'))}
        ${row('Rested response', 'A completion line while Rested is visible', tog('voiceDone'))}
        <div class="row col"><div class="lbl"><b>Speaking to</b><span>Choose how the same voice addresses you.</span></div><select class="field" data-k="recipientGender" aria-label="Speaking to"><option value="male">Male</option><option value="female">Female</option></select></div>
        ${row('Flirty lines', 'Prefer playful pet names; keep one name per rest', tog('flirty'))}
        <div class="row col"><div class="lbl"><b>Spoken eye facts</b><span>Replaces the opening guidance during selected rest sessions; adds no extra speech.</span></div><select class="field" id="facts-every" data-k="factsEvery" aria-label="Spoken fact frequency"><option value="0">Off</option><option value="1">Every rest session</option><option value="2">Every 2nd rest session</option><option value="3">Every 3rd rest session</option><option value="5">Every 5th rest session</option><option value="10">Every 10th rest session</option></select></div>
        ${row('Voice volume', '', rng('voiceVol', 0, 1, 0.05, ''))}
        <div class="row"><button class="btn" data-a="vtest">Test voice</button><button class="btn" data-a="vstop">Stop preview</button></div>
        <p class="hint">Automatic speech stays inside alerts and rest sessions. Sleep settings control late-night delivery. Every saved clip is available to preview below.</p>
        <p class="hint" id="vstat"></p>
        <div class="library-tools"><input class="tx" type="search" id="library-search" placeholder="Search titles, words or tags" aria-label="Search audio library"><select class="field" id="library-category" aria-label="Audio category"><option value="">All categories</option></select></div>
        <select class="field" id="library-preference" aria-label="Audio preferences filter"><option value="all">All recordings</option><option value="favorites">Favorites</option><option value="muted">Muted</option></select>
        <p class="library-count" id="library-count"></p><div id="audio-library" aria-label="Saved audio library"></div>
      </section>
      <section class="tab" data-t="today"><div id="stats"></div></section>
    </div>
    <div class="pf"><button class="go" data-a="now">Take a break now</button><button class="ln" data-a="restart">Restart timer</button><button class="ln" data-a="reset">Reset</button></div>
  </aside>
</div>`;

  const $ = s => root.querySelector(s);
  const wrap = $('#wrap'), W = $('#w'), panel = $('#panel'), ov = $('#ov'), toastEl = $('#toast');
  const els = { wt: $('#wt'), wl: $('#wl'), wn: $('#wn'), wr: $('#wr'), wp: $('#wp'), num: $('#num'), ttl: $('#ttl'), sub: $('#sub'), tip: $('#tip'), scene: $('#scene'), cbar: $('#cbar'), btns: $('#btns'), tt: $('#tt'), ts: $('#ts'), tl: $('#tl'), stats: $('#stats'), ps: $('#ps'), ind: $('#ind'), vstat: $('#vstat') };
  document.documentElement.appendChild(host);

  // The supplied landscape follows the actual break; it never owns the timer.
  let restScene;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let sceneFrame = 0, sceneLast = 0;
  function drawRestScene(time) {
    if (!restScene) return;
    const active = S.phase === 'break';
    const duration = Math.max(1, S.breakLen || cfg.breakSec);
    const elapsed = active ? Math.max(0, duration - (S.breakEnd - Date.now()) / 1000) : duration;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    restScene.draw({ progress, clock: reducedMotion.matches ? 0 : time / 1000,
      dt: sceneLast ? Math.min(.1, (time - sceneLast) / 1000) : 0, accent: cfg.accent });
    sceneLast = time;
    const phase = elapsed % 4;
    const blink = !reducedMotion.matches && active && elapsed > 1.2 && phase < .8 ? Math.sin(Math.PI * phase / .8) : 0;
    $('#scene .lid.t').style.transform = `translateY(${-100 + 36 * blink}%)`;
    $('#scene .lid.b').style.transform = `translateY(${100 - 36 * blink}%)`;
  }
  function animateRestScene(time) {
    sceneFrame = 0;
    if (!restScene || !ov.classList.contains('on') || cfg.mode === 'card' || document.visibilityState !== 'visible') { sceneLast = 0; return; }
    drawRestScene(time);
    if (!reducedMotion.matches) sceneFrame = requestAnimationFrame(animateRestScene);
  }
  function syncRestScene() {
    const show = globalThis.BlinklyScenes && ov.classList.contains('on') && cfg.mode !== 'card' && document.visibilityState === 'visible';
    if (!show) { cancelAnimationFrame(sceneFrame); sceneFrame = 0; sceneLast = 0; return; }
    if (!restScene) restScene = globalThis.BlinklyScenes.createRest($('#rest-landscape'));
    if (!sceneFrame) animateRestScene(performance.now());
  }
  addEventListener('pagehide', event => { cancelAnimationFrame(sceneFrame); sceneFrame = 0; if (!event.persisted) restScene?.destroy(); });

  const warmEl = document.createElement('div');
  warmEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;transition:background .8s;';
  document.documentElement.appendChild(warmEl);

  /* ───────────── copy ───────────── */
  const STEPS = [
    ['Look at something 20 feet away', 'Pick a distant point: a building, a tree, the sky.'],
    ['Let your eyes go soft', 'Rest on it. No need to strain for focus.'],
    ['Blink slowly', 'Close fully each time. It re-wets the surface of your eyes.'],
    ['Drop your shoulders', 'Unclench your jaw and breathe out.']
  ];
  const TIPS = [
    'You blink about 60% less while reading a screen.',
    'Keep the top of your screen at or just below eye level, about an arm’s length away.',
    'A dim screen in a bright room, or the reverse, makes your eyes work harder.',
    'Dry or gritty eyes? Blink fully rather than halfway.',
    'Looking out a window works as well as anything else 20 feet away.'
  ];
  let lastStep = -1, warned = false, toastTimer, tipKey = 0;

  /* ───────────── voice: local MP3 pack; no generation or API key at runtime ───────────── */
  const vstat = message => { if (els.vstat) els.vstat.textContent = message; };
  const dec = new Map();
  let vCur = null, vPending = null, vBusy = false, vEpoch = 0, vDelay, previewKey = null, previewRequest = null;
  let libraryClips = [], libraryPromise, blockedVoice = null;
  // Packaged voices play in the extension, independent of page autoplay/CSP.
  const extensionPlayback = !!(hasCR && chrome.runtime?.id);
  let playbackSequence = 0;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function packMessage(message) {
    if (!hasCR || !chrome.runtime?.id) throw new Error('Load the complete Blinkly extension folder to use its saved voice pack.');
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error || 'This audio file is missing. Check the bundled voice pack.');
    return reply;
  }
  async function loadBrandIcon() {
    const canvas = root.querySelector('canvas.brand-icon');
    if (!canvas) return;
    try {
      // Decode local bytes directly: page img-src policies cannot hide the brand.
      const { b64 } = await packMessage({ type: 'blinkly-brand-icon' });
      const bytes = Uint8Array.from(atob(b64), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      canvas.dataset.loaded = 'true';
    } catch (error) { console.warn('Blinkly logo could not load:', error.message); }
  }
  let packInfoPromise;
  function packInfo() {
    if (!packInfoPromise) packInfoPromise = packMessage({ type: 'blinkly-pack-status' }).catch(error => { packInfoPromise = null; throw error; });
    return packInfoPromise;
  }
  async function loadLibrary() {
    if (!libraryPromise) libraryPromise = packMessage({ type: 'blinkly-audio-library' }).then(pack => {
      libraryClips = pack.clips;
      const select = $('#library-category');
      select.innerHTML = '<option value="">All categories</option>' + [...new Set(libraryClips.map(clip => clip.category))].map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
      select.value = cfg.libraryCategory || ''; $('#library-search').value = cfg.librarySearch || ''; $('#library-preference').value = cfg.libraryPreference || 'all';
      renderLibrary(); return libraryClips;
    }).catch(error => { libraryPromise = null; vstat(error.message); return []; });
    return libraryPromise;
  }
  function renderLibrary() {
    const term = (cfg.librarySearch || '').toLowerCase();
    const favorites = new Set(cfg.favoriteClips), muted = new Set(cfg.mutedClips);
    const clips = libraryClips.filter(clip => (cfg.libraryPreference !== 'favorites' || favorites.has(clip.key)) && (cfg.libraryPreference !== 'muted' || muted.has(clip.key)) && (!cfg.libraryCategory || clip.category === cfg.libraryCategory) && (!term || [clip.title, clip.transcript, clip.context, clip.mood, clip.gender || '', ...clip.tags].join(' ').toLowerCase().includes(term)));
    $('#library-count').textContent = `${clips.length} of ${libraryClips.length} saved recordings`;
    const groups = new Map();
    for (const clip of clips) { if (!groups.has(clip.category)) groups.set(clip.category, []); groups.get(clip.category).push(clip); }
    $('#audio-library').innerHTML = [...groups].map(([category, entries]) => `<section class="library-group"><h3>${escapeHTML(category)}</h3>${entries.map(clip => `<article class="audio-item"><div class="audio-head"><div><b>${escapeHTML(clip.title)}</b><span class="audio-meta">${escapeHTML([clip.gender && clip.gender !== 'neutral' ? clip.gender === 'both' ? 'Male / Female' : clip.gender === 'female' ? 'For her' : 'For him' : '', clip.context, clip.mood, muted.has(clip.key) ? 'Muted for automatic playback' : clip.usage === 'manual-preview' ? 'Preview only' : 'Guidance / responses'].filter(Boolean).join(' · '))}</span></div><div class="audio-actions"><button class="audio-play${previewKey === clip.key ? ' on' : ''}" data-preview="${clip.key}" aria-label="${previewKey === clip.key ? 'Stop' : 'Play'} ${escapeHTML(clip.title)}">${previewKey === clip.key ? 'Stop' : 'Play'}</button><button class="audio-pref" data-favorite="${clip.key}" aria-pressed="${favorites.has(clip.key)}" aria-label="${favorites.has(clip.key) ? 'Unfavorite' : 'Favorite'} ${escapeHTML(clip.title)}">${favorites.has(clip.key) ? '★' : '☆'}</button><button class="audio-pref" data-mute="${clip.key}" aria-pressed="${muted.has(clip.key)}" aria-label="${muted.has(clip.key) ? 'Unmute' : 'Mute'} ${escapeHTML(clip.title)}">${muted.has(clip.key) ? 'Unmute' : 'Mute'}</button></div></div><p class="audio-text">${escapeHTML(clip.transcript)}</p><span class="audio-meta">${escapeHTML(clip.tags.join(' · '))}</span></article>`).join('')}</section>`).join('') || '<p class="library-empty">No recordings match this search.</p>';
  }
  async function previewClip(key) {
    if (previewKey === key) { stopVoice(); return; }
    stopVoice();
    const epoch = vEpoch; previewRequest = epoch;
    const clips = await loadLibrary(), clip = clips.find(item => item.key === key);
    if (epoch !== vEpoch) return;
    if (!clip) { previewRequest = null; return; }
    const context = extensionPlayback || await playbackContext();
    if (epoch !== vEpoch) return;
    previewRequest = null;
    if (!context) { vstat('Click Test voice or Play to enable sound on this page.'); return; }
    previewKey = key; renderLibrary();
    const text = Voice.allTexts(20).find(line => Voice.key(line) === key);
    if (text) say(text, true);
  }
  async function voiceStatus() {
    try {
      const pack = await packInfo();
      vstat(`${pack.count} recordings ready. Choose quiet or balanced guidance and optional responses.`);
    } catch (error) { vstat(error.message); }
  }
  let lastTestText = '';
  async function voiceTest() {
    stopVoice();
    const epoch = vEpoch; previewRequest = epoch;
    const context = extensionPlayback || await playbackContext();
    if (epoch !== vEpoch) return;
    previewRequest = null;
    if (!context) { vstat('Click Test voice to enable sound on this page.'); return; }
    const options = { flirty: cfg.flirty, recipientGender: cfg.recipientGender, periodOverride: Sleep.period(cfg) };
    let lines = Voice.pool('test', options);
    const named = cfg.flirty ? lines.filter(text => Voice.petName(text)) : [];
    if (named.length) lines = named;
    const fresh = lines.filter(text => text !== lastTestText);
    const choices = fresh.length ? fresh : lines;
    lastTestText = choices[Math.floor(Math.random() * choices.length)];
    previewKey = Voice.key(lastTestText); renderLibrary();
    say(lastTestText, true);
  }
  const voiceSessionVisible = () => !PAGE && document.visibilityState === 'visible' && (!Prefs.quietNow(cfg) || S.phase === 'break' && S.manualBreak) && (S.phase === 'break' ? ov.classList.contains('on') : toastEl.classList.contains('on') && !toastEl.classList.contains('plain'));
  const restedVisible = () => S.res === 'done' && Date.now() < (S.resUntil || S.resAt + 3400);
  function voiceAllowed(context) {
    if (!cfg.voiceOn || PAGE || document.visibilityState !== 'visible') return false;
    if (context?.event === 'snooze') return cfg.voiceSnooze && S.phase === 'work' && toastEl.classList.contains('on')
      && S.voiceEvent?.id === context.actionId && Date.now() - S.voiceEvent.at < 11000;
    if (context?.event === 'done') return cfg.voiceDone && restedVisible() && ov.classList.contains('on')
      && S.voiceEvent?.id === context.actionId && (!Prefs.quietNow(cfg) || S.manualBreak);
    return voiceSessionVisible();
  }
  function playBuf(buf, epoch, force = false, context = null) {
    return new Promise(resolve => {
      if (epoch !== vEpoch) return resolve();
      const c = audio.peek();
      if (!c || c.state !== 'running') {
        vstat('Click this page or Test voice once to allow audio playback.');
        return resolve();
      }
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; g.gain.value = cfg.voiceVol;
      src.connect(g).connect(c.destination);
      let timer;
      const end = () => {
        clearTimeout(timer);
        if (vCur?.src === src) {
          vCur = null; previewKey = null; renderLibrary();
          if (context?.event === 'done' && S.voiceEvent?.id === context.actionId) {
            S.resUntil = Date.now() + 250; save(); render();
          }
          if (context?.event === 'snooze' && S.voiceEvent?.id === context.actionId) hideToast();
        }
        src.disconnect(); g.disconnect(); resolve();
      };
      src.onended = end;
      timer = setTimeout(end, buf.duration * 1000 + 1500);
      if (context?.event === 'done') {
        S.resUntil = Date.now() + Math.min(10000, buf.duration * 1000 + 350); save(); render();
      }
      vCur = { src, g, force, context }; src.start();
    });
  }
  async function pump() {
    vBusy = true;
    try {
      while (vPending) {
        const { text, epoch, force, context } = vPending; vPending = null;
        try {
          if (!force && (!voiceAllowed(context) || !(await packMessage({ type: 'blinkly-can-speak' })).allowed)) continue;
          if (epoch !== vEpoch) continue;
          if (extensionPlayback) {
            await playPackagedVoice(text, epoch, force, context);
            continue;
          }
          const c = await playbackContext();
          if (epoch !== vEpoch) continue;
          if (!c) {
            if (previewKey) { previewKey = null; renderLibrary(); }
            vstat('Click this page or Test voice once to enable sound.');
            continue;
          }
          const key = Voice.key(text);
          let buf = dec.get(key);
          if (!buf) {
            const { b64 } = await packMessage({ type: 'blinkly-audio', key });
            if (epoch !== vEpoch) continue;
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            buf = await c.decodeAudioData(bytes.buffer);
            if (epoch !== vEpoch) continue;
            dec.set(key, buf);
            if (dec.size > 16) dec.delete(dec.keys().next().value);
          }
          if (!force && (!voiceAllowed(context) || !(await packMessage({ type: 'blinkly-can-speak' })).allowed)) continue;
          await playBuf(buf, epoch, force, context);
        } catch (error) { vstat(error.message); }
      }
    } finally { vBusy = false; }
  }
  async function playPackagedVoice(text, epoch, force, context) {
    if (epoch !== vEpoch) return;
    const token = `${ME}:${epoch}:${++playbackSequence}`;
    vCur = { remote: true, token, force, context };
    vstat('Playing a saved recording…');
    if (context?.event === 'done') { S.resUntil = Date.now() + 10000; save(); render(); }
    try {
      const result = await packMessage({ type: 'blinkly-audio-play', key: Voice.key(text), token,
        volume: cfg.voiceVol, preview: force,
        event: context?.event || (S.phase === 'break' ? 'step' : 'warn'),
        sessionId: String(S.breakEnd), actionId: context?.actionId });
      if (result.error) throw new Error(result.error);
      if (result.started) vstat('Voice ready.');
    } catch (error) { vstat(`Voice playback: ${error.message}`); }
    finally {
      if (vCur?.token === token) {
        vCur = null; previewKey = null; renderLibrary();
        if (context?.event === 'done' && S.voiceEvent?.id === context.actionId) {
          S.resUntil = Date.now() + 250; save(); render();
        }
        if (context?.event === 'snooze' && S.voiceEvent?.id === context.actionId) hideToast();
      }
    }
  }
  function say(text, force = false, context = null) {
    // Only the foreground page speaks; other visible windows still render the break.
    if (!force && !voiceAllowed(context)) return;
    if (!text) return;
    vPending = { text, epoch: vEpoch, force, context };
    if (!vBusy) void pump();
  }
  function stopVoice() {
    ++vEpoch; vPending = null; blockedVoice = null; previewRequest = null; clearTimeout(vDelay);
    if (previewKey) { previewKey = null; renderLibrary(); }
    if (!vCur) return;
    const previous = vCur; vCur = null;
    if (previous.remote) {
      void packMessage({ type: 'blinkly-audio-stop', token: previous.token }).catch(() => {});
      return;
    }
    try {
      const t = audio.peek().currentTime;
      previous.g.gain.setValueAtTime(previous.g.gain.value, t);
      previous.g.gain.linearRampToValueAtTime(0, t + 0.08);
      previous.src.stop(t + 0.1);
    } catch {}
  }
  async function voiceEvent(event, step = 0, action = null) {
    if (!['warn', 'step', 'snooze', 'done'].includes(event)) return;
    if (event === 'step' && !Cadence.restStepAllowed(S.breakLen || cfg.breakSec, step, cfg.restGuidance)) return;
    // Never queue the second prompt behind a long first recording.
    if (event === 'step' && step === 2 && (vCur || vPending)) return;
    const reaction = event === 'snooze' || event === 'done';
    const context = reaction ? { event, actionId: action?.id || S.voiceEvent?.id } : null;
    if (reaction && !context.actionId || !voiceAllowed(context)) return;
    const epoch = vEpoch;
    const sessionId = String(S.breakEnd);
    if (!extensionPlayback && !(await playbackContext())) {
      // Do not consume a rotation entry until this page can actually play it.
      if (epoch === vEpoch && voiceAllowed(context) && !(event === 'step' && step === 2 && blockedVoice?.event === 'step' && blockedVoice.sessionId === sessionId))
        blockedVoice = { event, step, action, epoch, sessionId, context };
      vstat('Click this page or Test voice once to enable sound.');
      return;
    }
    if (epoch !== vEpoch || !voiceAllowed(context)) return;
    const periodOverride = Sleep.period(cfg), voiceOptions = { workMin: Sleep.effectiveWorkMin(cfg), breakSec: S.breakLen || cfg.breakSec, snoozeCount: S.snoozeCount, step, flirty: cfg.flirty, recipientGender: cfg.recipientGender, periodOverride };
    const guidance = event === 'step' && step === 2
      ? [...new Set([1, 2, 3].flatMap(index => Voice.pool('step', { ...voiceOptions, step: index })))]
      : event === 'done' ? Voice.completionPool(voiceOptions) : Voice.pool(event, voiceOptions);
    let pool = Prefs.eligible(guidance, cfg, Voice.key);
    const factPool = cfg.factsEvery ? Prefs.eligible(Voice.pool('fact', voiceOptions), cfg, Voice.key) : [];
    try {
      const pack = await packInfo();
      if (epoch !== vEpoch) return;
      const available = new Set(pack.availableKeys);
      pool = pool.filter(text => available.has(Voice.key(text)));
    } catch (error) { vstat(error.message); return; }
    if ((!pool.length && event !== 'step') || !voiceAllowed(context)) {
      if (event === 'done') { S.resUntil = S.resAt + 3400; save(); render(); }
      return;
    }
    try {
      const selection = await packMessage({
        type: 'blinkly-select-clip', group: `${periodOverride}:${event}:${step}`,
        keys: pool.map(Voice.key), preferPetNames: cfg.flirty, factsEvery: cfg.factsEvery, duration: S.breakLen || cfg.breakSec, restGuidance: cfg.restGuidance,
        ...(event === 'step' ? { sessionId: String(S.breakEnd) } : {}),
        ...(reaction ? { actionId: context.actionId, ...((action || S.voiceEvent)?.sessionId ? { sessionId: (action || S.voiceEvent).sessionId } : {}) } : {}),
        ...(event === 'step' && step === 0 ? { factKeys: factPool.map(Voice.key) } : {})
      });
      if (epoch !== vEpoch) return;
      if (!selection.key) return;
      const text = [...pool, ...factPool].find(line => Voice.key(line) === selection.key);
      if (text) say(text, false, context);
    } catch (error) { vstat(error.message); }
  }
  const voiceWarn = () => announceVoice('warn');
  function voiceStep(i, first) {
    if (!Cadence.restStepAllowed(S.breakLen || cfg.breakSec, i, cfg.restGuidance)) return;
    const end = S.breakEnd, epoch = vEpoch;
    const go = () => { if (epoch === vEpoch && S.phase === 'break' && S.breakEnd === end) voiceEvent('step', i); };
    first ? (vDelay = setTimeout(go, 900)) : go();
  }
  let lastExternalVoiceEvent = S.voiceEvent?.id;
  function externalVoiceEvent() {
    const event = S.voiceEvent;
    if (!event || event.id === lastExternalVoiceEvent) return;
    lastExternalVoiceEvent = event.id;
    if (Date.now() - event.at > 5000) return;
    stopVoice();
    if (event.type === 'warn' && S.phase === 'work') {
      showToast(`Break in ${cfg.warnSec} seconds`, 'Pick something far away to look at.');
      void voiceEvent('warn');
    }
    if (event.type === 'snooze' && S.phase === 'work' && cfg.voiceSnooze) {
      showToast('Snoozed for 5 minutes', 'Your next eye break will wait.', true, 11000);
      void voiceEvent('snooze', 0, event);
    }
    if (event.type === 'done' && restedVisible()) { render(); void voiceEvent('done', 0, event); }
  }
  function announceVoice(type, id = `${type}:${Date.now()}:${ME}`) {
    S.voiceEvent = { id, type, at: Date.now() };
    lastExternalVoiceEvent = id;
    void voiceEvent(type);
  }

  /* ───────────── actions ───────────── */
  function startBreak(source = 'manual', gesture = null) {
    // Dismiss settings even when a break is already running behind the panel.
    togglePanel(false);
    if (gesture?.isTrusted) void enableAudio(gesture);
    if (S.phase === 'break') return;
    stopVoice();
    if (Store.coordinated) { hideToast(); return sharedCommand('start', { manual: source !== 'automatic' }); }
    S.manualBreak = source !== 'automatic';
    S.phase = 'break'; S.breakLen = cfg.breakSec; S.breakEnd = Date.now() + cfg.breakSec * 1000; S.res = '';
    save(); chime('start'); hideToast();
    if (cfg.notify && !document.hasFocus())
      void packMessage({ type: 'blinkly-break-notification', sessionId: String(S.breakEnd) }).catch(error => {
        const note = $('#notification-status'); if (note) note.textContent = error.message;
      });
    render();
  }
  function endBreak(kind) {
    if (S.phase !== 'break') return;
    if (Store.coordinated) {
      stopVoice(); hideToast();
      return sharedCommand(kind === 'skip' ? 'skip' : 'finish', { sessionId: String(S.breakEnd) });
    }
    const d = day(), stale = Date.now() - S.breakEnd > 60000;
    stopVoice(); hideToast();
    S.phase = 'work'; S.elapsed = 0; S.snoozeCount = 0; S.mediaNotified = false; warned = false;
    if (kind === 'done' && !stale) {
      d.d++; S.res = 'done'; S.resAt = Date.now();
      S.resUntil = S.resAt + (cfg.voiceOn && cfg.voiceDone ? 9000 : 3400);
      S.voiceEvent = { id: `done:${S.breakEnd}`, type: 'done', at: S.resAt, sessionId: String(S.breakEnd) };
      if (!cfg.voiceOn || !cfg.voiceDone) chime('end');
    }
    else if (kind === 'skip') { d.s++; S.res = 'skip'; S.resAt = Date.now(); }
    save(); render(); externalVoiceEvent();
  }
  const snooze = () => {
    if (cfg.strict) return;
    if (Store.coordinated) { stopVoice(); hideToast(); return sharedCommand('snooze'); }
    const sessionId = S.phase === 'break' ? String(S.breakEnd) : null;
    stopVoice(); if (S.phase === 'break') { S.phase = 'work'; day().s++; }
    S.snoozeCount = (S.snoozeCount || 0) + 1; S.elapsed = Math.max(0, limit() - 300); S.res = ''; warned = false;
    hideToast();
    S.voiceEvent = { id: `snooze:${Date.now()}:${ME}`, type: 'snooze', at: Date.now(), ...(sessionId ? { sessionId } : {}) };
    save(); render(); externalVoiceEvent();
  };
  const togglePause = () => { stopVoice(); if (Store.coordinated) return sharedCommand('pause'); S.paused = !S.paused; save(); render(); };
  const restart = () => { stopVoice(); if (Store.coordinated) { hideToast(); return sharedCommand('restart'); } S.phase = 'work'; S.elapsed = 0; S.snoozeCount = 0; S.mediaNotified = false; S.res = ''; warned = false; hideToast(); save(); render(); };
  const togglePanel = open => { if (PAGE) return; panel.classList.toggle('on', open); if (!open && (previewKey || previewRequest !== null)) stopVoice(); if (open) { renderStats(); requestAnimationFrame(moveInd); voiceStatus(); } };

  function showToast(title, sub, plain, duration) {
    els.tt.textContent = title; els.ts.textContent = sub || '';
    toastEl.classList.toggle('plain', !!plain); toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, duration || (plain ? 3500 : 12000));
  }
  function hideToast() {
    const wasVisible = toastEl.classList.contains('on');
    toastEl.classList.remove('on');
    if (wasVisible && S.phase !== 'break' && !previewKey && !vCur?.force && !vPending?.force) stopVoice();
  }

  /* ───────────── ticking ───────────── */
  const mediaPlaying = () => {
    if (document.fullscreenElement) return true;
    for (const v of document.querySelectorAll('video')) {
      if (!v.paused && !v.ended && v.readyState > 2 && v.videoWidth) {
        const r = v.getBoundingClientRect(); if (r.width > 280 && r.height > 150) return true;
      }
    }
    return false;
  };
  const isIdle = () => Date.now() - S.lastAct > cfg.idleMin * 60000;
  let sharedTickPending = false, lastInputSent = 0;

  function tick() {
    const now = Date.now();
    if (panel.classList.contains('on')) renderSleepInfo();
    if (Store.coordinated) {
      if (Prefs.quietNow(cfg) && !(S.manualBreak && (S.phase === 'break' || restedVisible()))) hideToast();
      if (!sharedTickPending) {
        sharedTickPending = true;
        void sharedCommand('tick', { mediaPlaying: cfg.deferMedia && mediaPlaying() })
          .finally(() => { sharedTickPending = false; render(); });
      }
      render(); return;
    }
    if (Prefs.quietNow(cfg) && !(S.phase === 'break' && S.manualBreak)) {
      if (S.phase === 'break') { stopVoice(); S.phase = 'work'; S.breakEnd = 0; S.res = ''; save(); }
      hideToast(); render(); return;
    }
    if (S.phase === 'break') {
      if (now >= S.breakEnd) endBreak('done'); else render();
      return;
    }
    if (!S.paused && document.visibilityState === 'visible' && !isIdle()) {
      if (S.owner === ME || now - S.lastTick > 1500) {
        S.owner = ME; S.lastTick = now; S.elapsed++; day().a++;
        const left = limit() - S.elapsed;
        if (left > cfg.warnSec) warned = false;
        else if (cfg.warnSec && left > 0 && !warned) { warned = true; showToast(`Break in ${cfg.warnSec} seconds`, 'Pick something far away to look at.'); voiceWarn(); }
        if (left <= 0) {
          if (cfg.deferMedia && mediaPlaying() && S.elapsed < limit() + 900) {
            S.mediaNotified = true;
          } else startBreak('automatic');
        }
        save();
      }
    }
    render();
  }

  function onInput() {
    const now = Date.now();
    if (Store.coordinated) {
      if (now - lastInputSent > 5000) {
        lastInputSent = now;
        void sharedCommand('activity').then(reply => {
          if (reply?.resetAfterIdle) showToast('Welcome back', 'Your timer was restarted.', true);
        });
      }
      return;
    }
    if (now - S.lastAct > 5000) {
      if (now - S.lastAct > cfg.idleMin * 60000 && S.phase === 'work' && !S.paused && S.elapsed > 0) {
        S.elapsed = 0; S.snoozeCount = 0; S.mediaNotified = false; warned = false; showToast('Welcome back', 'Your timer was restarted.', true);
      }
      S.lastAct = now; save();
    }
  }
  if (!PAGE) ['mousemove', 'keydown', 'scroll', 'pointerdown', 'touchstart', 'wheel'].forEach(e => addEventListener(e, onInput, { passive: true, capture: true }));

  /* ───────────── render ───────────── */
  const C_W = 122.5, ICO_PAUSE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1" width="2.4" height="8" rx=".8"/><rect x="6.1" y="1" width="2.4" height="8" rx=".8"/></svg>', ICO_PLAY = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2.5 1.2v7.6L8.8 5z"/></svg>';
  function render() {
    const now = Date.now(), lim = limit();
    const breaking = S.phase === 'break' && !PAGE;
    const idle = !breaking && isIdle();
    const left = Math.max(0, lim - S.elapsed);
    const warn = !breaking && !S.paused && left <= cfg.warnSec && left > 0 && cfg.warnSec > 0;

    W.classList.toggle('warn', warn); W.classList.toggle('paused', S.paused); W.classList.toggle('idle', idle);
    W.style.display = cfg.widget && !PAGE ? '' : 'none';
    els.wn.textContent = breaking ? Math.ceil(Math.max(0, S.breakEnd - now) / 1000) : S.paused ? 'II' : left >= 60 ? Math.ceil(left / 60) : left;
    els.wr.style.strokeDashoffset = breaking ? 0 : C_W * Math.min(1, S.elapsed / lim);
    els.wp.innerHTML = S.paused ? ICO_PLAY : ICO_PAUSE;
    const status = breaking ? 'Break in progress' : Prefs.quietNow(cfg) ? 'Quiet hours' : S.paused ? 'Paused' : idle ? 'Away, timer waiting' : left <= 0 ? 'Break soon' : null;
    els.wl.innerHTML = status ? status : `Next break in <b>${fmt(left)}</b>`;
    els.ps.textContent = status || `Next break in ${fmt(left)}`;
    if (toastEl.classList.contains('on') && warn) els.tl.style.setProperty('--tp', (left / cfg.warnSec).toFixed(3));

    const celebrating = !breaking && !PAGE && restedVisible();
    ov.classList.toggle('on', breaking || celebrating);
    ov.classList.toggle('done', celebrating);
    if (breaking) {
      if (tipKey !== S.breakEnd) { tipKey = S.breakEnd; els.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; lastStep = -1; }
      const total = S.breakLen * 1000, remain = Math.max(0, S.breakEnd - now), p = Math.min(1, 1 - remain / total);
      els.num.textContent = Math.ceil(remain / 1000);
      els.scene.style.setProperty('--p', p.toFixed(3)); els.cbar.style.setProperty('--p', p.toFixed(3));
      const i = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
      ov.classList.toggle('blink', i === 2);
      if (i !== lastStep) {
        const first = lastStep === -1; lastStep = i;
        voiceStep(first ? 0 : i, first); els.ttl.textContent = STEPS[i][0]; els.sub.textContent = STEPS[i][1];
        [els.ttl, els.sub].forEach(e => { e.classList.toggle('first', first); e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; });
      }
      els.btns.style.display = cfg.strict ? 'none' : '';
    } else if (celebrating) {
      ov.classList.remove('blink');
      els.num.textContent = 'Rested'; els.ttl.textContent = 'Your eyes thank you.';
      els.sub.textContent = `Next break in ${Sleep.effectiveWorkMin(cfg)} minutes.`; els.scene.style.setProperty('--p', 1);
      els.btns.style.display = 'none';
    }
    syncRestScene();
  }

  function renderSleepInfo() {
    const note = $('#sleep-note'); if (!note) return;
    const quietNote = $('#quiet-note');
    if (quietNote) quietNote.textContent = cfg.quietEnabled ? `Automatic reminders pause ${cfg.quietStart}–${cfg.quietEnd}. ${Prefs.quietNow(cfg) ? 'Quiet hours are active now.' : 'Outside quiet hours now.'}` : 'Quiet hours are off.';
    const plan = Sleep.info(cfg), interval = Sleep.effectiveWorkMin(cfg);
    note.textContent = !cfg.sleepEnabled ? 'Sleep schedule is off. Your normal timer and voices are used.' : `Bedtime ${plan.bedtime} · ${plan.zone}. Wind-down: ${plan.windDownStart} until ${Sleep.formatTime(plan.bedtimeMinutes + 120)}. ${cfg.sleepMode === 'voices' ? `Your ${cfg.workMin}-minute timer stays unchanged.` : `During wind-down, reminders use the shorter of ${cfg.workMin} and ${cfg.sleepWorkMin} minutes.`} Current interval: ${interval} minutes.`;
  }
  function restoreSettingsTab() {
    const selected = ['rhythm','comfort','smart','sleep','voice','today'].includes(cfg.settingsTab) ? cfg.settingsTab : 'rhythm';
    root.querySelectorAll('#tabs button,.tab').forEach(item => item.classList.toggle('on', item.dataset.t === selected));
    requestAnimationFrame(moveInd);
  }
  function selectSettingsTab(tab) {
    if (tab !== 'voice' && (previewKey || previewRequest !== null)) stopVoice();
    cfg.settingsTab = tab; Store.set('cfg', cfg); restoreSettingsTab();
    if (tab === 'today') renderStats();
    if (tab === 'voice') { voiceStatus(); loadLibrary(); }
  }
  $('#library-search').addEventListener('input', event => { cfg.librarySearch = event.target.value; Store.set('cfg', cfg); renderLibrary(); });
  $('#library-preference').addEventListener('change', event => { cfg.libraryPreference = event.target.value; Store.set('cfg', cfg); renderLibrary(); });
  $('#library-category').addEventListener('change', event => { cfg.libraryCategory = event.target.value; Store.set('cfg', cfg); renderLibrary(); });

  /* ───────────── settings binding ───────────── */
  function paintRange(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
  function outLabel(k) {
    const o = root.querySelector(`[data-o="${k}"]`); if (!o) return;
    const v = cfg[k];
    o.textContent = k === 'warnSec' && v == 0 ? 'Off' : (k === 'volume' || k === 'voiceVol') ? Math.round(v * 100) + '%' : v + o.dataset.u;
  }
  function syncControls() {
    root.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k, v = cfg[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'range') { el.value = v; paintRange(el); outLabel(k); }
      else if (el.classList.contains('seg') || el.classList.contains('sws')) el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v == v));
      else if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || ['text', 'password', 'color', 'time'].includes(el.type)) el.value = v ?? '';
    });
  }
  function accentThumb(accent) {
    const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent.slice(1) : 'ef5b78';
    const linear = value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
    const luminance = [0, 2, 4].map(i => linear(parseInt(hex.slice(i, i + 2), 16)))
      .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const dark = linear(23);
    return (luminance + .05) / (dark + .05) > 1.05 / (luminance + .05) ? '#171717' : '#ffffff';
  }
  function applyCfg() {
    wrap.style.setProperty('--ac', cfg.accent);
    wrap.style.setProperty('--toggle-thumb', accentThumb(cfg.accent));
    W.classList.remove('tl', 'tr', 'bl', 'br', 'custom', 'label-right');
    W.classList.add(cfg.corner);
    positionWidget();
    ov.classList.toggle('card', cfg.mode === 'card');
    applyWarm(); renderSleepInfo();
  }
  function positionWidget() {
    if (cfg.corner !== 'custom') {
      for (const property of ['left', 'top', 'right', 'bottom', '--label-space']) W.style.removeProperty(property);
      W.title = 'Open Blinkly settings';
      W.setAttribute('aria-label', 'Eye break timer. Open settings');
      return;
    }
    // Anchor the small dial, so its label can expand without moving the icon.
    const dial = W.querySelector('.dial'), width = dial.offsetWidth || 46, height = dial.offsetHeight || 46;
    const point = Placement.coordinates(cfg.widgetPosition, width, height, innerWidth, innerHeight);
    const labelRight = point.x < (innerWidth - width) / 2;
    W.classList.toggle('label-right', labelRight);
    W.style.top = `${point.y}px`; W.style.bottom = 'auto';
    W.style.left = labelRight ? `${point.x}px` : 'auto';
    W.style.right = labelRight ? 'auto' : `${Math.max(0, innerWidth - point.x - width)}px`;
    W.style.setProperty('--label-space', `${Math.max(0, labelRight ? innerWidth - point.x - width - 8 : point.x - 8)}px`);
    W.title = 'Drag to move · Arrow keys to adjust · Enter for settings';
    W.setAttribute('aria-label', 'Eye break timer. Drag or use arrow keys to move. Enter opens settings.');
  }
  function applyWarm() {
    const h = new Date().getHours(), night = h >= 19 || h < 7;
    const a = cfg.warm && (cfg.warmNow || cfg.warmNight && night) ? cfg.warm / 100 * 0.75 : 0;
    warmEl.style.background = a ? `rgba(255,140,40,${a.toFixed(3)})` : 'transparent';
  }
  function setCfg(k, v) {
    if (k === 'accent') { if (!/^#[0-9a-f]{6}$/i.test(v)) return; v = v.toLowerCase(); }
    if (k === 'factsEvery') v = Number(v);
    const extra = {};
    if (['warmNow', 'warmNight'].includes(k) && v && !cfg.warm) extra.warm = 15;
    if (k === 'warm' && !v) extra.warmNow = false;
    if (k === 'corner' && v === 'custom' && !cfg.widgetPosition) {
      const dial = W.querySelector('.dial').getBoundingClientRect();
      extra.widgetPosition = Placement.clampPointerToPosition(dial.left, dial.top, 0, 0, dial.width || 46, dial.height || 46, innerWidth, innerHeight);
    }
    cfg = readConfig({ ...cfg, ...extra, [k]: v }); Store.set('cfg', cfg); applyCfg(); outLabel(k); render();
    if (['warmNow', 'warm'].includes(k)) syncControls();
    if (['voiceOn','voiceSnooze','voiceDone'].includes(k) && !v || ['recipientGender', 'flirty'].includes(k)) stopVoice();
    if (k === 'voiceVol' && vCur?.g) vCur.g.gain.value = v;
    if (k === 'workMin') voiceStatus();
    if (['favoriteClips','mutedClips'].includes(k)) renderLibrary();
    if (k === 'accent') root.querySelectorAll('[data-k="accent"]').forEach(el => { if (el.tagName === 'INPUT') el.value = cfg.accent; });
    if (k === 'notify') {
      const note = $('#notification-status'); note.textContent = '';
      if (v) void packMessage({ type: 'blinkly-notification-status' }).then(reply => {
        if (cfg.notify) note.textContent = reply.permission === 'granted' ? 'Desktop notifications enabled.'
          : 'Notifications are blocked for Blinkly. Allow them in your browser or system settings.';
      }).catch(error => { note.textContent = error.message; });
    }
  }
  function moveInd() {
    const b = root.querySelector('#tabs button.on'); if (!b) return;
    els.ind.style.left = b.offsetLeft + 'px'; els.ind.style.width = b.offsetWidth + 'px';
  }

  panel.addEventListener('input', e => {
    const t = e.target, k = t.dataset.k; if (!k) return;
    if (t.type === 'range') { paintRange(t); setCfg(k, +t.value); }
    else if (t.type === 'checkbox') setCfg(k, t.checked);
    else if (t.type === 'color') setCfg(k, t.value);
  });
  panel.addEventListener('change', e => { const t = e.target; if (t.dataset.k && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || ['text','password','time'].includes(t.type))) setCfg(t.dataset.k, t.value.trim()); });
  panel.addEventListener('keydown', e => e.stopPropagation());
  let widgetDrag = null, suppressWidgetClickUntil = 0;
  function finishWidgetDrag(savePosition) {
    if (!widgetDrag) return;
    const drag = widgetDrag; widgetDrag = null; W.classList.remove('dragging');
    if (drag.moved) {
      suppressWidgetClickUntil = performance.now() + 500;
      if (savePosition) Store.set('cfg', cfg);
      else { cfg.widgetPosition = drag.original; positionWidget(); }
    }
    if (W.hasPointerCapture(drag.id)) W.releasePointerCapture(drag.id);
  }
  W.addEventListener('pointerdown', event => {
    if (PAGE || cfg.corner !== 'custom' || event.button !== 0 || event.isPrimary === false || !event.target.closest('.dial')) return;
    const rect = W.querySelector('.dial').getBoundingClientRect();
    widgetDrag = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      width: rect.width, height: rect.height, moved: false, original: cfg.widgetPosition };
    W.setPointerCapture(event.pointerId);
  });
  W.addEventListener('pointermove', event => {
    const drag = widgetDrag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true; event.preventDefault(); W.classList.add('dragging');
    cfg.widgetPosition = Placement.clampPointerToPosition(event.clientX, event.clientY, drag.grabX, drag.grabY,
      drag.width, drag.height, innerWidth, innerHeight);
    positionWidget();
  });
  W.addEventListener('pointerup', event => { if (widgetDrag?.id === event.pointerId) finishWidgetDrag(true); });
  W.addEventListener('pointercancel', () => finishWidgetDrag(false));
  W.addEventListener('lostpointercapture', () => finishWidgetDrag(false));
  addEventListener('resize', positionWidget);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') finishWidgetDrag(false); });
  root.addEventListener('click', e => {
    if (e.target.closest('#w') && performance.now() < suppressWidgetClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const sg = e.target.closest('.seg button, .sws button');
    if (sg) { setCfg(sg.parentElement.dataset.k, sg.dataset.v); syncControls(); return; }
    const tab = e.target.closest('#tabs button');
    if (tab) { selectSettingsTab(tab.dataset.t); return; }
    const favorite = e.target.closest('[data-favorite]'), mute = e.target.closest('[data-mute]');
    if (favorite || mute) {
      const field = favorite ? 'favoriteClips' : 'mutedClips', key = favorite ? favorite.dataset.favorite : mute.dataset.mute;
      const keys = new Set(cfg[field]); keys.has(key) ? keys.delete(key) : keys.add(key); setCfg(field, [...keys]); return;
    }
    const preview = e.target.closest('[data-preview]');
    if (preview) { void previewClip(preview.dataset.preview); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) {
      ({ close: () => togglePanel(false), now: () => startBreak('manual', e), skip: () => endBreak('skip'), snooze, pause: togglePause, restart, vtest: voiceTest, vstatus: voiceStatus, vstop: stopVoice,
         reset: () => { cfg = readConfig({}); Store.set('cfg', cfg); applyCfg(); syncControls(); render(); } })[a]?.();
      e.stopPropagation(); return;
    }
    if (e.target.closest('#w')) togglePanel(!panel.classList.contains('on'));
  });
  W.addEventListener('keydown', e => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (cfg.corner === 'custom' && directions[e.key] && e.target === W) {
      e.preventDefault();
      const dial = W.querySelector('.dial').getBoundingClientRect(), [dx, dy] = directions[e.key], distance = e.shiftKey ? 40 : 10;
      cfg.widgetPosition = Placement.clampPointerToPosition(dial.left + dx * distance, dial.top + dy * distance, 0, 0,
        dial.width, dial.height, innerWidth, innerHeight);
      Store.set('cfg', cfg); positionWidget();
    } else if (e.target === W && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); togglePanel(!panel.classList.contains('on')); }
  });

  function renderStats() {
    const keys = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return [d.toLocaleDateString('en-CA'), d.toLocaleDateString(undefined, { weekday: 'narrow' })]; });
    const vals = keys.map(([k]) => S.days[k] || { d: 0, s: 0, a: 0 });
    const t = vals[6], max = Math.max(4, ...vals.map(v => v.d));
    let streak = 0;
    for (let i = 6; i >= 0; i--) { if (vals[i].d > 0) streak++; else if (i !== 6) break; }
    const hrs = t.a >= 3600 ? (t.a / 3600).toFixed(1) + 'h' : Math.round(t.a / 60) + 'm';
    els.stats.innerHTML = `
      <div class="stats"><div class="stat"><b>${t.d}</b><span>breaks taken</span></div><div class="stat"><b>${t.s}</b><span>skipped</span></div><div class="stat"><b>${hrs}</b><span>on screen</span></div></div>
      <div class="row"><div class="lbl"><b>Daily streak</b><span>Days in a row with at least one break</span></div><b style="font:300 28px var(--serif)">${streak}</b></div>
      <div class="chart">${vals.map((v, i) => `<div class="bar ${i === 6 ? 'today' : ''}" title="${v.d} breaks"><i style="height:${Math.max(4, v.d / max * 82)}%;animation-delay:${i * 50}ms"></i><span>${keys[i][1]}</span></div>`).join('')}</div>
      <p class="hint">Breaks completed over the last seven days.</p>`;
  }

  /* ───────────── shortcuts, messages, sync, boot ───────────── */
  addEventListener('keydown', e => {
    if (PAGE) return;
    if (e.altKey && e.shiftKey) {
      if (e.code === 'KeyE') { e.preventDefault(); togglePanel(!panel.classList.contains('on')); }
      else if (e.code === 'KeyB') { e.preventDefault(); startBreak(); }
      else if (e.code === 'KeyP') { e.preventDefault(); togglePause(); }
    } else if (e.key === 'Escape') {
      if (panel.classList.contains('on')) togglePanel(false);
      else if (S.phase === 'break' && !cfg.strict) endBreak('skip');
    }
  }, true);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open settings', () => togglePanel(true));
    GM_registerMenuCommand('Take a break now', startBreak);
    GM_registerMenuCommand('Pause or resume', togglePause);
  }
  try {
    if (hasCR && chrome.runtime && chrome.runtime.onMessage)
      chrome.runtime.onMessage.addListener((message, _sender, respond) => {
        if (message?.type !== 'panel') return;
        togglePanel(typeof message.open === 'boolean' ? message.open : !panel.classList.contains('on'));
        respond({ ok: true, panelOpen: panel.classList.contains('on') });
      });
  } catch {}

  function receiveState(value) {
    if (!value || value.w === ME) return;
    if (Store.coordinated && (value.timerSchema !== 1 || (value.revision || 0) <= (S.revision || 0))) return;
    const endedRest = S.phase === 'break' && value.phase !== 'break';
    const beganRest = S.phase !== 'break' && value.phase === 'break';
    S = { ...freshState(), ...value };
    if (endedRest) stopVoice();
    if (beganRest) {
      togglePanel(false); hideToast(); if (!PAGE) void chime('start');
      if (!PAGE && cfg.notify && !document.hasFocus())
        void packMessage({ type: 'blinkly-break-notification', sessionId: String(S.breakEnd) }).catch(() => {});
    }
    externalVoiceEvent(); render();
    if (endedRest && S.res === 'done' && (!cfg.voiceOn || !cfg.voiceDone)) void chime('end');
  }
  Store.on((k, v) => {
    if (k === 'state' && v) receiveState(v);
    if (k === 'cfg' && v) { const previous = cfg; cfg = readConfig(v); if (previous.flirty !== cfg.flirty || previous.recipientGender !== cfg.recipientGender) stopVoice(); if (!cfg.voiceOn || vCur?.context?.event === 'snooze' && !cfg.voiceSnooze || vCur?.context?.event === 'done' && !cfg.voiceDone) stopVoice(); applyCfg(); syncControls(); restoreSettingsTab(); if (libraryClips.length) { $('#library-search').value = cfg.librarySearch || ''; $('#library-category').value = cfg.libraryCategory || ''; $('#library-preference').value = cfg.libraryPreference || 'all'; renderLibrary(); } render(); }
  });
  if (!PAGE && Store.coordinated) {
    addEventListener('focus', () => { void sharedCommand('snapshot'); });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sharedCommand('snapshot');
    });
  }

  applyCfg(); syncControls(); restoreSettingsTab(); render();
  if (PAGE) { panel.classList.add('on', 'page'); renderStats(); requestAnimationFrame(moveInd); setInterval(() => { render(); renderSleepInfo(); }, 1000); voiceStatus(); }
  else { setInterval(tick, 1000); setInterval(applyWarm, 60000); }
  function resumeBlockedVoice() {
    const pending = blockedVoice; blockedVoice = null;
    if (pending && pending.epoch === vEpoch && pending.sessionId === String(S.breakEnd) && voiceAllowed(pending.context))
      void voiceEvent(pending.event, pending.step, pending.action);
  }
  async function enableAudio(event) {
    if (extensionPlayback) return;
    if (await audio.unlock(event)) resumeBlockedVoice();
  }
  // Real interaction grants audio permission; timers only reuse that permission.
  ['click', 'pointerup', 'keydown'].forEach(type => addEventListener(type, enableAudio, { capture: true, passive: true }));
  if (navigator.userActivation?.hasBeenActive) void enableAudio();
  void voiceStatus();
  void loadLibrary();
  void loadBrandIcon();
  addEventListener('blur', stopVoice);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stopVoice(); });
  requestAnimationFrame(moveInd);
})();
