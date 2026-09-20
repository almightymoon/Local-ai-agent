const API_BASE = 'http://127.0.0.1:8000';

export async function postChat(message) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    throw new Error('Chat request failed');
  }

  return response.json();
}

export async function postToolExecution(toolName, argumentsObject = {}) {
  const response = await fetch(`${API_BASE}/api/tool/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_name: toolName, arguments: argumentsObject })
  });

  if (!response.ok) {
    throw new Error('Tool execution request failed');
  }

  return response.json();
}

export async function postToolApproval(toolName, approved, environment = 'prod') {
  const response = await fetch(`${API_BASE}/api/tool/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_name: toolName, approved, environment })
  });

  if (!response.ok) {
    throw new Error('Approval request failed');
  }

  return response.json();
}
