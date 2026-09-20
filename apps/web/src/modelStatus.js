export async function fetchModelStatus() {
  const response = await fetch('http://127.0.0.1:8000/api/model/status');
  if (!response.ok) {
    throw new Error('Model status request failed');
  }
  return response.json();
}
