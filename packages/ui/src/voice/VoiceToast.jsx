import React from "react";

export default function VoiceToast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="voice-toast">
      <div>{message}</div>
      <button onClick={onClose}>Dismiss</button>
    </div>
  );
}
