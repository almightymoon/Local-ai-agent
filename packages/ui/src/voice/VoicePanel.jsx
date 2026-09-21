import React from "react";
import LiveTranscript from "./LiveTranscript";

export default function VoicePanel({ state, partials }) {
  return (
    <div className="voice-panel composer-voice">
      <div className="voice-orb" aria-hidden>
        <div className={`orb ${state}`}></div>
      </div>
      <div className="voice-body">
        <h3>{state === "listening" ? "Listening…" : state === "speaking" ? "Speaking…" : state}</h3>
        <LiveTranscript partials={partials} />
      </div>
      <div className="voice-actions">
        <small className="muted">Tap the mic again to stop.</small>
      </div>
    </div>
  );
}
