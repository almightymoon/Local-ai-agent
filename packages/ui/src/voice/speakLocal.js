/** Streaming neural TTS — batched chunks + aggressive prefetch to avoid long pauses. */

import { request } from "../api";

const VOICE_KEY = "zentra_tts_voice";
const RATE_KEY = "zentra_tts_rate";
const DEFAULT_VOICE = "en-US-JennyNeural";
const DEFAULT_RATE = "+40%";

let currentAudio = null;
let currentUrl = null;
/** @type {{ text: string, blobPromise: Promise<Blob|null> }[]} */
let queue = [];
let playing = false;
let stopped = false;

export function getTtsPreferences() {
  try {
    return {
      voice: localStorage.getItem(VOICE_KEY) || DEFAULT_VOICE,
      rate: localStorage.getItem(RATE_KEY) || DEFAULT_RATE,
    };
  } catch {
    return { voice: DEFAULT_VOICE, rate: DEFAULT_RATE };
  }
}

export function setTtsPreferences({ voice, rate } = {}) {
  try {
    if (voice) localStorage.setItem(VOICE_KEY, voice);
    if (rate) localStorage.setItem(RATE_KEY, rate);
  } catch {
    /* ignore quota / private mode */
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function stopSpeaking() {
  stopped = true;
  queue = [];
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
      currentAudio = null;
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch {
    /* ignore */
  }
  playing = false;
}

async function fetchTtsBlob(text) {
  const { voice, rate } = getTtsPreferences();
  const response = await request("/api/tts", { text, voice, rate });
  const blob = await response.blob();
  if (!blob || blob.size < 32) throw new Error("Empty TTS audio.");
  return blob;
}

function playBlob(blob) {
  return new Promise((resolve, reject) => {
    if (stopped) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    currentUrl = url;
    // Faster playback for snappy conversation.
    audio.playbackRate = 1.18;
    // Start next chunk with almost no gap.
    audio.onended = () => {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
        currentAudio = null;
      }
      resolve();
    };
    audio.onerror = () => {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
        currentAudio = null;
      }
      reject(new Error("Audio playback failed."));
    };
    audio.play().catch(reject);
  });
}

function speakViaBrowser(text, { rate = 1.15, pitch = 1 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      reject(new Error("Speech synthesis is not available in this browser."));
      return;
    }
    const utter = new SpeechSynthesisUtterance(text.slice(0, 4000));
    utter.rate = rate;
    utter.pitch = pitch;
    utter.lang = navigator.language || "en-US";
    const voices = window.speechSynthesis.getVoices?.() || [];
    const preferred =
      voices.find((v) => v.lang?.toLowerCase().startsWith("en")) || null;
    if (preferred) utter.voice = preferred;
    utter.onend = () => resolve();
    utter.onerror = (event) => {
      if (event?.error === "canceled" || event?.error === "interrupted") {
        resolve();
        return;
      }
      reject(new Error(event?.error || "Speech synthesis failed."));
    };
    window.speechSynthesis.speak(utter);
  });
}

async function playOne(item) {
  const cleaned = cleanText(item.text);
  if (!cleaned || stopped) return;
  try {
    const blob = await item.blobPromise;
    if (stopped) return;
    if (blob) {
      await playBlob(blob);
      return;
    }
    // Prefetch failed — fetch now.
    await playBlob(await fetchTtsBlob(cleaned));
  } catch (err) {
    console.warn("API TTS chunk failed, browser fallback:", err);
    if (!stopped) await speakViaBrowser(cleaned);
  }
}

async function pumpQueue() {
  if (playing) return;
  playing = true;
  while (queue.length && !stopped) {
    const next = queue.shift();
    try {
      await playOne(next);
    } catch (err) {
      console.warn("TTS playback error:", err);
    }
  }
  playing = false;
}

/** Enqueue text to speak ASAP (prefetch starts immediately). */
export function enqueueSpeech(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return;
  stopped = false;
  queue.push({
    text: cleaned,
    blobPromise: fetchTtsBlob(cleaned).catch(() => null),
  });
  pumpQueue();
}

/** Wait until the speech queue drains. */
export function waitUntilSpeechDone() {
  return new Promise((resolve) => {
    const tick = () => {
      if (stopped || (!playing && queue.length === 0)) {
        resolve();
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

/** Speak a full string (batched into larger chunks). */
export async function speakText(text) {
  stopSpeaking();
  stopped = false;
  const cleaned = cleanText(text);
  if (!cleaned) return;
  for (const part of batchForSpeech(cleaned)) enqueueSpeech(part);
  await waitUntilSpeechDone();
}

/** Merge short sentences so we don't pause at every period. */
export function batchForSpeech(text, { minChars = 140, maxChars = 280 } = {}) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
  const batches = [];
  let buf = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (!buf) {
      buf = s;
      continue;
    }
    if (buf.length + 1 + s.length <= maxChars && buf.length < minChars) {
      buf = `${buf} ${s}`;
    } else {
      batches.push(buf);
      buf = s;
    }
  }
  if (buf) batches.push(buf);
  return batches;
}

/**
 * Incremental streamer optimized for time-to-first-audio.
 * Speaks a short first chunk ASAP, then larger batches to avoid gaps.
 */
export function createSpeechStreamer(
  onChunk,
  { firstMinChars = 32, minChars = 85, maxChars = 200 } = {},
) {
  let buffer = "";
  let pending = "";
  let emitted = 0;

  function emit(piece) {
    const t = cleanText(piece);
    if (!t) return;
    onChunk(t);
    emitted += 1;
  }

  function threshold() {
    return emitted === 0 ? firstMinChars : minChars;
  }

  function push(delta) {
    if (!delta) return;
    buffer += delta;

    // First audio ASAP: speak at early comma/semicolon if we have enough words.
    if (emitted === 0) {
      const early = buffer.match(/^([\s\S]{28,90}?)[,;:]\s+/);
      if (early) {
        emit(early[1].trim());
        buffer = buffer.slice(early[0].length);
        pending = "";
      }
    }

    // Pull completed sentences.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const match = buffer.match(/^([\s\S]*?[.!?]+(?:["')\]]*)?)(\s+|$)/);
      if (!match) break;
      if (!match[2] && match[0].length < buffer.length) break;

      const sentence = match[1].trim();
      buffer = buffer.slice(match[0].length);
      if (!sentence) continue;

      // First sentence: speak immediately even if short.
      if (emitted === 0) {
        emit(sentence);
        pending = "";
        continue;
      }

      pending = pending ? `${pending} ${sentence}` : sentence;
      if (pending.length >= threshold()) {
        emit(pending);
        pending = "";
      }
    }

    // Hard cap for long run-ons without punctuation.
    const combined = `${pending} ${buffer}`.trim();
    const cap = emitted === 0 ? Math.max(48, firstMinChars + 16) : maxChars;
    if (combined.length >= cap) {
      const cutAt = combined.lastIndexOf(" ", cap);
      const idx = cutAt > 24 ? cutAt : cap;
      emit(combined.slice(0, idx));
      pending = "";
      buffer = combined.slice(idx).trim();
    }
  }

  function flush() {
    const rest = `${pending} ${buffer}`.trim();
    pending = "";
    buffer = "";
    if (rest) emit(rest);
    return emitted;
  }

  return {
    push,
    flush,
    get pending() {
      return `${pending} ${buffer}`.trim();
    },
  };
}
