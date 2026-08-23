import { useState, useMemo, useEffect } from 'react';
import { ChevronRight, Bot, FolderOpen, RefreshCw, Archive, Package, LayoutDashboard, KeyRound, Users } from 'lucide-react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAgents } from '@/hooks/useAgents';
import { useProjects } from '@/hooks/useProjects';
import { useTeams } from '@/hooks/useTeams';
import { useAgentStore } from '@/stores/agentStore';
import { useProjectStore } from '@/stores/projectStore';
import { useViewerStore } from '@/stores/viewerStore';
import { useFilesystem, buildFileTree } from '@/hooks/useFilesystem';
import { FileTree, type FileTreeItem } from './FileTree';
import { JournalTree } from './JournalTree';
import { AgentTreeItem } from './AgentTreeItem';
import { SecretsPanel } from '../secrets/SecretsPanel';
import { api } from '@/lib/api';
import type { Agent } from '@/types/agent';
import type { Project } from '@/types/project';
import type { Team, TeamMember } from '@/types/team';


/** Agents that belong to THE SYSTEM (SOREN) rather than a registered project. */
function isSorenScope(projectId?: string | null): boolean {
  return !projectId || projectId === 'soren';
}

/**
 * Sort agents: supervisors first, then by display name, with clones
 * placed immediately after their parent. Returns a new array.
 */
function sortAgentGroup(input: Agent[]): Agent[] {
  const groupAgents = [...input];

  // First pass: sort without clone awareness
  groupAgents.sort((a, b) => {
    const aIsSup = a.type === 'supervisor' || a.role === 'project-supervisor';
    const bIsSup = b.type === 'supervisor' || b.role === 'project-supervisor';
    if (aIsSup && !bIsSup) return -1;
    if (bIsSup && !aIsSup) return 1;
    const aName = a.display_name || a.name;
    const bName = b.display_name || b.name;
    return aName.localeCompare(bName);
  });

  // Second pass: move clones right after their parent
  const clones = groupAgents.filter(a => a.clone_of);
  if (clones.length > 0) {
    // Remove clones from the list
    for (const clone of clones) {
      const idx = groupAgents.indexOf(clone);
      if (idx !== -1) groupAgents.splice(idx, 1);
    }
    // Re-insert each clone after its parent
    for (const clone of clones) {
      const parentIdx = groupAgents.findIndex(a => a.id === clone.clone_of || a.name === clone.clone_of);
      if (parentIdx !== -1) {
        // Find the last consecutive clone already inserted after this parent
        let insertIdx = parentIdx + 1;
        while (insertIdx < groupAgents.length && groupAgents[insertIdx].clone_of === clone.clone_of) {
          insertIdx++;
        }
        groupAgents.splice(insertIdx, 0, clone);
      } else {
        // Parent not found in this group, append at end
        groupAgents.push(clone);
      }
    }
  }

  return groupAgents;
}

interface ProjectEntryData {
  project: Project | null;
  projectId: string;
  supervisor: Agent | null;
  teams: Team[];
  looseAgents: Agent[];
  agentCount: number;
}

