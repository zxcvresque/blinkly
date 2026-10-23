/* Rest guidance supports a quiet opening or two balanced prompts. */
(function (scope) {
  'use strict';
  const durationSeconds = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 20;
  const maxUtterances = (duration, mode = 'balanced') => mode !== 'quiet' && durationSeconds(duration) >= 20 ? 2 : 1;
  const restStepAllowed = (duration, step, mode = 'balanced') => step === 0 || step === 2 && maxUtterances(duration, mode) === 2;
  const api = Object.freeze({ restStepAllowed, maxUtterances });
  scope.BlinklyVoiceCadence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
