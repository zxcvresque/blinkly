/* Shared immutable original copy and additional contextual performances. */
(function (scope) {
  'use strict';
  const petClips = scope.BlinklyPetClips || (typeof module !== 'undefined' && module.exports ? require('./voice-data/pet-clips.js') : []);
  function original(workMin = 20) {
    const cfg = { workMin };
  const mins = n => (n === 1 ? '1 minute' : `${n} minutes`);
  const VO = () => {
    const n = mins(cfg.workMin);
    return {
      test: "[whispering] Hey... [chuckling] it's me. [softly] Time to rest those eyes.",
      warn: [
        "[clears throat] [softly] Hey... break's coming up in just a moment. [chuckling] Finish your thought. I'll wait.",
        "[keyboard typing] [playful] Still typing, huh? [chuckling] Wrap it up... break's almost here.",
        "[knocking on door] [whispering] Knock knock... your eyes would like a little break soon.",
        "[phone ringing] [chuckling] Oh, that's just me. [softly] Break's almost here.",
        "[menacing] Your break is coming... [laughing] kidding. Just a moment, okay?",
        "[witch voice] Heh heh heh... time for your break, my pretty."
      ],
      warnNight: "[yawning] [tired] It's late... [weak] but your eyes still need this. Break soon.",
      steps: [
        [ // look 20 feet away
          "[softly] Alright... look up from the screen. [pause] Find something far away.",
          "[bell ringing] [softly] Break time. Eyes up... pick a spot way out there.",
          "[echoing] [whispering] Look up... find something far, far away."
        ],
        [ // let your eyes go soft
          "[slowly] Let your eyes go soft... no need to strain.",
          "[rain falling] [softly] Just rest on it... like watching the rain.",
          "[whispering] Let it go a little blurry... that's okay."
        ],
        [ // blink slowly
          "[slowly] Now blink... slowly... [pause] all the way closed.",
          "[playful] Blinking time! [pause] Nice... and slow.",
          "[whispering] Blink... [pause] nice and slow."
        ],
        [ // drop your shoulders
          "[yawning] Ahh... shoulders down, jaw loose. [sighing] Breathe out.",
          "[heartbeat] [slowly] Shoulders down... [pause] unclench your jaw... [sighing] breathe out.",
          "[softly] Drop your shoulders... [sighing] and let it all go."
        ]
      ],
      done: [
        `[laughing] Rested! [softly] See you in ${n}.`,
        `[excited] Nice! Eyes happy. [laughing] See you in ${n}.`,
        `[sighing] Ahh. That's better. [chuckling] Back in ${n}.`,
        `[dog barking] [laughing] Even the dog says nice job. Rested! See you in ${n}.`,
        `[engine starting] [excited] Eyes recharged! See you in ${n}.`
      ],
      doneNight: `[sleepy drowsy voice] Rested... [yawning] see you in ${n}. Or maybe... get some sleep.`
    };
  };
    return VO();
  }

  // Added performances never rewrite the original sentences above.
  const extra = {
    warn: [
      "[bored] Another tab? [sighing] Your eyes are filing a complaint. Break soon.",
      "[coughing] [clears throat] Ahem. Your screen has had plenty of attention. Your eyes are next.",
      "[sniffling] [playful] Don't mind me. Just getting emotional about you finally taking a break.",
      "[drum roll] [excited] Coming up next... twenty seconds without a screen!",
      "[gasping] [playful] A world beyond this tab? Incredible. Let's look at it in a moment.",
      "[shouting] Eyes up! [softly] Sorry. Tiny announcement. Your break is nearly here."
    ],
    snooze: [
      "[angry] [sharp exhale] You snoozed me? Five minutes. Then those eyes get their break.",
      "[scoffing] [angry] Oh, one more thing? Fine. Five minutes. I'm keeping count.",
      "[voice breaking] I rehearsed that whole reminder... [chuckling] Alright, five more minutes."
    ],
    snoozeAgain: [
      "[angry] Again? [sharp exhale] That snooze button is not an eye care routine.",
      "[menacing] [slowly] Another snooze. [pause] I will be back. [chuckling] In five minutes."
    ],
    warnSnoozed: [
      "[angry] Your five minutes are nearly up. [softly] Finish that thought. Eyes next.",
      "[scoffing] Remember that little snooze? [playful] The sequel is almost over. Break soon."
    ],
    steps: [
      [
        "[humming] [softly] Screen down. Eyes up. Find a distant point.",
        "[witch voice] My little spell is simple... [softly] look far away.",
        "[drum roll] [playful] And now... look beyond the screen."
      ],
      [
        "[sleepy drowsy voice] Easy now... let your eyes rest on that distant spot.",
        "[sighing] [softly] Nothing to solve. Just soften your focus.",
        "[echoing] [slowly] Far away... easy eyes... stay there."
      ],
      [
        "[singing] Blink... blink... [softly] slowly, all the way closed.",
        "[playful] Give those eyelids a proper turn. [slowly] Close... open.",
        "[softly] One slow blink. [pause] And another."
      ],
      [
        "[panting] [sharp exhale] Whew. [softly] Drop those shoulders. Let your jaw relax.",
        "[humming] [softly] Shoulders low. Jaw loose. [sighing] There we go.",
        "[heartbeat] [slowly] Easy shoulders... easy breath."
      ]
    ],
    done: [
      "[crowd cheering] [excited] Yes! A whole break. Your eyes have fans now.",
      "[applause] [playful] A tiny standing ovation for looking away.",
      "[voice breaking] I'm so proud... [laughing] It was only twenty seconds, but still.",
      "[singing] Eyes rested, shoulders free... [chuckling] Back you go."
    ],
    skip: [
      "[bored] Skipped. [sighing] Your eyes noticed. Catch the next one, okay?",
      "[scoffing] [playful] Escaping already? Alright. We'll try again next time."
    ],
    pause: ["[softly] Timer paused. Take your time."],
    resume: ["[playful] There you are. Timer's running again."],
    restart: ["[softly] Fresh timer. A little reset for both of us."],
    welcome: ["[chuckling] Welcome back. [softly] Fresh timer, rested eyes, let's go."],
    media: ["[whispering] I'll wait for your video. [softly] Take your eye break when it's done."],
    nightWarn: [
      "[sleepy drowsy voice] [yawning] It's late, isn't it... your eyes could use a little quiet.",
      "[tired] [weak] Just a gentle nudge. [softly] Break soon."
    ],
    nightDone: ["[sleepy drowsy voice] [sighing] Better. Maybe let the next break be bedtime."],
    drunkWarn: [
      "[drunken voice] It's late, isn't it... [chuckling] Even I can see those eyes need a break.",
      "[drunken voice] Okay, listen... [pause] the screen will still be here. Break soon."
    ],
    drunkSnooze: [
      "[drunken voice] You snoozed... the snooze? [scoffing] Five minutes. I think. Yes, five."
    ],
    drunkSteps: [
      ["[drunken voice] Eyes up... find something far away. [softly] That one. Stay there."],
      ["[drunken voice] Easy focus... [sighing] let those eyes relax."],
      ["[drunken voice] Blink... [slowly] slowwwly. Both eyes, please."],
      ["[drunken voice] Shoulders down... [sighing] and breathe out. Nailed it."]
    ],
    drunkDone: [
      "[drunken voice] [chuckling] Look at you. Responsible eyes. [softly] Now consider some sleep.",
      "[drunken voice] We did it. [yawning] You, me, both eyes. Bedtime, maybe?"
    ]
  };

  // Keep all performance tags available inside alert/rest sessions, including
  // tags whose original recordings belong to the now-silent completion phase.
  extra.warn.push(
    "[dog barking] [playful] Even the dog says... eyes up. Break soon.",
    "[engine starting] [playful] Time to idle those eyes. Break soon.",
    "[voice breaking] Your eyes work so hard... [softly] break soon."
  );
  extra.steps[0].push("[crowd cheering] [excited] It's eye break time! Find your distant spot.");
  extra.steps[1].push("[applause] [softly] There we go. Keep looking far away.");

  // Additional late-night performances; original recordings remain untouched.
  extra.drunkSteps[0].push(
    "[drunken voice] Hey... eyes off the screen. Find something way out there.",
    "[drunken voice] Alright, look up... distant spot. That's the one."
  );
  extra.drunkSteps[1].push(
    "[drunken voice] No squinting... [softly] just let that focus soften.",
    "[drunken voice] Nothing to solve out there. [sighing] Let your eyes go easy."
  );
  extra.drunkSteps[2].push(
    "[drunken voice] One slow blink... [pause] and another. Good work, eyelids.",
    "[drunken voice] Close those eyes... open. [chuckling] Nice and slow."
  );
  extra.drunkSteps[3].push(
    "[drunken voice] Unclench that jaw... shoulders low. [sighing] There you go.",
    "[drunken voice] Let those shoulders drop. [softly] Easy breath... that's it."
  );
  // Brief facts replace the blink step occasionally, rather than adding narration.
  // Sources: American Academy of Ophthalmology and American Optometric Association;
  // see README for links. No fixed blink-rate percentage is asserted.
  extra.facts = [
    "[softly] Screens make us blink less. [slowly] Give me a full blink.",
    "[softly] Blinking spreads tears across your eyes. One slow blink.",
    "[playful] A full blink helps keep your eyes moist. [slowly] Close... open."
  ];
  extra.drunkFacts = [
    "[drunken voice] Screens make us blink less. [slowly] Give me a full blink.",
    "[drunken voice] Blinking spreads tears across your eyes. One slow blink.",
    "[drunken voice] A full blink keeps your eyes moist. [slowly] Close... open."
  ];
  // Opt-in playful performances; the standard pools stay unchanged by default.
  extra.flirtyWarn = [
    "[playful] Daddy... that screen has had you long enough. My turn in a moment.",
    "[whispering] Hey, handsome. Wrap it up... I've got twenty seconds planned for those eyes."
  ];
  extra.flirtySteps = [
    ["[whispering] Daddy, eyes up. [playful] Look far away... good."],
    ["[softly] Easy, handsome. Let that focus soften... just like that."],
    ["[playful] Give me a slow blink, Daddy. [slowly] All the way closed."],
    ["[whispering] Drop those shoulders, Daddy. [sighing] That's better."]
  ];
  extra.drunkFlirtyWarn = [
    "[drunken voice] Daddy... that screen has had you long enough. [chuckling] My turn in a moment.",
    "[drunken voice] Hey, handsome. Wrap it up... [softly] I've got a little eye break planned."
  ];
  extra.drunkFlirtySteps = [
    ["[drunken voice] Daddy, eyes up... [softly] look far away. Good."],
    ["[drunken voice] Easy, handsome... let that focus soften. [sighing] Just like that."],
    ["[drunken voice] One slow blink for me, Daddy. [slowly] All the way closed."],
    ["[drunken voice] Drop those shoulders, Daddy... [sighing] that's better."]
  ];

  const flatten = value => typeof value === 'string' ? [value] : Object.values(value).flatMap(flatten);
  const allTexts = workMin => [...new Set([...flatten(original(workMin)), ...flatten(extra), ...petClips.map(clip => clip.text)])];
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const VOICE_ID = 'hpp4J3VqNfWAUOO0d1Us', MODEL = 'eleven_v4';
  const key = text => 'vo_' + hash(`${MODEL}|${VOICE_ID}|${text}`);
  const personalByText = new Map(petClips.map(clip => [clip.text, clip]));
  const legacyPersonalTexts = new Set([
    ...extra.flirtyWarn, ...extra.flirtySteps.flat(),
    ...extra.drunkFlirtyWarn, ...extra.drunkFlirtySteps.flat()
  ]);
  function petName(text) {
    if (typeof text !== 'string') return '';
    const clip = personalByText.get(text);
    const named = clip?.memberships.find(row => typeof row.pet === 'string' && row.pet.trim());
    if (named) return named.pet.trim().toLowerCase();
    if (!clip && !legacyPersonalTexts.has(text)) return '';
    // Match the worker's handling of names fixed in the recorded sentence.
    return text.match(/\b(daddy|handsome|handshome|babeee|hot shtuff|trouble|mister|beautiful|vixen|gorgeoush?)\b/i)?.[0].toLowerCase() || '';
  }
  const istHour = (date = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(date));
  function period(date) {
    const hour = istHour(date);
    return hour >= 2 && hour < 6 ? 'drunk' : hour >= 23 || hour < 2 ? 'night' : 'day';
  }
  function pool(event, { workMin = 20, snoozeCount = 0, date = new Date(), step = 0, flirty = false, recipientGender = 'male', periodOverride } = {}) {
    const v = original(workMin), p = ['day', 'night', 'drunk'].includes(periodOverride) ? periodOverride : period(date);
    const gender = recipientGender === 'female' ? 'female' : 'male';
    const personal = flirty ? petClips.filter(clip => clip.memberships.some(row =>
      row.gender === gender && row.event === event && (event !== 'step' || row.step === step)
      && (p === 'drunk' ? row.mood === 'drunk' : p === 'night' ? row.mood === 'sleepy' : !['sleepy', 'drunk'].includes(row.mood))
    )).map(clip => clip.text) : [];
    const extend = base => [...new Set([...base, ...personal])];
    if (event === 'fact') return extend(p === 'drunk' ? extra.drunkFacts : extra.facts);
    if (event === 'test') return personal.length ? personal : [v.test];
    if (event === 'warn') {
      const base = p === 'drunk' ? extra.drunkWarn : snoozeCount ? extra.warnSnoozed
        : p === 'night' ? [v.warnNight, ...extra.nightWarn] : [...v.warn, ...extra.warn];
      return extend(flirty && gender === 'male' ? [...base, ...(p === 'drunk' ? extra.drunkFlirtyWarn : extra.flirtyWarn)] : base);
    }
    if (event === 'step') {
      const base = p === 'drunk' ? extra.drunkSteps[step] : [...v.steps[step], ...extra.steps[step]];
      return extend(flirty && gender === 'male' ? [...base, ...(p === 'drunk' ? extra.drunkFlirtySteps[step] : extra.flirtySteps[step])] : base);
    }
    if (event === 'done') return p === 'drunk' ? extra.drunkDone : p === 'night' ? [v.doneNight, ...extra.nightDone] : [...v.done, ...extra.done];
    if (event === 'snooze') return p === 'drunk' ? extra.drunkSnooze : snoozeCount > 1 ? extra.snoozeAgain : extra.snooze;
    return extra[event] || [];
  }
  function completionPool({ workMin = 20, breakSec = 20, date = new Date(), periodOverride } = {}) {
    const p = ['day', 'night', 'drunk'].includes(periodOverride) ? periodOverride : period(date);
    if (p === 'drunk') return extra.drunkDone;
    if (p === 'night') return [...(workMin === 20 ? [original(20).doneNight] : []), ...extra.nightDone];
    return [...(workMin === 20 ? original(20).done : []), ...extra.done.filter(text => breakSec === 20 || !text.includes('twenty seconds'))];
  }
  const api = Object.freeze({ original, extra, petClips, allTexts, hash, key, petName, pool, completionPool, istHour, period, VOICE_ID, MODEL });
  scope.BlinklyVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
