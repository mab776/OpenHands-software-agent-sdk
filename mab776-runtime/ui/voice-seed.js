/* OpenHands dictation: pre-fill the speech-to-text address on the HTTPS page. (2026-10-20)
   The canvas (>= 1.26) shows the composer's mic button only once Settings > Application > Voice input has a
   transcription address, kept per browser (localStorage `openhands-transcription-endpoint`). On the :8446 page
   (caddy: /stt/* -> parakeet-asr, same origin, so no mixed content / CORS) that address is always the same,
   so seed it when the browser has none. Never overwrites a choice you made in Settings. The mic itself needs
   this https page: browsers hide getUserMedia on plain http://192.168.0.70:3003. */
(() => {
  try {
    if (location.protocol !== 'https:' || location.port !== '8446') return;
    const KEY = 'openhands-transcription-endpoint';
    let cur = {};
    try { cur = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { cur = {}; }
    if (cur.baseUrl) return;
    localStorage.setItem(KEY, JSON.stringify({ ...cur, baseUrl: location.origin + '/stt/v1', model: cur.model || 'whisper-1' }));
  } catch (e) { /* storage blocked: the Settings field still works */ }
})();
