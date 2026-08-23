import { useEffect, useRef } from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useLayoutStore, PANEL_BOUNDS } from '@/stores/layoutStore';

/**
 * react-resizable-panels v4 computes the second handle's aria range by
 * varying the FIRST panel while holding others fixed, assigning the
 * endpoints in visual order — which inverts valuemin/valuemax whenever the
 * controlled panel shrinks as its neighbour grows. Screen readers reject
 * ranges where min > max, so we normalize the attributes post-render.
 * Self-guarding: our own swap produces min <= max, which the observer
 * ignores, so there is no mutation loop.
 */
function useNormalizedSeparatorAria() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const normalize = (el: Element) => {
      const min = parseFloat(el.getAttribute('aria-valuemin') ?? '');
      const max = parseFloat(el.getAttribute('aria-valuemax') ?? '');
      if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        el.setAttribute('aria-valuemin', String(max));
        el.setAttribute('aria-valuemax', String(min));
      }
    };

    const normalizeAll = () =>
      container.querySelectorAll('[role="separator"]').forEach(normalize);

    normalizeAll();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target instanceof Element && m.target.getAttribute('role') === 'separator') {
          normalize(m.target);
        }
      }
    });
    observer.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-valuemin', 'aria-valuemax'],
    });
    return () => observer.disconnect();
  }, []);

  return containerRef;
}

interface ResizableLayoutProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

// Constraint bounds are owned by layoutStore (PANEL_BOUNDS) so persisted
// sizes are clamped against the SAME values they're validated with here —
// a stale persisted size can otherwise invert the separator ARIA ranges.
const { LEFT_MIN, LEFT_MAX, RIGHT_MIN, RIGHT_MAX, CENTER_MIN, COLLAPSED_SIZE } = PANEL_BOUNDS;

export function ResizableLayout({ left, center, right }: ResizableLayoutProps) {
  const {
    leftPanelSize,
    rightPanelSize,
    activityPanelCollapsed,
    setLeftPanelSize,
    setRightPanelSize
  } = useLayoutStore();
  const containerRef = useNormalizedSeparatorAria();

  const effectiveRightMin = activityPanelCollapsed ? COLLAPSED_SIZE : RIGHT_MIN;
  const effectiveRightMax = activityPanelCollapsed ? COLLAPSED_SIZE : RIGHT_MAX;
  const effectiveRightSize = activityPanelCollapsed ? COLLAPSED_SIZE : rightPanelSize;

  // Center max = whatever is left when neighbours are at their minimums
  const centerMax = 100 - LEFT_MIN - effectiveRightMin;

  return (
    <div ref={containerRef} className="h-full">
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full"
      onLayoutChanged={(layout) => {
        const leftSize = layout['left-panel'];
        const rightSize = layout['right-panel'];
        if (leftSize !== undefined && leftSize !== leftPanelSize) {
          setLeftPanelSize(leftSize);
        }
        // Only save right panel size when not collapsed
        if (!activityPanelCollapsed && rightSize !== undefined && rightSize !== rightPanelSize) {
          setRightPanelSize(rightSize);
        }
      }}
    >
      {/* Left Panel - Explorer */}
      <ResizablePanel
        id="left-panel"
        defaultSize={`${leftPanelSize}%`}
        minSize={`${LEFT_MIN}%`}
        maxSize={`${LEFT_MAX}%`}
        className="bg-sidebar-background"
        style={{ overflow: 'visible' }}
      >
        {left}
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Center Panel - Command Center */}
      <ResizablePanel
        id="center-panel"
        defaultSize={`${100 - leftPanelSize - effectiveRightSize}%`}
        minSize={`${CENTER_MIN}%`}
        maxSize={`${centerMax}%`}
      >
        {center}
      </ResizablePanel>

      <ResizableHandle withHandle={!activityPanelCollapsed} />

      {/* Right Panel - Activity Feed */}
      <ResizablePanel
        id="right-panel"
        defaultSize={`${effectiveRightSize}%`}
        minSize={`${effectiveRightMin}%`}
        maxSize={`${effectiveRightMax}%`}
        className="bg-sidebar-background"
      >
        {right}
      </ResizablePanel>
    </ResizablePanelGroup>
    </div>
  );
}