export function Explorer() {
  const [archivedOpen, setArchivedOpen] = useState(false);

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionTask, setNewSessionTask] = useState('');

  const { selectedAgentId, selectAgent, archivedAgents, setArchivedAgents, viewingArchivedId, viewArchive } = useAgentStore();
  const { selectedProjectId } = useProjectStore();
  const { selectedFile, setSelectedFile } = useViewerStore();
  const { data: agentsData, isLoading: agentsLoading, error: agentsError } = useAgents();
  const { data: projectsData } = useProjects();
  const { data: teamsData } = useTeams();
  const { data: filesystemData, isLoading: fsLoading, refetch: refetchFs } = useFilesystem();
  const queryClient = useQueryClient();

  // Fetch archived agents
  const { data: archivedData } = useQuery({
    queryKey: ['archivedAgents'],
    queryFn: () => api.getArchivedAgents(),
  });

  // Fetch budget/token usage per agent
  const { data: budgetData } = useQuery({
    queryKey: ['budget'],
    queryFn: () => api.getBudget(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Build a map of agent_id -> total tokens for quick lookup
  const tokensByAgent = useMemo(() => {
    const map = new Map<string, number>();
    if (budgetData?.agents) {
      for (const a of budgetData.agents) {
        const total = a.input_tokens + a.output_tokens;
        if (total > 0) map.set(a.agent_id, total);
      }
    }
    return map;
  }, [budgetData]);

  // Sync archived agents to store
  useEffect(() => {
    if (archivedData) {
      setArchivedAgents(archivedData);
    }
  }, [archivedData, setArchivedAgents]);

  const createSessionMutation = useMutation({
    mutationFn: (data: { name: string; task_description: string }) => api.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setCreateSessionOpen(false);
      setNewSessionName('');
      setNewSessionTask('');
    },
  });

  const agents = useMemo(() => agentsData?.agents || [], [agentsData]);
  const projects = useMemo(() => projectsData?.projects || [], [projectsData]);
  const teams = useMemo(() => teamsData?.teams || [], [teamsData]);

  // Resolve team member names to live agents (by name, id, or display name)
  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) {
      map.set(a.name, a);
      map.set(a.id, a);
      if (a.display_name) map.set(a.display_name, a);
    }
    return map;
  }, [agents]);

  // Agents claimed by any team (so they don't render twice as loose agents)
  const teamClaimedAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const team of teams) {
      for (const member of team.members) {
        const agent = agentLookup.get(member.name);
        if (agent) set.add(agent.id);
      }
    }
    return set;
  }, [teams, agentLookup]);

  // ── SOREN (the system): agents + teams without a project scope ────────────
  const sorenTeams = useMemo(
    () => teams.filter(t => isSorenScope(t.project_id)),
    [teams]
  );

  const sorenLooseAgents = useMemo(
    () => sortAgentGroup(
      agents.filter(a => isSorenScope(a.project_id) && !teamClaimedAgentIds.has(a.id))
    ),
    [agents, teamClaimedAgentIds]
  );

  const sorenAgentCount = useMemo(
    () => agents.filter(a => isSorenScope(a.project_id)).length,
    [agents]
  );

  // ── PROJECTS: one entry per registered project + orphan project groups ────
  const projectEntries = useMemo((): ProjectEntryData[] => {
    const byProject = new Map<string, Agent[]>();
    for (const agent of agents) {
      if (isSorenScope(agent.project_id)) continue;
      const pid = agent.project_id!;
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(agent);
    }

    const entries: ProjectEntryData[] = [];
    const buildEntry = (project: Project | null, pid: string) => {
      const projAgents = sortAgentGroup(byProject.get(pid) || []);
      const supervisor = projAgents.find(
        a => a.role === 'project-supervisor' || a.name === `sup-${pid}`
      ) || null;
      const projTeams = teams.filter(t => t.project_id === pid);
      const looseAgents = projAgents.filter(
        a => a.id !== supervisor?.id && !teamClaimedAgentIds.has(a.id)
      );
      entries.push({
        project,
        projectId: pid,
        supervisor,
        teams: projTeams,
        looseAgents,
        agentCount: projAgents.length,
      });
      byProject.delete(pid);
    };

    // All registered projects (except the self-project — that IS the system)
    for (const project of projects.filter(p => !p.is_self)) {
      buildEntry(project, project.id);
    }
    // Agents pointing at unregistered project ids still render as a group
    for (const pid of [...byProject.keys()]) {
      buildEntry(null, pid);
    }
    return entries;
  }, [agents, projects, teams, teamClaimedAgentIds]);

  // Filter project entries by selected project (SOREN section is always visible)
  const visibleProjectEntries = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === 'soren') return projectEntries;
    return projectEntries.filter(e => e.projectId === selectedProjectId);
  }, [projectEntries, selectedProjectId]);

  // Total agent count
  const totalAgents = agents.length;

  // Build file tree and separate journal
  const allItems: FileTreeItem[] = filesystemData?.items
    ? buildFileTree(filesystemData.items)
    : [];


  const journalFolder = allItems.find(item => item.name === 'journal' && item.type === 'directory');
  const fileTree = allItems.filter(item => item.name !== 'mailbox' && item.name !== 'journal');

  const handleFileSelect = (item: FileTreeItem) => {
    if (item.type === 'file') {
      setSelectedFile(item);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* SOREN Section — THE SYSTEM */}
          <Dialog open={createSessionOpen} onOpenChange={setCreateSessionOpen}>
            <div className="flex items-center">
              <div className="flex-1 flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">
                <Bot className="h-3.5 w-3.5 text-blue-500" />
                <span>SOREN</span>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-blue-500/50 text-blue-500 normal-case tracking-normal">
                  system
                </Badge>
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {totalAgents}
                </span>
              </div>
            </div>
            <div className="mt-1">
              {/* Command Center - always visible at top */}
              <button
                onClick={() => selectAgent(null)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors text-left mb-1',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  !selectedAgentId && !viewingArchivedId && 'bg-sidebar-accent text-sidebar-accent-foreground'
                )}
              >
                <LayoutDashboard className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <span className="truncate flex-1 font-medium">Command Center</span>
              </button>

              {agentsLoading ? (
                <div className="space-y-2 px-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ) : agentsError ? (
                <p className="px-2 text-xs text-destructive">Failed to load agents</p>
              ) : sorenAgentCount === 0 && sorenTeams.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">No system agents running</p>
              ) : (
                <div className="space-y-0.5">
                  {/* System agents: supervisor pinned first, then workers */}
                  <AgentBucketList
                    agents={sorenLooseAgents}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={selectAgent}
                    tokensByAgent={tokensByAgent}
                  />

                  {/* System-scoped teams */}
                  {sorenTeams.map((team) => (
                    <TeamGroup
                      key={team.prefix}
                      team={team}
                      agentLookup={agentLookup}
                      selectedAgentId={selectedAgentId}
                      onSelectAgent={selectAgent}
                      tokensByAgent={tokensByAgent}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* PROJECTS Section */}
            <div className="flex items-center mt-4">
              <div className="flex-1 flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">
                <Package className="h-3.5 w-3.5" />
                <span>Projects</span>
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {projectEntries.length}
                </span>
              </div>
            </div>
            <div className="mt-1">
              {visibleProjectEntries.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  No projects registered
                </p>
              ) : (
                <div className="space-y-1">
                  {visibleProjectEntries.map((entry) => (
                    <ProjectEntry
                      key={entry.projectId}
                      entry={entry}
                      agentLookup={agentLookup}
                      selectedAgentId={selectedAgentId}
                      onSelectAgent={selectAgent}
                      tokensByAgent={tokensByAgent}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Create Session Dialog */}
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Session</DialogTitle>
                <DialogDescription>
                  Create a new orchestration session with its own supervisor agent.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Session Name</label>
                  <Input
                    placeholder="feature-auth"
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Will be prefixed with "soren-"
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Task Description</label>
                  <Textarea
                    placeholder="Implement user authentication with JWT..."
                    value={newSessionTask}
                    onChange={(e) => setNewSessionTask(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateSessionOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createSessionMutation.mutate({
                    name: newSessionName,
                    task_description: newSessionTask,
                  })}
                  disabled={createSessionMutation.isPending || !newSessionName || !newSessionTask}
                >
                  {createSessionMutation.isPending ? 'Creating...' : 'Create Session'}
                </Button>
              </DialogFooter>
              {createSessionMutation.isError && (
                <p className="text-sm text-red-500 mt-2">
                  {createSessionMutation.error?.message || 'Failed to create session'}
                </p>
              )}
            </DialogContent>
          </Dialog>

          {/* ARCHIVED WORKERS Section */}
          {archivedAgents.length > 0 && (
            <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen} className="mt-4">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70 hover:text-sidebar-foreground">
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      archivedOpen && 'rotate-90'
                    )}
                  />
                  <Archive className="h-3.5 w-3.5" />
                  <span>Archived</span>
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                    {archivedAgents.length}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1 space-y-0.5">
                {archivedAgents.map((archived) => (
                  <button
                    key={archived.id}
                    onClick={() => viewArchive(archived.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left',
                      'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      viewingArchivedId === archived.id && 'bg-sidebar-accent text-sidebar-accent-foreground'
                    )}
                  >
                    <Archive className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="truncate flex-1">{archived.agent_name}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 border-gray-400/50 text-gray-500"
                    >
                      ARC
                    </Badge>
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}



          {/* MEMORY Section */}
          <Collapsible open={memoryOpen} onOpenChange={setMemoryOpen} className="mt-4">
            <div className="flex items-center">
              <CollapsibleTrigger asChild>
                <button className="flex-1 flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70 hover:text-sidebar-foreground">
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      memoryOpen && 'rotate-90'
                    )}
                  />
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Memory</span>
                </button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 mr-1"
                onClick={() => refetchFs()}
                title="Refresh"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            <CollapsibleContent className="mt-1">
              {fsLoading ? (
                <div className="space-y-2 px-2">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-1/2" />
                </div>
              ) : !journalFolder && fileTree.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  No .soren directory found
                </p>
              ) : (
                <div className="space-y-1">
                  {/* Journal section with specialized tree */}
                  {journalFolder && (
                    <JournalTree
                      journalFolder={journalFolder}
                      onFileSelect={handleFileSelect}
                      selectedPath={selectedFile?.path}
                    />
                  )}
                  {/* Other memory files */}
                  {fileTree.length > 0 && (
                    <FileTree
                      items={fileTree}
                      onFileSelect={handleFileSelect}
                      selectedPath={selectedFile?.path}
                    />
                  )}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* SECRETS Section */}
          <Collapsible open={secretsOpen} onOpenChange={setSecretsOpen} className="mt-4">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    secretsOpen && 'rotate-90'
                  )}
                />
                <KeyRound className="h-3.5 w-3.5" />
                <span>Secrets</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SecretsPanel />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Renders a flat agent list split into activity buckets:
 *   active   — busy or recently active (<5 min), always visible
 *   idle     — IDLE/COMPLETE with a live tmux window, quiet ≥5 min, dimmed
 *   sleeping — SLEEPING (no tmux window), behind a collapsed fold
 */
function AgentBucketList({
  agents,
  selectedAgentId,
  onSelectAgent,
  tokensByAgent,
}: {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  tokensByAgent: Map<string, number>;
}) {
  const [sleepingExpanded, setSleepingExpanded] = useState(false);

  const now = Date.now();
  const activeAgents: Agent[] = [];
  const idleAgents: Agent[] = [];
  const sleepingAgents: Agent[] = [];
  const ACTIVE_STATUSES = new Set(['IN_PROGRESS', 'BLOCKED', 'TESTING', 'FAILED', 'PENDING']);
  for (const agent of agents) {
    const minutesSince = agent.last_activity
      ? (now - new Date(agent.last_activity).getTime()) / 60_000
      : Infinity;
    if (agent.status === 'SLEEPING') {
      sleepingAgents.push(agent);
    } else if (ACTIVE_STATUSES.has(agent.status) || minutesSince < 5) {
      activeAgents.push(agent);
    } else {
      idleAgents.push(agent);
    }
  }

  // If the selected agent is sleeping, auto-expand the sleeping fold
  const selectedInSleeping = sleepingAgents.some(a => a.id === selectedAgentId);

  if (agents.length === 0) return null;

  return (
    <>
      {/* Active agents — always visible */}
      {activeAgents.map((agent) => (
        <AgentTreeItem
          key={agent.id}
          agent={agent}
          isSelected={selectedAgentId === agent.id}
          onClick={() => onSelectAgent(agent.id)}
          totalTokens={tokensByAgent.get(agent.id) || tokensByAgent.get(agent.name)}
        />
      ))}

      {/* Idle agents — visible directly below active, slightly dimmed */}
      {idleAgents.map((agent) => (
        <div key={agent.id} className="opacity-70">
          <AgentTreeItem
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => onSelectAgent(agent.id)}
            totalTokens={tokensByAgent.get(agent.id) || tokensByAgent.get(agent.name)}
          />
        </div>
      ))}

      {/* Sleeping agents — behind a collapsed fold */}
      {sleepingAgents.length > 0 && (
        <Collapsible open={sleepingExpanded || selectedInSleeping} onOpenChange={setSleepingExpanded}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <ChevronRight className={cn('h-2.5 w-2.5 transition-transform', (sleepingExpanded || selectedInSleeping) && 'rotate-90')} />
              <span>💤 {sleepingAgents.length} sleeping</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5">
            {sleepingAgents.map((agent) => (
              <AgentTreeItem
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onClick={() => onSelectAgent(agent.id)}
                totalTokens={tokensByAgent.get(agent.id) || tokensByAgent.get(agent.name)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

// Status-dot colors for team members that don't resolve to a live agent
const memberStatusColors: Record<string, string> = {
  PENDING: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  BLOCKED: 'bg-red-500',
  TESTING: 'bg-yellow-500',
  COMPLETE: 'bg-green-500',
  FAILED: 'bg-red-600',
  IDLE: 'bg-gray-500',
  SLEEPING: 'bg-indigo-400',
};

/** A team: prefix header with template badge, members nested underneath. */
function TeamGroup({
  team,
  agentLookup,
  selectedAgentId,
  onSelectAgent,
  tokensByAgent,
}: {
  team: Team;
  agentLookup: Map<string, Agent>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  tokensByAgent: Map<string, number>;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight
            className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
          />
          <Users className="h-3 w-3 text-teal-500" />
          <span className="truncate font-medium">{team.prefix}</span>
          <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-teal-500/50 text-teal-500">
            {team.template}
          </Badge>
          {team.permanent && (
            <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-gray-400/50 text-gray-500">
              perm
            </Badge>
          )}
          <span className="ml-auto text-[10px]">{team.members.length}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-3 space-y-0.5">
        {team.members.map((member) => {
          const agent = agentLookup.get(member.name);
          if (agent) {
            return (
              <AgentTreeItem
                key={member.name}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onClick={() => onSelectAgent(agent.id)}
                totalTokens={tokensByAgent.get(agent.id) || tokensByAgent.get(agent.name)}
              />
            );
          }
          return <TeamMemberRow key={member.name} member={member} />;
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Fallback row for a team member with no live agent entry. */
function TeamMemberRow({ member }: { member: TeamMember }) {
  return (
    <div className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground/70">
      <span
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          memberStatusColors[member.status ?? ''] || 'bg-gray-400',
          !member.in_registry && 'opacity-40'
        )}
        title={member.status ?? 'not in registry'}
      />
      <Bot className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
      <span className="truncate flex-1">{member.display_name || member.name}</span>
      {!member.in_registry && (
        <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">gone</span>
      )}
    </div>
  );
}

/** A registered project: supervisor, teams, then loose agents. */
function ProjectEntry({
  entry,
  agentLookup,
  selectedAgentId,
  onSelectAgent,
  tokensByAgent,
}: {
  entry: ProjectEntryData;
  agentLookup: Map<string, Agent>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  tokensByAgent: Map<string, number>;
}) {
  const { project, projectId, supervisor, teams, looseAgents, agentCount } = entry;
  const projectName = project?.name || projectId;
  const isActive = project?.active ?? agentCount > 0;
  const isEmpty = !supervisor && teams.length === 0 && looseAgents.length === 0;

  const blockedCount = looseAgents.filter(a => a.status === 'BLOCKED').length
    + (supervisor?.status === 'BLOCKED' ? 1 : 0);

  const hasActiveAgents = [...looseAgents, ...(supervisor ? [supervisor] : [])].some(a => {
    const minutesSince = a.last_activity
      ? (Date.now() - new Date(a.last_activity).getTime()) / 60_000
      : Infinity;
    return ['IN_PROGRESS', 'BLOCKED', 'TESTING', 'FAILED', 'PENDING'].includes(a.status) || minutesSince < 5;
  });

  // Start expanded only if the project has actively working agents
  const [isOpen, setIsOpen] = useState(hasActiveAgents);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center group">
        <CollapsibleTrigger asChild>
          <button className="flex-1 flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight
              className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
            />
            <Package className="h-3 w-3 text-muted-foreground" />
            <span className="truncate font-medium">{projectName}</span>
            {!isActive && (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-gray-400/50 text-gray-500">
                idle
              </Badge>
            )}
            {blockedCount > 0 && (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-red-500/50 text-red-500">
                {blockedCount} blocked
              </Badge>
            )}
            <span className="ml-auto text-[10px]">{agentCount}</span>
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="ml-2 space-y-0.5">
        {isEmpty ? (
          <p className="px-3 py-1 text-xs text-muted-foreground/60 italic">
            no active agents — activate with ./tools/projects activate {projectId}
          </p>
        ) : (
          <>
            {/* Project supervisor pinned first */}
            {supervisor && (
              <AgentTreeItem
                agent={supervisor}
                isSelected={selectedAgentId === supervisor.id}
                onClick={() => onSelectAgent(supervisor.id)}
                totalTokens={tokensByAgent.get(supervisor.id) || tokensByAgent.get(supervisor.name)}
              />
            )}

            {/* Teams registered for this project */}
            {teams.map((team) => (
              <TeamGroup
                key={team.prefix}
                team={team}
                agentLookup={agentLookup}
                selectedAgentId={selectedAgentId}
                onSelectAgent={onSelectAgent}
                tokensByAgent={tokensByAgent}
              />
            ))}

            {/* Loose agents not belonging to any team */}
            <AgentBucketList
              agents={looseAgents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              tokensByAgent={tokensByAgent}
            />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}


