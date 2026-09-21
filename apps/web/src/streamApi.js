export async function streamChat(message, onChunk, { signal } = {}) {
  const url = `http://127.0.0.1:8000/api/chat/stream?message=${encodeURIComponent(message)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error('Stream request failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  try {
    while (true) {
      if (signal && signal.aborted) {
        await reader.cancel();
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const eventMatch = part.match(/event:\s*(.+)/);
      const dataMatch = part.match(/data:\s*(.+)/);
      if (eventMatch && dataMatch) {
        onChunk({
          event: eventMatch[1].trim(),
          data: dataMatch[1].trim()
        });
      }
    }
    }
  } finally {
    try { await reader.releaseLock?.(); } catch (e) {}
  }
}
