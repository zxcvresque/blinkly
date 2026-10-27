/* Responsive launch video: one player and one source download per screen size. */
(function (scope) {
  'use strict';
  function create({ video, frame, section, playButton, soundButton, media, reducedMotion = false,
    Observer = scope.IntersectionObserver, onPlay = () => {} }) {
    let manuallyPaused = false, inView = false, switching = false, resumeAt = 0, soundChosen = false;
    const attemptPlay = () => { void Promise.resolve(video.play()).catch(() => {}); };
    function updateControls() {
      playButton.textContent = video.paused ? 'Play' : 'Pause';
      playButton.setAttribute('aria-label', video.paused ? 'Play launch video' : 'Pause launch video');
      soundButton.textContent = video.muted ? 'Sound on' : 'Sound off';
      soundButton.setAttribute('aria-pressed', String(!video.muted));
    }
    function selectSource() {
      const layout = media.matches ? 'portrait' : 'landscape';
      const source = video.dataset[layout];
      if (video.getAttribute('src') === source) return;
      resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      switching = true;
      video.pause();
      section.hidden = false;
      section.querySelector('[data-video-error]').hidden = true;
      frame.dataset.layout = layout;
      frame.style.setProperty('--ar', layout === 'portrait' ? 9 / 16 : 16 / 9);
      video.poster = video.dataset[layout + 'Poster'];
      video.src = source;
      video.load();
    }
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) frame.style.setProperty('--ar', video.videoWidth / video.videoHeight);
      if (resumeAt > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - .1));
      switching = false;
      if (inView && !manuallyPaused && !reducedMotion) attemptPlay();
    });
    video.addEventListener('play', () => { updateControls(); onPlay(); });
    video.addEventListener('pause', updateControls);
    video.addEventListener('volumechange', updateControls);
    video.addEventListener('error', () => {
      switching = false;
      // Keep a usable link visible if a browser cannot decode the video.
      section.querySelector('[data-video-error]').hidden = false;
      updateControls();
    });
    playButton.addEventListener('click', () => {
      if (video.paused) { manuallyPaused = false; if (!soundChosen) video.muted = false; updateControls(); attemptPlay(); }
      else { manuallyPaused = true; video.pause(); }
    });
    soundButton.addEventListener('click', () => { soundChosen = true; video.muted = !video.muted; updateControls(); });
    if (media.addEventListener) media.addEventListener('change', selectSource);
    else media.addListener(selectSource);
    selectSource(); updateControls();
    if (Observer) new Observer(entries => {
      for (const entry of entries) {
        inView = entry.isIntersecting;
        if (!inView) video.pause();
        else if (!switching && !manuallyPaused && !reducedMotion) attemptPlay();
      }
    }, { threshold: .4 }).observe(frame);
    return Object.freeze({ pause() { manuallyPaused = true; video.pause(); } });
  }
  const api = Object.freeze({ create });
  scope.BlinklyLaunchVideo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
