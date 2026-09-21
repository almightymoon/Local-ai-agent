import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export default function useVoiceSession(conversationId, onFinal) {
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const [state, setState] = useState("idle");
  const [session, setSession] = useState(null);
  const [partials, setPartials] = useState("");
  const recorderRef = useRef(null);
  const mediaStreamRef = useRef(null);

  useEffect(() => {
    if (!conversationId) return;
    const init = async () => {
      // determine base API URL (prefer env var used by Vite/Electron)
      const API_BASE =
        (import.meta.env && import.meta.env.VITE_AGENT_API_URL) ||
        "http://127.0.0.1:8000";
      const WS_BASE = API_BASE.replace(/^http/, "ws");
      // include session token as query param for WebSocket authentication
      let token = "";
      try {
        const tokenResp = await fetch(`${API_BASE}/api/session`);
        token = await tokenResp.json().then((r) => r.token).catch(() => "");
      } catch (e) {
        token = "";
      }
      const url = `${WS_BASE}/api/voice/session/${conversationId}?token=${encodeURIComponent(
        token,
      )}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
    ws.onopen = () => {};
    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "voice.ready") {
          setSession(msg.data.session);
          setState(msg.data.session.state || "idle");
        }
        if (msg.event === "voice.state") {
          setState(msg.data.state);
        }
        if (msg.event === "stt.partial") {
          // keep partials as a string for simple placeholder display
          setPartials(msg.data.text || "");
        }
        if (msg.event === "error") {
          setError(msg.data?.message || "Voice error");
        }
        if (msg.event === "stt.final") {
          // final transcription arrived
          const finalText = msg.data?.text || "";
          setPartials("");
          try {
            if (onFinal && finalText) onFinal(finalText);
          } catch (e) {
            console.warn("onFinal callback failed", e);
          }
          // may contain assistant_response from server; play it via TTS if present
          const resp = msg.data?.assistant_response;
          if (resp && resp.response) {
            try {
              const tts = await api("/api/tts", { text: resp.response });
              const blob = await tts.blob();
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.onended = () => URL.revokeObjectURL(url);
              audio.play().catch(() => {});
            } catch (err) {
              // ignore TTS failures
              console.warn("TTS play failed", err);
            }
          }
        }
      } catch (err) {
        console.error("invalid ws msg", err);
      }
    };
      ws.onclose = () => setState("idle");
      ws.onerror = () => setState("error");
      ws.onclose = () => setState("idle");
      return () => {
        try {
          ws.close();
        } catch (e) {}
      };
    };
    init();
  }, [conversationId]);

  function sendEvent(event, payload = {}) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ event, ...payload }));
    } catch (e) {
      console.error(e);
    }
  }

  async function startRecording() {
    if (!wsRef.current) return;
    sendEvent("voice.start");
    try {
      // Prefer browser SpeechRecognition for live partials if available
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recog = new SpeechRecognition();
        recog.continuous = true;
        recog.interimResults = true;
        recog.lang = navigator.language || "en-US";
        recog.onresult = (ev) => {
          let interim = "";
          let final = "";
          for (let i = ev.resultIndex; i < ev.results.length; ++i) {
            const res = ev.results[i];
            if (res.isFinal) final += res[0].transcript;
            else interim += res[0].transcript;
          }
          if (interim) setPartials(interim);
          if (final) {
            setPartials("");
            sendEvent("stt.final", { text: final });
          }
        };
        recog.onerror = (e) => {
          console.warn("SpeechRecognition error", e);
        };
        recog.start();
        recorderRef.current = { type: "recognition", recog };
        setState("listening");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      // use MediaRecorder to collect small chunks and send binary frames over WS
      recorderRef.current = { recorder, chunks: [] };
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const arrayBuffer = reader.result;
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(arrayBuffer);
              }
            } catch (e) {
              console.error('ws send chunk failed', e);
            }
          };
          reader.readAsArrayBuffer(ev.data);
        }
      };
      recorder.start(250); // emit chunks frequently
      setState("listening");
    } catch (err) {
      console.error("microphone error", err);
    }
  }

  async function stopRecording() {
    // signal stop to server and await stt.final event before inserting text
    sendEvent("voice.stop");
    const rcur = recorderRef.current;
    if (rcur) {
      if (rcur.type === "recognition") {
        try {
          rcur.recog.stop();
        } catch (e) {}
      } else if (rcur.recorder && rcur.recorder.state && rcur.recorder.state !== "inactive") {
        try {
          rcur.recorder.stop();
        } catch (e) {}
      }
    }
    const stream = mediaStreamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    // clear recorderRef but let server send stt.final; onFinal will be called when ws receives it
    recorderRef.current = null;
    setState("idle");
  }

  return {
    state,
    session,
    partials,
    start: startRecording,
    stop: stopRecording,
    sendFinalTranscription: (text) => sendEvent("stt.final", { text }),
  };
}
