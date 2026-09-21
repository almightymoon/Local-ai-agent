import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, request } from "../api";

/**
 * Voice session hook — complete-utterance STT via MediaRecorder + Whisper.
 *
 * Supports optional energy VAD auto-stop for hands-free conversation mode.
 */

const VAD = {
  // Catch quieter speech; wait longer after you pause so we don't cut mid-thought.
  speechThreshold: 0.012,
  silenceThreshold: 0.007,
  minSpeechMs: 280,
  silenceMs: 1400,
  maxUtteranceMs: 45000,
  pollMs: 40,
};

export default function useVoiceSession(conversationId, onFinal) {
  const [error, setError] = useState(null);
  const [state, setState] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [partials, setPartials] = useState("");
  const [sttStatus, setSttStatus] = useState(null);
  const [hearingSpeech, setHearingSpeech] = useState(false);
  const recorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const onFinalRef = useRef(onFinal);
  const vadRef = useRef(null);
  const autoStopRef = useRef(false);
  const stoppingRef = useRef(false);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const refreshStatus = useCallback(async () => {
    try {
      const resp = await request("/api/voice/status");
      const data = await resp.json();
      setSttStatus(data.stt || null);
      if (!data.ok || data.stt?.state === "error") {
        const msg =
          data.stt?.error ||
          "Local speech-to-text provider is unavailable.";
        setError(msg);
        setState("unavailable");
        return data;
      }
      return data;
    } catch (err) {
      const msg = err?.message || "Unable to reach voice API.";
      setError(msg);
      setState("unavailable");
      return null;
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, conversationId]);

  function pickMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
      return "";
    }
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  function stopVad() {
    const vad = vadRef.current;
    vadRef.current = null;
    setHearingSpeech(false);
    if (!vad) return;
    try {
      if (vad.timer) clearInterval(vad.timer);
      vad.source?.disconnect();
      vad.analyser?.disconnect();
      vad.audioCtx?.close?.();
    } catch {
      /* ignore */
    }
  }

  function startVad(stream, onSilenceEnd) {
    stopVad();
    let audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);

    const startedAt = Date.now();
    let speechStartedAt = 0;
    let lastSpeechAt = 0;
    let heardSpeech = false;

    const timer = setInterval(() => {
      if (stoppingRef.current) return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();

      if (rms >= VAD.speechThreshold) {
        if (!heardSpeech) {
          heardSpeech = true;
          speechStartedAt = now;
          setHearingSpeech(true);
          setStatusMessage("Hearing you…");
        }
        lastSpeechAt = now;
      } else if (heardSpeech && rms < VAD.silenceThreshold) {
        const spokeLongEnough = now - speechStartedAt >= VAD.minSpeechMs;
        const silentLongEnough = now - lastSpeechAt >= VAD.silenceMs;
        if (spokeLongEnough && silentLongEnough) {
          stopVad();
          onSilenceEnd?.();
          return;
        }
      }

      if (now - startedAt >= VAD.maxUtteranceMs) {
        stopVad();
        onSilenceEnd?.();
      }
    }, VAD.pollMs);

    vadRef.current = { audioCtx, source, analyser, timer };
  }

  async function uploadRecording(blob) {
    setState("processing");
    setStatusMessage("Processing speech...");
    setPartials("");

    if (sttStatus?.state === "not_loaded" || sttStatus?.state === "loading") {
      setStatusMessage("Preparing local speech recognition...");
    }

    const form = new FormData();
    const filename =
      blob.type && blob.type.includes("ogg")
        ? "recording.ogg"
        : blob.type && blob.type.includes("mp4")
          ? "recording.m4a"
          : "recording.webm";
    form.append("file", blob, filename);

    const response = await request("/api/stt/upload", form);
    const result = await response.json();
    const text = (result.text || "").trim();

    if (!text) {
      setState("error");
      setStatusMessage("");
      setError("No speech detected. Please try again.");
      return "";
    }

    setState("ready");
    setStatusMessage("Transcript ready");
    setError(null);
    try {
      if (onFinalRef.current) onFinalRef.current(text);
    } catch (err) {
      console.warn("onFinal callback failed", err);
      setError(err?.message || "Failed to apply transcript.");
    }
    refreshStatus();
    return text;
  }

  async function startRecording(options = {}) {
    const { autoStop = false, onAutoStop = null } = options;
    autoStopRef.current = !!autoStop;
    stoppingRef.current = false;
    setError(null);
    setPartials("");
    setStatusMessage("");
    setHearingSpeech(false);

    const status = await refreshStatus();
    if (!status?.ok) {
      setState("unavailable");
      setError(
        status?.stt?.error ||
          "Local speech-to-text provider is unavailable.",
      );
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setState("error");
      setError("MediaRecorder is not supported in this browser.");
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          // noiseSuppression can distort speech and hurt Whisper accuracy.
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
    } catch (err) {
      setState("denied");
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone permission denied."
          : `Microphone error: ${err?.message || err}`,
      );
      return;
    }

    mediaStreamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    let recorder;
    try {
      const recorderOpts = { audioBitsPerSecond: 192000 };
      if (mimeType) recorderOpts.mimeType = mimeType;
      try {
        recorder = new MediaRecorder(stream, recorderOpts);
      } catch {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      }
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      setState("error");
      setError(`Could not start recorder: ${err?.message || err}`);
      return;
    }

    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      const msg = event?.error?.message || "MediaRecorder error.";
      setError(msg);
      setState("error");
    };

    try {
      recorder.start(250);
      setState("listening");
      setStatusMessage(
        autoStop ? "Listening… I’ll catch when you pause" : "Listening...",
      );

      if (autoStop) {
        startVad(stream, () => {
          if (stoppingRef.current) return;
          if (typeof onAutoStop === "function") onAutoStop();
        });
      }
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      recorderRef.current = null;
      setState("error");
      setError(`Could not start recording: ${err?.message || err}`);
    }
  }

  async function stopRecording() {
    if (stoppingRef.current) return "";
    stoppingRef.current = true;
    stopVad();

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      const stream = mediaStreamRef.current;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      setState((s) => (s === "listening" ? "idle" : s));
      stoppingRef.current = false;
      return "";
    }

    setState("processing");
    setStatusMessage("Processing speech...");

    let transcript = "";
    await new Promise((resolve) => {
      const finish = async () => {
        try {
          const mime =
            recorder.mimeType ||
            (chunksRef.current[0] && chunksRef.current[0].type) ||
            "audio/webm";
          const blob = new Blob(chunksRef.current, { type: mime });
          chunksRef.current = [];
          transcript = (await uploadRecording(blob)) || "";
        } catch (err) {
          console.error("STT upload failed", err);
          setState("error");
          setStatusMessage("");
          setError(err?.message || "Speech transcription failed.");
        } finally {
          const stream = mediaStreamRef.current;
          if (stream) stream.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
          recorderRef.current = null;
          stoppingRef.current = false;
          resolve();
        }
      };

      recorder.onstop = finish;
      try {
        recorder.stop();
      } catch (err) {
        setError(err?.message || "Failed to stop recorder.");
        setState("error");
        stoppingRef.current = false;
        resolve();
      }
    });
    return transcript;
  }

  return {
    state,
    error,
    statusMessage,
    partials,
    sttStatus,
    hearingSpeech,
    apiBase: API_BASE,
    start: startRecording,
    stop: stopRecording,
    clearError: () => setError(null),
    refreshStatus,
  };
}
