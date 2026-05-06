import { useState, useMemo, useEffect } from 'react';
import { ChevronRight, Bot, FolderOpen, RefreshCw, Archive, Package, LayoutDashboard, KeyRound } from 'lucide-react';
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
// import type { Message } from '@/types/message'; // Hidden: mailbox panel disabled

interface ProjectGroup {
  project: Project | null;
  projectId: string;
  agents: Agent[];
}

export function Explorer() {
  const [archivedOpen, setArchivedOpen] = useState(false);
  // const [mailboxOpen, setMailboxOpen] = useState(true); // Hidden: mailbox panel disabled
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

  // Group agents by project
  const projectGroups = useMemo((): ProjectGroup[] => {
    const groups = new Map<string, Agent[]>();

    for (const agent of agents) {
      const projectId = agent.project_id || '_default';
      if (!groups.has(projectId)) {
        groups.set(projectId, []);
      }
      groups.get(projectId)!.push(agent);
    }

    // Sort agents within each group: supervisors first, then by display name,
    // with clones placed immediately after their parent.
    for (const [, groupAgents] of groups) {
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
    }

    const result: ProjectGroup[] = [];

    // If we have projects from the API, use them for ordering
    if (projects.length > 0) {
      // Self-project first
      const selfProject = projects.find(p => p.is_self);
      if (selfProject && groups.has(selfProject.id)) {
        result.push({
          project: selfProject,
          projectId: selfProject.id,
          agents: groups.get(selfProject.id)!,
        });
        groups.delete(selfProject.id);
      }

      // Other registered projects
      for (const project of projects.filter(p => !p.is_self)) {
        const projectAgents = groups.get(project.id);
        if (projectAgents) {
          result.push({
            project,
            projectId: project.id,
            agents: projectAgents,
          });
          groups.delete(project.id);
        } else {
          // Project exists but has no agents
          result.push({
            project,
            projectId: project.id,
            agents: [],
          });
        }
      }
    }

    // Remaining agents not associated with any known project
    // (includes the _default group for agents without project_id)
    for (const [projectId, groupAgents] of groups) {
      if (projectId === '_default' && result.length === 0) {
        // No projects registered — show all agents under a single "SOREN" heading
        result.push({
          project: null,
          projectId: '_default',
          agents: groupAgents,
        });
      } else if (projectId !== '_default') {
        result.push({
          project: null,
          projectId,
          agents: groupAgents,
        });
      } else if (groupAgents.length > 0) {
        // Default group has agents and projects exist — show as "Unassigned"
        result.push({
          project: null,
          projectId: '_default',
          agents: groupAgents,
        });
      }
    }

    return result;
  }, [agents, projects]);

  // Filter groups by selected project
  const filteredGroups = useMemo(() => {
    if (!selectedProjectId) return projectGroups;
    return projectGroups.filter(g => g.projectId === selectedProjectId);
  }, [projectGroups, selectedProjectId]);

  // Total agent count
  const totalAgents = agents.length;

  // Build file tree and separate mailbox and journal
  const allItems: FileTreeItem[] = filesystemData?.items
    ? buildFileTree(filesystemData.items)
    : [];

  // const mailboxItem = allItems.find(item => item.name === 'mailbox'); // Hidden: mailbox panel disabled
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
          {/* AGENTS Section */}
          <Dialog open={createSessionOpen} onOpenChange={setCreateSessionOpen}>
            <div className="flex items-center">
              <div className="flex-1 flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">
                <Bot className="h-3.5 w-3.5" />
                <span>Agents</span>
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
              ) : filteredGroups.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">No agents running</p>
              ) : (
                <div className="space-y-2">
                  {filteredGroups.map((group) => (
                    <ProjectAgentGroup
                      key={group.projectId}
                      group={group}
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

          {/* MAILBOX Section - Agent Communication (hidden for now, re-enable by uncommenting)
          <MailboxSection
            mailboxOpen={mailboxOpen}
            setMailboxOpen={setMailboxOpen}
            mailboxItem={mailboxItem}
            selectedFile={selectedFile}
            handleFileSelect={handleFileSelect}
          />
          */}

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

function ProjectAgentGroup({
  group,
  selectedAgentId,
  onSelectAgent,
  tokensByAgent,
}: {
  group: ProjectGroup;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  tokensByAgent: Map<string, number>;
}) {
  const { project, agents } = group;
  const projectName = project?.name || (group.projectId === '_default' ? 'SOREN' : group.projectId);
  const isSelfProject = project?.is_self ?? (group.projectId === '_default');
  const isActive = project?.active ?? true;

  const blockedCount = agents.filter(a => a.status === 'BLOCKED').length;

  // Split agents into three buckets:
  //   activeAgents   — busy or recently active (<5 min)
  //   idleAgents     — IDLE/COMPLETE with a live tmux window, quiet ≥5 min
  //   sleepingAgents — SLEEPING (no tmux window)
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

  // Start expanded only if group has actively working agents
  const [isOpen, setIsOpen] = useState(activeAgents.length > 0);
  const [sleepingExpanded, setSleepingExpanded] = useState(false);

  // If the selected agent is sleeping, auto-expand the sleeping fold
  const selectedInSleeping = sleepingAgents.some(a => a.id === selectedAgentId);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center group">
        <CollapsibleTrigger asChild>
          <button className="flex-1 flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform',
                isOpen && 'rotate-90'
              )}
            />
            <Package className={cn(
              'h-3 w-3',
              isSelfProject ? 'text-blue-500' : 'text-muted-foreground'
            )} />
            <span className="truncate font-medium">{projectName}</span>
            {isSelfProject && (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-blue-500/50 text-blue-500">
                self
              </Badge>
            )}
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
            <span className="ml-auto text-[10px]">{agents.length}</span>
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="ml-2 space-y-0.5">
        {agents.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">No agents</p>
        ) : (
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
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* MailboxSection — hidden for now, re-enable by uncommenting
function MailboxSection({
  mailboxOpen,
  setMailboxOpen,
  mailboxItem,
  selectedFile,
  handleFileSelect,
}: {
  mailboxOpen: boolean;
  setMailboxOpen: (open: boolean) => void;
  mailboxItem: FileTreeItem | undefined;
  selectedFile: FileTreeItem | null;
  handleFileSelect: (item: FileTreeItem) => void;
}) {
  const { data: messagesData, isLoading } = useQuery({
    queryKey: ['mailboxMessages'],
    queryFn: () => api.getMailboxMessages(10),
    refetchInterval: 30_000,
  });

  const recentMessages = messagesData?.messages || [];
  const messageCount = recentMessages.length;

  const parseSubject = (content: string) => {
    const seeIdx = content.indexOf(' (see:');
    if (seeIdx > 0) return content.substring(0, seeIdx);
    return content;
  };

  return (
    <Collapsible open={mailboxOpen} onOpenChange={setMailboxOpen} className="mt-4">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70 hover:text-sidebar-foreground">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              mailboxOpen && 'rotate-90'
            )}
          />
          <Mail className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Mailbox</span>
          {messageCount > 0 && (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-xs bg-blue-500/20 text-blue-400 animate-pulse"
            >
              {messageCount}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
        {mailboxItem && (
          <button
            onClick={() => handleFileSelect(mailboxItem)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              selectedFile?.path === mailboxItem.path && 'bg-sidebar-accent text-sidebar-accent-foreground'
            )}
          >
            <Inbox className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <span className="truncate">View Raw Mailbox</span>
          </button>
        )}
        {isLoading ? (
          <div className="px-3 py-2">
            <Skeleton className="h-4 w-full" />
          </div>
        ) : recentMessages.length > 0 ? (
          <div className="space-y-0.5 pt-1">
            {recentMessages.slice(0, 5).map((msg: Message) => (
              <div
                key={msg.id}
                className="w-full flex items-start gap-2 px-3 py-1.5 text-xs rounded-md hover:bg-sidebar-accent/50"
              >
                <MessageSquare className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <span className="font-medium text-foreground/80">{msg.from_agent}</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                    <span className="font-medium text-foreground/80">{msg.to_agent}</span>
                  </div>
                  <p className="truncate text-muted-foreground mt-0.5">
                    {parseSubject(msg.content)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No recent agent messages
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
*/
