/* Calm rest guidance: one line for short breaks, at most two for longer rests. */
(function (scope) {
  'use strict';
  const durationSeconds = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 20;
  const maxUtterances = duration => durationSeconds(duration) >= 40 ? 2 : 1;
  const restStepAllowed = (duration, step) => step === 0 || step === 2 && maxUtterances(duration) === 2;
  const api = Object.freeze({ restStepAllowed, maxUtterances });
  scope.BlinklyVoiceCadence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
