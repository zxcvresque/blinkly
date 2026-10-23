/* Blinkly's extension-owned audio element. No page audio permission is needed. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlinklyAudioPlayer = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KEY = /^vo_[a-z0-9]+$/, TOKEN = /^[A-Za-z0-9:_-]{1,180}$/;
  const CHIMES = { start: 'audio/chime-start.wav', end: 'audio/chime-end.wav' };
  function create(options = {}) {
    const AudioClass = options.Audio || globalThis.Audio;
    const getURL = options.getURL || (path => chrome.runtime.getURL(path));
    let current = null;
    function finish(record, canceled, error) {
      if (!record || record.finished) return;
      record.finished = true;
      record.audio.onended = record.audio.onerror = record.audio.onplaying = null;
      if (canceled || error) {
        record.audio.pause();
        record.audio.removeAttribute?.('src');
        record.audio.load?.();
      }
      clearTimeout(record.timer);
      if (current === record) current = null;
      record.resolve({ ok: !error, started: record.started, canceled: !!canceled, ...(Number.isFinite(record.audio.duration) ? { duration: record.audio.duration } : {}), ...(error ? { error } : {}) });
    }
    function stop(message = {}) {
      const record = current;
      if (!record || (message.token !== undefined && message.token !== record.token))
        return { ok: true, stopped: false };
      finish(record, true);
      return { ok: true, stopped: true };
    }
    function status(message = {}) {
      const record = current;
      return { ok: true, playing: !!record && (message.token === undefined || message.token === record.token),
        started: !!record && record.token === message.token && record.started,
        token: record?.token || null };
    }
    function play(message) {
      if (!message || !(typeof message.key === 'string' && KEY.test(message.key) && message.chime === undefined
        || message.key === undefined && Object.hasOwn(CHIMES, message.chime)) || typeof message.token !== 'string' || !TOKEN.test(message.token))
        return Promise.resolve({ ok: false, started: false, canceled: false, error: 'Invalid audio request' });
      if (typeof message.volume !== 'number' || !Number.isFinite(message.volume) || message.volume < 0 || message.volume > 1)
        return Promise.resolve({ ok: false, started: false, canceled: false, error: 'Invalid audio volume' });
      stop();
      return new Promise(resolve => {
        let audio;
        try { audio = new AudioClass(getURL(Object.hasOwn(CHIMES, message.chime) ? CHIMES[message.chime] : `audio/${message.key}.mp3`)); }
        catch { resolve({ ok: false, started: false, canceled: false, error: 'Audio player unavailable' }); return; }
        const record = { token: message.token, audio, resolve, started: false, finished: false };
        current = record;
        audio.volume = message.volume;
        audio.preload = 'auto';
        audio.onplaying = () => { if (!record.finished) record.started = true; };
        audio.onended = () => { record.started = true; finish(record, false); };
        audio.onerror = () => finish(record, false, 'Bundled audio could not be played');
        record.timer = setTimeout(() => finish(record, false, 'Audio playback timed out'), 90000);
        try {
          Promise.resolve(audio.play()).then(() => {
            if (!record.finished) record.started = true;
          }, () => finish(record, false, 'Audio playback was blocked'));
        } catch { finish(record, false, 'Audio playback was blocked'); }
      });
    }
    return Object.freeze({ play, stop, status });
  }
  function install(api = globalThis.chrome) {
    const player = create({ getURL: path => api.runtime.getURL(path) });
    api.runtime.onMessage.addListener((message, sender, respond) => {
      if (message?.target !== 'blinkly-audio-player' || sender?.tab || (sender?.id && sender.id !== api.runtime.id)) return;
      const operation = { play: player.play, stop: player.stop, status: player.status }[message.action];
      if (!operation) return;
      Promise.resolve(operation(message)).then(respond, () => respond({ ok: false, error: 'Audio player failed' }));
      return true;
    });
    return player;
  }
  return { create, install };
});
if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && document.documentElement.dataset.blinklyAudioPlayer === 'true')
  globalThis.BlinklyAudioPlayer.install(chrome);
