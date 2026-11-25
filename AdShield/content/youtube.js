// YouTube: hide ad slots with CSS, and fast-forward / skip video ads while they play.
// YouTube changes its markup often, so expect to update these selectors.
(() => {
  'use strict';

  const HIDE = [
    '#masthead-ad', '#player-ads', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer',
    'ytd-banner-promo-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer',
    'ytd-display-ad-renderer', 'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer',
    '.ytp-ad-overlay-container', '.ytp-ad-image-overlay',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]'
  ].join(',');

  const SKIP_BUTTONS = [
    '.ytp-skip-ad-button', '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button'
  ].join(',');

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'adshield-youtube-style';
    style.textContent = `${HIDE}{display:none !important}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function watchAds() {
    let saved = null; // the person's own mute/speed settings, restored after the ad

    setInterval(() => {
      const player = document.querySelector('#movie_player');
      if (!player) return;
      const video = player.querySelector('video');
      const adPlaying = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');

      if (adPlaying && video) {
        if (!saved) {
          saved = { muted: video.muted, rate: video.playbackRate };
          chrome.runtime.sendMessage({ type: 'blocked', kind: 'youtube' }).catch(() => {});
        }
        video.muted = true;
        video.playbackRate = 16;
        if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) {
          try { video.currentTime = video.duration; } catch (_) {}
        }
        const skip = document.querySelector(SKIP_BUTTONS);
        if (skip) skip.click();
      } else if (saved && video) {
        video.muted = saved.muted;
        video.playbackRate = saved.rate;
        saved = null;
      }
    }, 250);
  }

  __adshield.settings.then((s) => {
    if (!s.active || !s.youtubeSkip) return;
    injectStyle();
    watchAds();
  });
})();
