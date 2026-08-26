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
    // `h-screen h-dvh`: dvh (dynamic viewport height) tracks the actually
    // visible viewport — shrinking when a mobile keyboard opens instead of
    // staying pinned to the pre-keyboard 100vh, which used to leave the
    // chat input/mobile nav rendered below the visible fold while typing.
    // `h-screen` stays as the fallback for browsers without dvh support
    // (tailwind-merge/cascade order makes the later dvh rule win when
    // it's supported, since it's a no-op declaration otherwise).
    // Left/right safe-area padding covers the landscape-notch case (the
    // manifest declares orientation "any", so this isn't hypothetical).
    <div className="h-screen h-dvh flex flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
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
        className={cn(
          'flex-1 overflow-hidden focus:outline-none',
          // Mobile's bottom bar is `fixed` and extends its own height by
          // env(safe-area-inset-bottom) (home-indicator clearance) — match
          // that here so content never sits underneath it.
          isMobile ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : 'pb-8'
        )}
      >
        {children}
      </main>
      {bottomBar}
    </div>
  );
}
