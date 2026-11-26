(() => {
    'use strict';

    const AD_KEYS = [
        'adPlacements',
        'playerAds',
        'adSlots',
        'adBreakHeartbeatParams'
    ];

    function stripAds(obj) {
        if (!obj || typeof obj !== 'object') return obj;

        for (const key of AD_KEYS) {
            if (key in obj) {
                delete obj[key];
            }
        }

        if (obj.playerResponse && typeof obj.playerResponse === 'object') {
            stripAds(obj.playerResponse);
        }

        return obj;
    }

    // 1. Clean initial page load player data
    let initialPlayerResponse = window.ytInitialPlayerResponse;
    if (initialPlayerResponse) {
        stripAds(initialPlayerResponse);
    }

    try {
        Object.defineProperty(window, 'ytInitialPlayerResponse', {
            configurable: true,
            get() {
                return initialPlayerResponse;
            },
            set(value) {
                initialPlayerResponse = stripAds(value);
            }
        });
    } catch (e) {}

    // 2. Intercept fetch requests for video & mid-roll ad data
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);

        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

            if (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/ad_break')) {
                const clone = response.clone();
                const data = await clone.json();
                stripAds(data);

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch (e) {
            // Return original response if parsing fails
        }

        return response;
    };
})();