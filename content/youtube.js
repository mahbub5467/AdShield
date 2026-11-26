(() => {
    'use strict';

    const ext = globalThis.browser ?? globalThis.chrome;

    if (!ext || !ext.runtime) {
        console.error('[AdShield] Extension API unavailable.');
        return;
    }

    // YouTube advertisement selectors
    const HIDE = [
        '#masthead-ad',
        '#player-ads',
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-banner-promo-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-promoted-video-renderer',
        'ytd-display-ad-renderer',
        'ytd-companion-slot-renderer',
        'ytd-action-companion-ad-renderer',
        '.ytp-ad-overlay-container',
        '.ytp-ad-image-overlay',
        '.ytp-ad-message-container',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)'
    ].join(',');

    // YouTube skip buttons
    const SKIP_BUTTONS = [
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-container button',
        'button.ytp-skip-ad-button'
    ].join(',');

    function sendMessage(message) {
        try {
            const result = ext.runtime.sendMessage(message);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch (error) {
            // Ignore communication errors
        }
    }

    function injectStyle() {
        if (document.getElementById('adshield-youtube-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'adshield-youtube-style';
        style.textContent = `
            ${HIDE} {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function watchAds() {
        let saved = null;
        let savedVideo = null;
        let adSince = 0;
        let gaveUp = false;
        let notified = false;
        let observedPlayer = null;
        let observedVideo = null;

        function isAdPlaying(player) {
            return (
                player.classList.contains('ad-showing') ||
                player.classList.contains('ad-interrupting')
            );
        }

        function restore() {
            if (!saved || !savedVideo) {
                saved = null;
                savedVideo = null;
                return;
            }

            try {
                savedVideo.muted = saved.muted;
                savedVideo.playbackRate = saved.rate;
            } catch (error) {
                console.warn('[AdShield] Restore failed:', error);
            }

            saved = null;
            savedVideo = null;
        }

        function processAd() {
            const player = document.querySelector('#movie_player');
            if (!player) return;

            const video = player.querySelector('video');
            if (!video) return;

            if (observedVideo !== video) {
                observedVideo = video;
                video.addEventListener('loadedmetadata', processAd);
                video.addEventListener('durationchange', processAd);
            }

            if (!isAdPlaying(player)) {
                adSince = 0;
                gaveUp = false;
                notified = false;
                restore();
                return;
            }

            if (gaveUp) return;

            if (!adSince) {
                adSince = Date.now();
            }

            // Safety timeout (40s)
            if (Date.now() - adSince > 40000) {
                gaveUp = true;
                restore();
                console.warn('[AdShield] Ad monitoring paused.');
                return;
            }

            // Save original video settings
            if (!saved || savedVideo !== video) {
                restore();
                saved = {
                    muted: video.muted,
                    rate: video.playbackRate
                };
                savedVideo = video;
            }

            // Notify background once per ad session
            if (!notified) {
                sendMessage({
                    type: 'blocked',
                    kind: 'youtube'
                });
                notified = true;
            }

            // 1. Mute ad immediately
            video.muted = true;

            // 2. Jump directly to the end of the ad
            if (isFinite(video.duration) && video.duration > 0) {
                try {
                    video.currentTime = video.duration;
                } catch (e) {}
            }

            // 3. Fallback: max playback speed
            try {
                video.playbackRate = 16;
            } catch (e) {}

            // 4. Click skip button if available
            const skip = player.querySelector(SKIP_BUTTONS);
            if (skip && !skip.disabled) {
                skip.click();
            }
        }

        const observer = new MutationObserver(() => processAd());

        function attachObserver() {
            const player = document.querySelector('#movie_player');
            if (player && player !== observedPlayer) {
                observer.disconnect();
                observedPlayer = player;
                observer.observe(player, {
                    attributes: true,
                    attributeFilter: ['class']
                });
                processAd();
            } else if (!player) {
                setTimeout(attachObserver, 500);
            }
        }

        attachObserver();

        window.addEventListener('yt-navigate-finish', () => {
            injectStyle();
            attachObserver();
        });

        setInterval(processAd, 100);
    }

    async function initialize() {
        try {
            if (!globalThis.__adshield?.settings) {
                console.error('[AdShield] Settings unavailable.');
                return;
            }

            const settings = await globalThis.__adshield.settings;
            if (!settings || !settings.active || !settings.youtubeSkip) {
                return;
            }

            injectStyle();
            watchAds();
            console.log('[AdShield] YouTube protection initialized.');
        } catch (error) {
            console.error('[AdShield] Initialization failed:', error);
        }
    }

    initialize();
})();