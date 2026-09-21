import React from "react";

export default function LiveTranscript({ partials }) {
  return (
    <div className="live-transcript">
      <p>{partials || " "}</p>
    </div>
  );
}
