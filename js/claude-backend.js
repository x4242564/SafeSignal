// Talks to the local Express server (server.js) so the app can screen
// messages when it isn't running inside Claude Code (no window.claude).

export async function backendReachable() {
  try {
    const response = await fetch('/api/health');
    return response.ok;
  } catch {
    return false;
  }
}

async function requestScreen(prompt, modelTier, signal) {
  let response;
  try {
    response = await fetch('/api/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, modelTier }),
      signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw { code: 'cancelled' };
    throw { code: 'server_unreachable' };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw { code: 'upstream_error' };
  }

  if (!response.ok) {
    throw { code: (data && data.error && data.error.code) || 'upstream_error' };
  }

  return data.result;
}

export function createBackendSample() {
  return {
    json: (prompt, { modelTier, signal } = {}) => requestScreen(prompt, modelTier, signal)
  };
}
