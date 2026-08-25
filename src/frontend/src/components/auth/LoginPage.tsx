import { useState } from 'react';
import { Terminal, Loader2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

/**
 * P6.4 — brought onto the same component primitives (Input, Button) the
 * rest of the app already uses instead of raw <input>/<button>, and the
 * same loading-spinner / error-banner conventions as ChatInput and
 * SecretsPanel. The branding (Terminal glyph + pulsing dot + "soren") was
 * already shared verbatim with Header.tsx's logo, so that part is
 * untouched — it was already consistent with the design system.
 *
 * SSO / API-key auth (mentioned as an option in the original plan) is
 * deliberately NOT added here: the backend only implements username/
 * password login (src/server/routes/auth.py has no SSO or API-key
 * routes at all). Inventing a new auth strategy as a side effect of a
 * login-page visual redesign would be a real security-surface change
 * that deserves its own deliberate design, not a drive-by addition here.
 */
export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-lg border border-border/50 bg-card shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <Terminal className="h-8 w-8 text-emerald-700 dark:text-emerald-500" strokeWidth={2.5} />
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 bg-emerald-500 rounded-full animate-pulse motion-reduce:animate-none" />
          </div>
          <span className="font-mono font-bold text-xl tracking-tight">soren</span>
          <span className="text-xs text-muted-foreground font-mono">multi-agent orchestrator</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground" htmlFor="username">
              username
            </label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              required
              autoFocus
              disabled={loading}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-9 font-mono text-sm focus-visible:ring-emerald-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground" htmlFor="password">
              password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 font-mono text-sm focus-visible:ring-emerald-500"
            />
          </div>
          {error && (
            <div role="alert" className="flex items-center gap-1.5 text-xs text-red-500 font-mono">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="w-full h-9 bg-emerald-600 hover:bg-emerald-500 text-sm font-mono font-medium text-white"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                signing in...
              </>
            ) : (
              'sign in'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
