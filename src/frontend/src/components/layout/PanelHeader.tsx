import { cn } from '@/lib/utils';

interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
  actions?: React.ReactNode;
}

export function PanelHeader({ title, subtitle, className, actions }: PanelHeaderProps) {
  return (
    <div className={cn('px-3 py-2 border-b bg-sidebar-background', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/80 dark:text-sidebar-foreground/90">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
    </div>
  );
}
