import { ReactNode } from 'react';
import { Header } from './Header';
import { OfflineBanner } from '@/components/status/OfflineBanner';
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
      {/* Skip link (P5.8) — first focusable element in the DOM, invisible
          until focused. Targets #main-content below, which Shell() also
          re-focuses on route change so keyboard/screen-reader users aren't
          silently left on a stale focus point after navigating. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <Header />
      <OfflineBanner />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn('flex-1 overflow-hidden focus:outline-none', isMobile ? 'pb-14' : 'pb-8')}
      >
        {children}
      </main>
      {bottomBar}
    </div>
  );
}
