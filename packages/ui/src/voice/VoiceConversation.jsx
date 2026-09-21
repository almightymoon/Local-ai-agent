import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  createSpeechStreamer,
  enqueueSpeech,
  stopSpeaking,
  waitUntilSpeechDone,
} from "./speakLocal";

/**
 * ChatGPT-style hands-free voice conversation.
 *
 * - Auto end-of-speech (VAD) — no push-to-talk
 * - Speaks sentences as the reply streams (write + speak together)
 */
export default function VoiceConversation({
  open,
  onClose,
  voice,
  onSendTurn,
  busy,
}) {
  const [phase, setPhase] = useState("idle");
  const [caption, setCaption] = useState("");
  const [hint, setHint] = useState("Just start talking");
  const [error, setError] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const activeRef = useRef(false);
  const loopGen = useRef(0);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      activeRef.current = false;
      loopGen.current += 1;
      finishingRef.current = false;
      stopSpeaking();
      setPhase("idle");
      setCaption("");
      setHint("Just start talking");
      setError(null);
      setMinimized(false);
      return;
    }

    activeRef.current = true;
    setError(null);
    setMinimized(false);
    beginListen();
    return () => {
      activeRef.current = false;
      loopGen.current += 1;
      finishingRef.current = false;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (voice?.error && open) setError(voice.error);
  }, [voice?.error, open]);

  useEffect(() => {
    if (!open || phase !== "listening") return;
    if (voice?.hearingSpeech) {
      setHint("Hearing you… pause when you’re done");
    } else {
      setHint("Listening… just talk naturally");
    }
  }, [voice?.hearingSpeech, open, phase]);

  async function beginListen() {
    if (!activeRef.current) return;
    finishingRef.current = false;
    stopSpeaking();
    setError(null);
    setPhase("listening");
    setHint("Listening… just talk naturally");
    setCaption("");
    try {
      await voice.start({
        autoStop: true,
        onAutoStop: () => {
          if (!activeRef.current || finishingRef.current) return;
          finishTurn();
        },
      });
    } catch (err) {
      setPhase("error");
      setError(err?.message || "Could not start microphone.");
      setHint("Tap the orb to try again");
    }
  }

  async function finishTurn() {
    if (!activeRef.current || finishingRef.current) return;
    finishingRef.current = true;
    const gen = loopGen.current;

    setPhase("processing");
    setHint("Got it — processing…");
    let userText = "";
    try {
      userText = (await voice.stop()) || "";
    } catch (err) {
      finishingRef.current = false;
      setPhase("error");
      setError(err?.message || "Transcription failed.");
      setHint("Tap the orb to try again");
      return;
    }

    if (!activeRef.current || gen !== loopGen.current) return;

    if (!userText.trim()) {
      finishingRef.current = false;
      setError(voice?.error || null);
      setHint("Didn’t catch that — keep talking");
      await beginListen();
      return;
    }

    setCaption(userText);
    setPhase("thinking");
    setHint("Thinking… speaking starts as soon as I have words");

    stopSpeaking();
    let spokenStarted = false;
    let captionStarted = false;
    const streamer = createSpeechStreamer((sentence) => {
      if (!activeRef.current || gen !== loopGen.current) return;
      // Kick TTS before updating UI so speech leads writing.
      enqueueSpeech(sentence);
      if (!spokenStarted) {
        spokenStarted = true;
        setPhase("speaking");
        setHint("Speaking…");
      }
    });

    let reply = "";
    try {
      reply =
        (await onSendTurn(userText, {
          onDelta: (piece, fullText) => {
            if (!activeRef.current || gen !== loopGen.current) return;
            // Feed speech first.
            streamer.push(piece);
            // Show text once speech has started, or after a short lead of tokens.
            if (spokenStarted || fullText.length >= 24) {
              captionStarted = true;
              setCaption(fullText);
            } else if (!captionStarted) {
              // Keep showing the user utterance until speech kicks in.
              setCaption(userText);
            }
          },
        })) || "";
      streamer.flush();
    } catch (err) {
      if (!activeRef.current || gen !== loopGen.current) return;
      finishingRef.current = false;
      setPhase("error");
      setError(err?.message || "Conversation turn failed.");
      setHint("Tap the orb to try again");
      return;
    }

    if (!activeRef.current || gen !== loopGen.current) return;

    if (!reply.trim()) {
      finishingRef.current = false;
      setPhase("idle");
      setHint("No reply — start talking again");
      await beginListen();
      return;
    }

    setCaption(reply);
    setPhase("speaking");
    setHint("Speaking…");
    await waitUntilSpeechDone();

    if (!activeRef.current || gen !== loopGen.current) return;

    finishingRef.current = false;
    await beginListen();
  }

  async function onOrbClick() {
    if (!open) return;

    // Manual interrupt / force end-of-turn still available.
    if (phase === "listening") {
      await finishTurn();
      return;
    }

    if (phase === "speaking" || phase === "thinking") {
      stopSpeaking();
      try {
        // Abort in-flight chat if possible via parent busy stop — best effort.
      } catch {
        /* ignore */
      }
      finishingRef.current = false;
      await beginListen();
      return;
    }

    if (phase === "idle" || phase === "ready" || phase === "error") {
      await beginListen();
    }
  }

  async function endConversation() {
    activeRef.current = false;
    loopGen.current += 1;
    finishingRef.current = false;
    stopSpeaking();
    try {
      if (voice?.state === "listening" || voice?.state === "processing") {
        await voice.stop();
      }
    } catch {
      /* ignore */
    }
    onClose?.();
  }

  if (!open) return null;

  const orbClass = [
    "voice-call-orb",
    phase === "listening" ? "listening" : "",
    voice?.hearingSpeech ? "hearing" : "",
    phase === "processing" || phase === "thinking" ? "thinking" : "",
    phase === "speaking" ? "speaking" : "",
    phase === "error" ? "error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const phaseLabel =
    phase === "listening"
      ? voice?.hearingSpeech
        ? "Hearing you"
        : "Listening"
      : phase === "processing"
        ? "Processing"
        : phase === "thinking"
          ? "Thinking"
          : phase === "speaking"
            ? "Speaking"
            : phase === "error"
              ? "Error"
              : "Voice";

  if (minimized) {
    return (
      <div
        className="voice-call-mini"
        role="status"
        aria-label="Voice conversation minimized"
      >
        <button
          type="button"
          className={`voice-call-mini-orb ${phase} ${voice?.hearingSpeech ? "hearing" : ""}`}
          aria-label="Expand voice conversation"
          title="Expand voice conversation"
          onClick={() => setMinimized(false)}
        >
          <span className="voice-call-mini-core" />
        </button>
        <button
          type="button"
          className="voice-call-mini-label"
          onClick={() => setMinimized(false)}
        >
          <strong>{phaseLabel}</strong>
          <span>Tap to expand</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="End voice conversation"
          onClick={endConversation}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="voice-call" role="dialog" aria-label="Voice conversation">
      <div className="voice-call-top">
        <div className="voice-call-title">
          <Icon name="sound" size={16} />
          Voice conversation
        </div>
        <div className="voice-call-top-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Minimize voice conversation"
            title="Minimize"
            onClick={() => setMinimized(true)}
          >
            <Icon name="minimize" size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="End voice conversation"
            onClick={endConversation}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      <div className="voice-call-body">
        <button
          type="button"
          className={orbClass}
          aria-label={
            phase === "listening"
              ? "Force send now"
              : phase === "speaking"
                ? "Interrupt"
                : "Start listening"
          }
          onClick={onOrbClick}
          disabled={phase === "processing"}
        >
          <span className="voice-call-orb-core" />
          <span className="voice-call-orb-ring" />
          <span className="voice-call-orb-ring delay" />
        </button>

        <p className="voice-call-hint">{hint}</p>
        {caption ? (
          <p className="voice-call-caption" title={caption}>
            {caption.length > 280 ? `${caption.slice(0, 280)}…` : caption}
          </p>
        ) : null}
        {error ? <p className="voice-call-error">{error}</p> : null}
      </div>

      <div className="voice-call-actions">
        <button type="button" className="ghost" onClick={onOrbClick}>
          {phase === "listening"
            ? "Send now"
            : phase === "speaking" || phase === "thinking"
              ? "Interrupt"
              : "Listen"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setMinimized(true)}
        >
          Minimize
        </button>
        <button
          type="button"
          className="voice-call-end"
          onClick={endConversation}
        >
          End
        </button>
      </div>
    </div>
  );
}
