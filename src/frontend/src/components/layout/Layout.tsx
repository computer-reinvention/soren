import { ReactNode } from 'react';
import { Header } from './Header';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: ReactNode;
  /** StatusBar on desktop, MobileNav on mobile — decided by the caller (Shell). */
  bottomBar: ReactNode;
}

export function Layout({ children, bottomBar }: LayoutProps) {
  // MobileNav (h-14) and StatusBar (h-8) reserve different amounts of space.
  const isMobile = useIsMobile();

  return (
    <div className="h-screen flex flex-col bg-background">
      <Header />
      <main className={cn('flex-1 overflow-hidden', isMobile ? 'pb-14' : 'pb-8')}>
        {children}
      </main>
      {bottomBar}
    </div>
  );
}
