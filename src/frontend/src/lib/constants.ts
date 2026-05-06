// Use current origin for API calls - works with ngrok, localhost, or any host
const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:8000'; // Fallback for SSR/build
};

const getWsUrl = () => {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/agents/ws`;
  }
  return 'ws://localhost:8000/api/agents/ws'; // Fallback for SSR/build
};

export const API_BASE = getApiBase();
export const WS_URL = getWsUrl();

// WebSocket reconnection with exponential backoff
export const RECONNECT_DELAY_BASE = 1000; // Start at 1 second
export const RECONNECT_DELAY_MAX = 30000; // Cap at 30 seconds

// Legacy export for backwards compatibility
export const RECONNECT_DELAY = RECONNECT_DELAY_BASE;

export const MAX_ACTIVITIES = 500;
