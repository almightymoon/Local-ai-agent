export async function streamChat(message, onChunk) {
  const response = await fetch(`http://127.0.0.1:8000/api/chat/stream?message=${encodeURIComponent(message)}`);

  if (!response.ok) {
    throw new Error('Stream request failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  while (true) {
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
}
