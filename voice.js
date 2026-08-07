/* ============================================================
   voice.js
   ------------------------------------------------------------
   Modular Voice Navigation system for the Commute Guide (CGPH).

   Listens to events emitted by route.js:
     - cgph:guideStarted
     - cgph:stepChanged
     - cgph:guideFinished

   Uses the native browser SpeechSynthesis API only.
   No external libraries, no inline HTML, no CSS changes here.

   Public API (attached to window.CGPH_VOICE):
     enable()
     disable()
     speak(text)
     stop()
     isEnabled()

   Author: Commute Guide PH
   ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. CONFIGURATION
     ---------------------------------------------------------- */

  const CONFIG = {
    // localStorage key used to remember the user's voice preference
    storageKey: "cgph_voice_enabled",

    // Default speech settings
    rate: 1,
    pitch: 1,
    volume: 1,

    // Preferred language list, in priority order.
    // Designed so a Tagalog (e.g. "fil-PH" / "tl-PH") entry can be
    // added later without touching any other part of this file.
    languagePreferences: ["en-PH", "en-US"],

    // Button element that toggles voice on/off (already exists in home.html)
    toggleButtonId: "voiceToggleBtn",

    // Text/icon shown on the toggle button for each state.
    // Adjust freely without affecting logic.
    toggleLabels: {
      on: "🔊 Voice On",
      off: "🔇 Voice Off"
    }
  };

  /* ----------------------------------------------------------
     2. FEATURE DETECTION
     ---------------------------------------------------------- */

  const isSpeechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const synth = isSpeechSupported ? window.speechSynthesis : null;

  /* ----------------------------------------------------------
     3. INTERNAL STATE
     ---------------------------------------------------------- */

  const state = {
    enabled: loadPreference(),
    voicesReady: false,
    selectedVoice: null,
    pendingUtterance: null
  };

  /* ----------------------------------------------------------
     4. PREFERENCE STORAGE (localStorage)
     ---------------------------------------------------------- */

  function loadPreference() {
    try {
      const saved = window.localStorage.getItem(CONFIG.storageKey);
      // Default to ON the first time a user visits (saved === null)
      return saved === null ? true : saved === "true";
    } catch (err) {
      // localStorage may be unavailable (private mode, etc.)
      console.warn("[CGPH_VOICE] localStorage unavailable, defaulting to ON.", err);
      return true;
    }
  }

  function savePreference(value) {
    try {
      window.localStorage.setItem(CONFIG.storageKey, String(value));
    } catch (err) {
      console.warn("[CGPH_VOICE] Could not save voice preference.", err);
    }
  }

  /* ----------------------------------------------------------
     5. VOICE SELECTION
     ---------------------------------------------------------- */

  // Voices can load asynchronously in some browsers, so we listen
  // for the 'voiceschanged' event and also try immediately.
  function refreshVoices() {
    if (!isSpeechSupported) return;

    const voices = synth.getVoices();
    if (!voices || voices.length === 0) {
      state.voicesReady = false;
      return;
    }

    state.voicesReady = true;
    state.selectedVoice = pickBestVoice(voices);
  }

  // Picks the best available voice based on CONFIG.languagePreferences.
  // Falls back to the browser default voice if nothing matches.
  function pickBestVoice(voices) {
    for (const lang of CONFIG.languagePreferences) {
      const match = voices.find(
        (v) => v.lang && v.lang.toLowerCase() === lang.toLowerCase()
      );
      if (match) return match;
    }

    // Loose match: same base language (e.g. "en") if exact tag not found
    for (const lang of CONFIG.languagePreferences) {
      const base = lang.split("-")[0].toLowerCase();
      const match = voices.find(
        (v) => v.lang && v.lang.toLowerCase().startsWith(base)
      );
      if (match) return match;
    }

    // Last resort: browser default voice (or null, handled by speak())
    return voices.find((v) => v.default) || voices[0] || null;
  }

  if (isSpeechSupported) {
    refreshVoices();
    // Some browsers (Chrome) populate voices asynchronously.
    synth.addEventListener("voiceschanged", refreshVoices);
  }

  /* ----------------------------------------------------------
     6. CORE SPEECH FUNCTIONS
     ---------------------------------------------------------- */

  // Cancels any speech currently playing or queued.
  function stopSpeaking() {
    if (!isSpeechSupported) return;
    try {
      synth.cancel();
    } catch (err) {
      console.warn("[CGPH_VOICE] Failed to cancel speech.", err);
    }
  }

  // Speaks the given text if voice is enabled and supported.
  // Always cancels prior speech first to avoid overlapping audio
  // (important when the user rapidly presses "Next Step").
  function speak(text) {
    if (!text || typeof text !== "string") return;

    if (!isSpeechSupported) {
      console.warn("[CGPH_VOICE] SpeechSynthesis is not supported in this browser.");
      return;
    }

    if (!state.enabled) {
      // Respect the user's preference: do nothing.
      return;
    }

    // Prevent overlapping utterances.
    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = CONFIG.rate;
    utterance.pitch = CONFIG.pitch;
    utterance.volume = CONFIG.volume;

    // Use the best available voice; if voices aren't loaded yet,
    // the browser will fall back to its own default voice.
    if (state.voicesReady && state.selectedVoice) {
      utterance.voice = state.selectedVoice;
      utterance.lang = state.selectedVoice.lang;
    } else {
      // Voices still loading — set a language hint so the browser
      // at least attempts the correct accent/locale.
      utterance.lang = CONFIG.languagePreferences[0];
      // Try one more refresh in case voices just became available.
      refreshVoices();
    }

state.pendingUtterance = utterance;

utterance.onend = function () {

    if (
        window.CGPH_ROUTE &&
        window.CGPH_ROUTE.getCurrentTrip()
    ) {

        const trip = window.CGPH_ROUTE.getCurrentTrip();

        if (trip.guideActive) {
            window.CGPH_ROUTE.nextStep();
        }

    }

};

synth.speak(utterance);

} // <-- end of speak()
  /* ----------------------------------------------------------
     7. ENABLE / DISABLE / TOGGLE
     ---------------------------------------------------------- */

  function enableVoice() {
    state.enabled = true;
    savePreference(true);
    updateToggleButton();
  }

  function disableVoice() {
    state.enabled = false;
    savePreference(false);
    stopSpeaking();
    updateToggleButton();
  }

  function toggleVoice() {
    if (state.enabled) {
      disableVoice();
    } else {
      enableVoice();
    }
  }

  function isEnabled() {
    return state.enabled;
  }

  /* ----------------------------------------------------------
     8. TOGGLE BUTTON WIRING (#voiceToggleBtn)
     ---------------------------------------------------------- */

  function updateToggleButton() {
    const btn = document.getElementById(CONFIG.toggleButtonId);
    if (!btn) return; // Button may not exist on every page — fail silently.

    btn.textContent = state.enabled
      ? CONFIG.toggleLabels.on
      : CONFIG.toggleLabels.off;

    // Reflect state for accessibility tools / CSS hooks if needed.
    btn.setAttribute("aria-pressed", String(state.enabled));
    btn.setAttribute(
      "data-voice-state",
      state.enabled ? "on" : "off"
    );
  }

  function wireToggleButton() {
    const btn = document.getElementById(CONFIG.toggleButtonId);
    if (!btn) {
      console.warn(
        `[CGPH_VOICE] #${CONFIG.toggleButtonId} not found. ` +
        "Voice toggle button will not be interactive until it exists."
      );
      return;
    }

    btn.addEventListener("click", toggleVoice);
    updateToggleButton(); // Set initial label based on saved preference.
  }

  /* ----------------------------------------------------------
     9. INSTRUCTION TEXT BUILDER
     ---------------------------------------------------------- */

  // route.js may emit its step data in slightly different shapes
  // depending on future changes. This helper looks for the most
  // common fields first, so voice.js keeps working without edits
  // if route.js is extended later.
  function extractInstructionText(detail) {
    if (!detail) return null;

    // Plain string detail: cgph:stepChanged fired with a string directly.
    if (typeof detail === "string") return detail;

    // Common field names route.js might use for the spoken instruction.
    const candidates = [
      detail.instruction,
      detail.text,
      detail.message,
      detail.step && detail.step.instruction,
      detail.step && detail.step.text
    ];

    const found = candidates.find(
      (val) => typeof val === "string" && val.trim().length > 0
    );

    return found || null;
  }

  // Determines whether the current step is the final one, using
  // whichever fields route.js provides (best-effort, non-breaking).
  function isFinalStep(detail) {
    if (!detail || typeof detail !== "object") return false;

    if (typeof detail.isLast === "boolean") return detail.isLast;
    if (typeof detail.final === "boolean") return detail.final;

    if (
      typeof detail.index === "number" &&
      typeof detail.total === "number"
    ) {
      return detail.index >= detail.total - 1;
    }

    return false;
  }

  /* ----------------------------------------------------------
     10. ROUTE.JS EVENT LISTENERS
     ---------------------------------------------------------- */

  function handleGuideStarted() {
    speak("Your commute guide has started.");
  }

  function handleStepChanged(event) {
    const detail = event && event.detail;
    const instruction = extractInstructionText(detail);

    if (instruction) {
      speak(instruction);
    }

    // Some route.js versions may never fire a separate
    // "guideFinished" event and instead mark the last step
    // via stepChanged detail. Handle both gracefully.
    if (isFinalStep(detail)) {
      speak("You have arrived at your destination. Have a safe day!");
    }
  }

  function handleGuideFinished() {
    speak("You have arrived at your destination. Have a safe day!");
  }

  function wireRouteEvents() {
    document.addEventListener("cgph:guideStarted", handleGuideStarted);
    document.addEventListener("cgph:stepChanged", handleStepChanged);
    document.addEventListener("cgph:guideFinished", handleGuideFinished);
  }

  /* ----------------------------------------------------------
     11. INITIALIZATION
     ---------------------------------------------------------- */

  function init() {
    wireToggleButton();
    wireRouteEvents();
  }

  // Run init once the DOM is ready (voice.js may be loaded with
  // "defer" or placed before the closing </body> tag).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ----------------------------------------------------------
     12. PUBLIC API
     ---------------------------------------------------------- */

  window.CGPH_VOICE = {
    enable: enableVoice,
    disable: disableVoice,
    speak: speak,
    stop: stopSpeaking,
    isEnabled: isEnabled
  };
})();
