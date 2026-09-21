const BASE = import.meta.env.VITE_AGENT_API_URL || "http://127.0.0.1:8000";
let token;
async function session() {
  if (!token) {
    const response = await fetch(`${BASE}/api/session`);
    if (!response.ok) throw new Error("Cannot connect to the local API.");
    token = (await response.json()).token;
  }
  return token;
}
export async function request(path, body, signal, retry = true) {
  const headers = { "X-Agent-Token": await session() };
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    signal,
  });
  if (response.status === 401 && retry) {
    token = null;
    return request(path, body, signal, false);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : error.error || `Request failed (${response.status}).`,
    );
  }
  return response;
}
export async function api(path, body) {
  return (await request(path, body)).json();
}
export async function tool(tool_name, args) {
  const result = await api("/api/tool/execute", { tool_name, arguments: args });
  if (result.status !== "ready") throw new Error(result.message);
  return result.result;
}
export async function stream(path, body, onEvent, signal) {
  const response = await request(path, body, signal);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (frame) => {
    const lines = frame.split("\n");
    const event = lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (event && data) onEvent(event, JSON.parse(data));
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      frames.forEach(dispatch);
      if (done) {
        if (buffer.trim()) dispatch(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
