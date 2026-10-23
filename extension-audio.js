/* One extension-owned player shared by every tab. */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.BlinklyExtensionAudio = exported;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KEY = /^vo_[a-z0-9]+$/, TOKEN = /^[A-Za-z0-9:_-]{1,180}$/;
  function create(options) {
    const api = options.api || globalThis.chrome;
    let current = null, creating = null, direct = null, sequence = 0, committed = 0;
    const pending = new Set();
    const owner = sender => Number.isInteger(sender?.tab?.id) ? `tab:${sender.tab.id}` : `extension:${sender?.url || ''}`;
    async function backend() {
      if (!api.offscreen?.createDocument) {
        if (!direct) {
          const factory = options.playerFactory || globalThis.BlinklyAudioPlayer?.create;
          if (!factory) throw new Error('Extension audio player unavailable');
          direct = factory({ getURL: path => api.runtime.getURL(path) });
        }
        return direct;
      }
      if (!creating) {
        creating = (async () => {
          const url = api.runtime.getURL('audio-player.html');
          const exists = api.offscreen.hasDocument ? await api.offscreen.hasDocument()
            : api.runtime.getContexts ? (await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0 : false;
          if (!exists) await api.offscreen.createDocument({ url: 'audio-player.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play locally saved Blinkly break guidance.' });
        })().finally(() => { creating = null; });
      }
      await creating;
      const send = action => message => api.runtime.sendMessage({ ...message, target: 'blinkly-audio-player', action });
      return { play: send('play'), stop: send('stop'), status: send('status') };
    }
    async function cancel(record) {
      if (!record || record.canceled) return;
      record.canceled = true;
      if (current === record) current = null;
      // If document creation is still pending, play() checks canceled before dispatch.
      if (record.player) {
        try { await record.player.stop({ token: record.token }); } catch { /* the document may have closed */ }
      }
    }
    async function play(message, sender) {
      if (!message || !(typeof message.key === 'string' && KEY.test(message.key) && message.chime === undefined
        || message.key === undefined && ['start', 'end'].includes(message.chime))
        || typeof message.token !== 'string' || !TOKEN.test(message.token)
        || typeof message.volume !== 'number' || !Number.isFinite(message.volume) || message.volume < 0 || message.volume > 1)
        return { ok: false, started: false, canceled: false, error: 'Invalid audio request' };
      // Track immediately so stop can cancel authorization and document creation too.
      // Only an authorized request may replace the current foreground recording.
      const record = { token: message.token, owner: owner(sender), sender, message, canceled: false, player: null, sequence: ++sequence };
      pending.add(record);
      try {
        const [allowed, clip] = await Promise.all([options.canSpeak(sender, message), message.chime ? Promise.resolve({ file: `audio/chime-${message.chime}.wav` }) : options.getClip(message.key)]);
        if (record.canceled || record.sequence < committed) return { ok: true, started: false, canceled: true };
        if (!allowed) { await cancel(record); return { ok: true, started: false, canceled: true }; }
        if (!clip || clip.file !== (message.chime ? `audio/chime-${message.chime}.wav` : `audio/${message.key}.mp3`)) throw new Error('Clip is not in the bundled voice pack');
        const previous = current;
        current = record;
        committed = record.sequence;
        await cancel(previous);
        if (record.canceled || current !== record) return { ok: true, started: false, canceled: true };
        record.player = await backend();
        if (record.canceled || current !== record) return { ok: true, started: false, canceled: true };
        // Focus may have changed while the offscreen page was being created.
        if (!(await options.canSpeak(sender, message)) || record.canceled || current !== record) {
          await cancel(record); return { ok: true, started: false, canceled: true };
        }
        const result = await record.player.play({ key: message.key, chime: message.chime, token: message.token, volume: message.volume });
        return { ...result, canceled: record.canceled || !!result?.canceled };
      } catch (error) {
        await cancel(record);
        return { ok: false, started: false, canceled: record.canceled, error: error.message || 'Extension audio failed' };
      } finally { pending.delete(record); if (current === record) current = null; }
    }
    async function stop(message, sender) {
      const records = [...pending].filter(record => record.token === message?.token && record.owner === owner(sender));
      if (!records.length) return { ok: true, stopped: false };
      await Promise.all(records.map(cancel));
      return { ok: true, stopped: true };
    }
    async function status(message, sender) {
      const record = [...pending].find(record => !record.canceled && record.token === message?.token && record.owner === owner(sender));
      if (!record) return { ok: true, playing: false, started: false };
      if (!record.player) return { ok: true, playing: true, started: false };
      try { return await record.player.status({ token: record.token }); }
      catch { return { ok: false, playing: false, started: false }; }
    }
    function handle(message, sender) {
      if (message?.target === 'blinkly-audio-player') return undefined;
      if (message?.type === 'blinkly-audio-play') return play(message, sender);
      if (message?.type === 'blinkly-audio-stop') return stop(message, sender);
      if (message?.type === 'blinkly-audio-status') return status(message, sender);
      return undefined;
    }
    function attach() {
      const checkFocus = async () => {
        const record = current;
        if (!record) return;
        let allowed = false;
        try { allowed = await options.canSpeak(record.sender, record.message); } catch { /* fail closed */ }
        if (!allowed && current === record) await cancel(record);
      };
      api.tabs?.onActivated?.addListener(checkFocus);
      api.windows?.onFocusChanged?.addListener(checkFocus);
      api.tabs?.onRemoved?.addListener(tabId => { if (current?.sender?.tab?.id === tabId) void cancel(current); });
      api.tabs?.onUpdated?.addListener((tabId, change) => {
        if (current?.sender?.tab?.id === tabId && (change.status === 'loading' || change.url)) void cancel(current);
      });
    }
    return Object.freeze({ play, stop, status, handle, attach, stopAll: () => Promise.all([...pending].map(cancel)) });
  }
  return { create };
});
