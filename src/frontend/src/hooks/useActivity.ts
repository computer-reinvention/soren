import { useActivityStore } from '../stores/activityStore';
import { useAgentStore } from '../stores/agentStore';
import { useProjectStore } from '../stores/projectStore';
import { useProjectAgents } from './useProjects';
import { useMemo } from 'react';

export function useActivity() {
  const { activities, clearActivities } = useActivityStore();
  const { selectedAgentId } = useAgentStore();
  const { selectedProjectId } = useProjectStore();
  const { data: projectAgentsData } = useProjectAgents(selectedProjectId);

  const filteredActivities = useMemo(() => {
    let filtered = activities;

    // Filter by project first (if a project is selected)
    if (selectedProjectId && projectAgentsData?.agents) {
      const projectAgentIds = new Set(projectAgentsData.agents.map(a => a.key));
      filtered = filtered.filter((a) => projectAgentIds.has(a.agent_id));
    }

    // Then filter by specific agent (if selected)
    if (selectedAgentId) {
      filtered = filtered.filter((a) => a.agent_id === selectedAgentId);
    }

    return filtered;
  }, [activities, selectedAgentId, selectedProjectId, projectAgentsData]);

  return {
    activities: filteredActivities,
    allActivities: activities,
    clearActivities,
    isFiltered: !!selectedAgentId || !!selectedProjectId,
    selectedProjectId,
  };
}
