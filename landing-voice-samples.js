/* Landing-page previews reuse the exact recordings shipped with Blinkly. */
(function (scope) {
'use strict';
const plans = {
  "bal": {
    "neutral": [
      [
        "vo_zzndqm7n06",
        "vo_ws68868abq"
      ],
      [
        "vo_4ouasos20i",
        "vo_nojnn4tab0"
      ],
      [
        "vo_25uzxvqknge",
        "vo_okdj575zjh"
      ]
    ],
    "male": [
      [
        "vo_14uffq7h2b0",
        "vo_nurwmvkyay"
      ],
      [
        "vo_13lqfu3gmtt",
        "vo_1fnn5uu0pp8"
      ],
      [
        "vo_1wnmlny8gn2",
        "vo_2fxlymt4x2s"
      ]
    ],
    "female": [
      [
        "vo_1pvnc8c58ub",
        "vo_p7982q3fty"
      ],
      [
        "vo_jhhqfyj11o",
        "vo_ws68868abq"
      ],
      [
        "vo_1sfsevmmyj3",
        "vo_nojnn4tab0"
      ]
    ]
  },
  "snz": {
    "neutral": [
      [
        "vo_1e3hwygz10"
      ],
      [
        "vo_123jkep0rnv"
      ],
      [
        "vo_1p6ofscf1pu"
      ]
    ]
  },
  "rst": {
    "neutral": [
      [
        "vo_1wmshz0gun4"
      ],
      [
        "vo_qqauq6rml1"
      ],
      [
        "vo_2bn5m2b3w9j"
      ]
    ]
  }
};
const clips = {
  "vo_123jkep0rnv": {
    "file": "audio/vo_123jkep0rnv.mp3",
    "title": "Keeping count",
    "transcript": "Oh, one more thing? Fine. Five minutes. I'm keeping count."
  },
  "vo_13lqfu3gmtt": {
    "file": "audio/vo_13lqfu3gmtt.mp3",
    "title": "Sweet look away \u00b7 babe \u00b7 02",
    "transcript": "Eyes up, babe... way out there. Good boy."
  },
  "vo_14uffq7h2b0": {
    "file": "audio/vo_14uffq7h2b0.mp3",
    "title": "Daddy, look far away",
    "transcript": "Daddy, eyes up. Look far away... good."
  },
  "vo_1e3hwygz10": {
    "file": "audio/vo_1e3hwygz10.mp3",
    "title": "You snoozed me?",
    "transcript": "You snoozed me? Five minutes. Then those eyes get their break."
  },
  "vo_1fnn5uu0pp8": {
    "file": "audio/vo_1fnn5uu0pp8.mp3",
    "title": "Needy blink \u00b7 babe \u00b7 01",
    "transcript": "Slow blink for me, babe... I'll wait right here."
  },
  "vo_1p6ofscf1pu": {
    "file": "audio/vo_1p6ofscf1pu.mp3",
    "title": "The rehearsed reminder",
    "transcript": "I rehearsed that whole reminder... Alright, five more minutes."
  },
  "vo_1pvnc8c58ub": {
    "file": "audio/vo_1pvnc8c58ub.mp3",
    "title": "Sweet look away \u00b7 bunny \u00b7 01",
    "transcript": "Look up for me, bunny... find something far away."
  },
  "vo_1sfsevmmyj3": {
    "file": "audio/vo_1sfsevmmyj3.mp3",
    "title": "Sweet look away \u00b7 sugarplum \u00b7 01",
    "transcript": "Look up for me, sugarplum... find something far away."
  },
  "vo_1wmshz0gun4": {
    "file": "audio/vo_1wmshz0gun4.mp3",
    "title": "Rested and ready",
    "transcript": "Rested! See you in 20 minutes."
  },
  "vo_1wnmlny8gn2": {
    "file": "audio/vo_1wnmlny8gn2.mp3",
    "title": "Teasing look away \u00b7 Mr. Sexy \u00b7 01",
    "transcript": "Eyes off the screen, Mr. Sexy. I'm way more fun than that spreadsheet."
  },
  "vo_25uzxvqknge": {
    "file": "audio/vo_25uzxvqknge.mp3",
    "title": "Screen down, eyes up",
    "transcript": "Screen down. Eyes up. Find a distant point."
  },
  "vo_2bn5m2b3w9j": {
    "file": "audio/vo_2bn5m2b3w9j.mp3",
    "title": "That feels better",
    "transcript": "Ahh. That's better. Back in 20 minutes."
  },
  "vo_2fxlymt4x2s": {
    "file": "audio/vo_2fxlymt4x2s.mp3",
    "title": "A heartbeat and a breath",
    "transcript": "Shoulders down... unclench your jaw... breathe out."
  },
  "vo_4ouasos20i": {
    "file": "audio/vo_4ouasos20i.mp3",
    "title": "The break-time bell",
    "transcript": "Break time. Eyes up... pick a spot way out there."
  },
  "vo_jhhqfyj11o": {
    "file": "audio/vo_jhhqfyj11o.mp3",
    "title": "Needy look away \u00b7 my queen \u00b7 01",
    "transcript": "Look far away for me, my queen... then come back and look at me, okay?"
  },
  "vo_nojnn4tab0": {
    "file": "audio/vo_nojnn4tab0.mp3",
    "title": "Shoulders down, jaw loose",
    "transcript": "Ahh... shoulders down, jaw loose. Breathe out."
  },
  "vo_nurwmvkyay": {
    "file": "audio/vo_nurwmvkyay.mp3",
    "title": "A slow blink for me",
    "transcript": "Give me a slow blink, Daddy. All the way closed."
  },
  "vo_okdj575zjh": {
    "file": "audio/vo_okdj575zjh.mp3",
    "title": "Nothing to solve",
    "transcript": "Nothing to solve. Just soften your focus."
  },
  "vo_p7982q3fty": {
    "file": "audio/vo_p7982q3fty.mp3",
    "title": "Needy soften focus \u00b7 bunny \u00b7 01",
    "transcript": "Let it go blurry for me, bunny... I've got you."
  },
  "vo_qqauq6rml1": {
    "file": "audio/vo_qqauq6rml1.mp3",
    "title": "Happy eyes",
    "transcript": "Nice! Eyes happy. See you in 20 minutes."
  },
  "vo_ws68868abq": {
    "file": "audio/vo_ws68868abq.mp3",
    "title": "Close all the way",
    "transcript": "Now blink... slowly... all the way closed."
  },
  "vo_zzndqm7n06": {
    "file": "audio/vo_zzndqm7n06.mp3",
    "title": "Find a distant spot",
    "transcript": "Alright... look up from the screen. Find something far away."
  }
};
function createPlayer(options = {}) {
  const AudioClass = options.Audio || scope.Audio;
  const schedule = options.setTimeout || scope.setTimeout.bind(scope);
  const cancel = options.clearTimeout || scope.clearTimeout.bind(scope);
  const now = options.now || Date.now;
  const report = options.onState || (() => {});
  const rotations = new Map();
  let active = null, timer = null, epoch = 0;
  function stop(reason = 'stopped') {
    ++epoch;
    if (timer !== null) cancel(timer);
    timer = null;
    if (active) {
      active.onplaying = active.onended = active.onerror = null;
      active.pause(); active.removeAttribute('src'); active.load(); active = null;
    }
    report({ phase: reason });
  }
  function play(moment = 'bal', gender = 'male', flirty = false) {
    stop();
    const group = plans[moment] || plans.bal;
    const kind = flirty && group[gender] ? gender : 'neutral';
    const choices = group[kind], rotation = moment + ':' + kind;
    const index = rotations.get(rotation) || 0;
    const selected = choices[index % choices.length];
    rotations.set(rotation, index + 1);
    const token = epoch;
    let startedAt = now();
    function start(index) {
      if (token !== epoch) return;
      const key = selected[index], clip = clips[key], audio = new AudioClass();
      active = audio; audio.preload = 'none'; audio.volume = .85; audio.src = clip.file;
      report({ phase: 'loading', key, clip });
      audio.onplaying = () => { if (token === epoch) { if (index === 0) startedAt = now(); report({ phase: 'playing', key, clip }); } };
      function failed() { if (token === epoch) { stop('error'); } }
      audio.onerror = failed;
      audio.onended = () => {
        if (token !== epoch) return;
        audio.onplaying = audio.onended = audio.onerror = null;
        active = null;
        if (index + 1 >= selected.length) { report({ phase: 'ended', key, clip }); return; }
        const delay = Math.max(1200, 10000 - (now() - startedAt));
        report({ phase: 'waiting', key, clip });
        timer = schedule(() => { timer = null; start(index + 1); }, delay);
      };
      try { Promise.resolve(audio.play()).catch(failed); } catch { failed(); }
    }
    start(0);
  }
  return Object.freeze({ play, stop });
}
const api = Object.freeze({ createPlayer, plans, clips });
scope.BlinklySamples = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
