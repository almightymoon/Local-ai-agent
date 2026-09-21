import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export default function useVoiceSession(conversationId, onFinal) {
  const wsRef = useRef(null);
  const [state, setState] = useState("idle");
  const [session, setSession] = useState(null);
  const [partials, setPartials] = useState("");
  const recorderRef = useRef(null);
  const mediaStreamRef = useRef(null);

  useEffect(() => {
    if (!conversationId) return;
    const init = async () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      // include session token as query param for WebSocket authentication
      let token = "";
      try {
        const tokenResp = await fetch(`/api/session`);
        token = await tokenResp.json().then((r) => r.token).catch(() => "");
      } catch (e) {
        token = "";
      }
      const url = `${protocol}//${host}/api/voice/session/${conversationId}?token=${encodeURIComponent(
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
      recorderRef.current = recorder;
      const chunks = [];
      recorder.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size) {
          // send binary chunk via websocket
          try {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const arrayBuffer = await ev.data.arrayBuffer();
              wsRef.current.send(arrayBuffer);
            }
          } catch (e) {
            console.warn("ws send failed", e);
          }
          // also upload to STT endpoint for partial transcription (server may return 501)
          try {
            const fd = new FormData();
            fd.append("file", ev.data, "chunk.webm");
            const result = await fetch(`${window.location.origin.replace(/^http/, 'http')}/api/stt/upload`, {
              method: "POST",
              body: fd,
              headers: { "X-Agent-Token": await (await fetch("/api/session")).json().then(r=>r.token) },
            }).then((r) => r.json());
            if (result && result.text) setPartials(result.text);
            else {
              // fallback: show a hint when server can't transcribe
              // keep partials unchanged
            }
          } catch (err) {
            // ignore partial failures
          }
          chunks.push(ev.data);
        }
      };
      recorder.start(3000); // request dataavailable every 3s
      setState("listening");
    } catch (err) {
      console.error("microphone error", err);
    }
  }

  async function stopRecording() {
    sendEvent("voice.stop");
    const recorder = recorderRef.current;
    if (recorder) {
      if (recorder.type === "recognition") {
        try {
          recorder.recog.stop();
        } catch (e) {}
      } else if (recorder.state && recorder.state !== "inactive") recorder.stop();
    }
    const stream = mediaStreamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    recorderRef.current = null;
    // final upload of last captured data by creating a new small recording
    try {
      // create a short silence file to trigger final transcription if needed
      // Instead, ask server to transcribe accumulated audio by reading partials as final
      const finalText = partials || "";
      sendEvent("stt.final", { text: finalText });
    } catch (err) {
      console.error(err);
    }
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
