import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useLayoutStore } from '@/stores/layoutStore';

interface ResizableLayoutProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

const COLLAPSED_SIZE = 3; // percentage when collapsed

// Explicit constraint bounds to prevent ARIA valuemin > valuemax issues.
// The library computes separator ranges from adjacent panels' min/max;
// if any panel omits a bound, the computed range can invert.
const LEFT_MIN = 10;
const LEFT_MAX = 25;
const RIGHT_MIN = 15;
const RIGHT_MAX = 40;
const CENTER_MIN = 30;

export function ResizableLayout({ left, center, right }: ResizableLayoutProps) {
  const {
    leftPanelSize,
    rightPanelSize,
    activityPanelCollapsed,
    setLeftPanelSize,
    setRightPanelSize
  } = useLayoutStore();

  const effectiveRightMin = activityPanelCollapsed ? COLLAPSED_SIZE : RIGHT_MIN;
  const effectiveRightMax = activityPanelCollapsed ? COLLAPSED_SIZE : RIGHT_MAX;
  const effectiveRightSize = activityPanelCollapsed ? COLLAPSED_SIZE : rightPanelSize;

  // Center max = whatever is left when neighbours are at their minimums
  const centerMax = 100 - LEFT_MIN - effectiveRightMin;

  return (
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
  );
}
