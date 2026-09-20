export const appConstants = {
  appName: 'Local AI Agent',
  telemetry: {
    serviceName: 'local-ai-agent'
  }
};

export function statusMessage(message) {
  return {
    ok: true,
    message,
    timestamp: new Date().toISOString()
  };
}
