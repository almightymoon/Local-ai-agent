import React from "react";

export default function VoiceButton({ recording, onClick }) {
  return (
    <button
      type="button"
      className={`icon-button ${recording ? "recording" : ""}`}
      aria-label={recording ? "Stop recording" : "Dictate a message"}
      onClick={onClick}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 11v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
