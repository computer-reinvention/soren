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

export function ResizableLayout({ left, center, right }: ResizableLayoutProps) {
  const {
    leftPanelSize,
    rightPanelSize,
    activityPanelCollapsed,
    setLeftPanelSize,
    setRightPanelSize
  } = useLayoutStore();

  const effectiveRightSize = activityPanelCollapsed ? COLLAPSED_SIZE : rightPanelSize;

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
        minSize="10%"
        maxSize="25%"
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
        minSize="30%"
      >
        {center}
      </ResizablePanel>

      <ResizableHandle withHandle={!activityPanelCollapsed} />

      {/* Right Panel - Activity Feed */}
      <ResizablePanel
        id="right-panel"
        defaultSize={`${effectiveRightSize}%`}
        minSize={activityPanelCollapsed ? `${COLLAPSED_SIZE}%` : "15%"}
        maxSize={activityPanelCollapsed ? `${COLLAPSED_SIZE}%` : "40%"}
        className="bg-sidebar-background"
      >
        {right}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
