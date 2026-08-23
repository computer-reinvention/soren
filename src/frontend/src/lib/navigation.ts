import { useMatch } from 'react-router-dom';

/**
 * Route path builders — the single source of truth for URL shapes.
 *
 * Selection state (which agent/file/archive is open, which center tab is
 * active) lives in the URL, not in stores. Deep links, browser history, and
 * refresh all work for free, and there is no cross-store selection syncing.
 */
export const routes = {
  overview: () => '/',
  chat: () => '/chat',
  agent: (agentId: string) => `/agents/${encodeURIComponent(agentId)}`,
  archived: (archiveId: string) => `/archived/${encodeURIComponent(archiveId)}`,
  /** File paths keep their slashes readable in the URL. */
  file: (path: string) =>
    `/files/${path.split('/').map(encodeURIComponent).join('/')}`,
  terminal: () => '/terminal',
  tasks: () => '/tasks',
} as const;

/** Decode a /files/* splat back into a filesystem path. */
export function decodeFileSplat(splat: string): string {
  return splat.split('/').map(decodeURIComponent).join('/');
}

/**
 * The agent id currently selected via the URL, readable from ANY component
 * under the Router (unlike useParams, which only sees the matched route's own
 * params). Right-rail panels use this to stay in sync with the center view.
 */
export function useRouteAgentId(): string | null {
  const match = useMatch('/agents/:agentId');
  return match?.params.agentId ? decodeURIComponent(match.params.agentId) : null;
}
