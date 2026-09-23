import React, { useEffect, useState } from "react";
import { api } from "./api";

export default function ModelPicker({ value, disabled = false, onSelected, compact = false }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try { setModels((await api("/api/models")).models); }
    catch (error) { setError(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); window.addEventListener("zentra:runtime-ready", refresh); return () => window.removeEventListener("zentra:runtime-ready", refresh); }, []);
  async function select(model) {
    setLoading(true); setError("");
    try { await api("/api/model/select", {model}); await onSelected?.(); }
    catch (error) { setError(error.message); }
    finally { setLoading(false); }
  }
  return <div className={`model-picker ${compact ? "compact" : ""}`}>
    <div className="model-picker-row">
      <select aria-label="Ollama model" value={value || ""} disabled={disabled || loading || !models.length} onChange={event => select(event.target.value)}>
        {!models.some(model => model.name === value) && <option value={value || ""}>{value || "Choose a local model"}</option>}
        {models.map(model => <option key={model.name} value={model.name}>{model.name}{!compact && model.size ? ` · ${(model.size / 1e9).toFixed(1)} GB` : ""}</option>)}
      </select>
      <button type="button" className="secondary" title="Refresh installed Ollama models" aria-label="Refresh installed Ollama models" disabled={disabled || loading} onClick={refresh}>{loading ? "…" : "↻"}</button>
    </div>
    {error && <small role="alert">{error}</small>}
    {!compact && !error && <small>Installed in Ollama. Your choice is saved for future requests; a running task keeps its original model.</small>}
  </div>;
}
