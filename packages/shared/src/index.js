export const appConstants = {
  appName: 'Zentra',
  telemetry: {
    serviceName: 'zentra'
  }
};

export function statusMessage(message) {
  return {
    ok: true,
    message,
    timestamp: new Date().toISOString()
  };
}
