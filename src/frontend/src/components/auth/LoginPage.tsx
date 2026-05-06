import { useState } from 'react';
import { Terminal } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

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
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-lg border border-border/50 bg-card">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <Terminal className="h-8 w-8 text-emerald-500" strokeWidth={2.5} />
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 bg-emerald-500 rounded-full animate-pulse" />
          </div>
          <span className="font-mono font-bold text-xl tracking-tight">soren</span>
          <span className="text-xs text-muted-foreground font-mono">multi-agent orchestrator</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground" htmlFor="username">
              username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground" htmlFor="password">
              password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          {error && (
            <p className="text-xs text-red-500 font-mono">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-mono font-medium text-white transition-colors"
          >
            {loading ? 'signing in...' : 'sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
