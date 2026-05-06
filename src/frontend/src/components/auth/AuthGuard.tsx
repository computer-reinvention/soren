import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { LoginPage } from './LoginPage';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground font-mono text-sm">
          <div className="h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span>connecting...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
