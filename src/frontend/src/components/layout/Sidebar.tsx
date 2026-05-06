import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  children: ReactNode;
  className?: string;
  position?: 'left' | 'right';
}

export function Sidebar({ children, className, position = 'left' }: SidebarProps) {
  return (
    <aside
      className={cn(
        'h-full overflow-hidden flex flex-col',
        position === 'left' ? 'border-r' : 'border-l',
        className
      )}
    >
      {children}
    </aside>
  );
}
