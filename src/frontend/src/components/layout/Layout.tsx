import { ReactNode } from 'react';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 overflow-hidden pb-8">
        {children}
      </main>
    </div>
  );
}
