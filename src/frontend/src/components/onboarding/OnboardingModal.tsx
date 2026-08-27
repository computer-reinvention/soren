import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  Users,
  Shield,
  Activity,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Bot,
  GitBranch,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
} from 'lucide-react';

interface OnboardingStep {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: React.ReactNode;
}

const steps: OnboardingStep[] = [
  {
    icon: <Terminal className="h-6 w-6" />,
    title: 'Welcome to SOREN',
    subtitle: 'multi-agent AI orchestration',
    description: (
      <div className="space-y-3">
        <p>
          SOREN is a <span className="font-semibold text-foreground">self-improving</span> multi-agent
          orchestration system that coordinates AI agents to complete complex tasks.
        </p>
        <p>
          Think of it as a team of AI assistants, each with their own specialty,
          working together under a supervisor's guidance.
        </p>
      </div>
    ),
  },
  {
    icon: <Users className="h-6 w-6" />,
    title: 'Supervisor + Workers',
    subtitle: 'hierarchical agent architecture',
    description: (
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded border border-border/60 bg-muted/30 p-1.5 mt-0.5">
            <Bot className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-500" />
          </div>
          <div>
            <p className="font-medium text-foreground font-mono text-xs uppercase tracking-wide">supervisor agent</p>
            <p className="text-sm">Coordinates work, delegates tasks, and reviews changes. Always running.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="rounded border border-border/60 bg-muted/30 p-1.5 mt-0.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground font-mono text-xs uppercase tracking-wide">worker agents</p>
            <p className="text-sm">Execute specific tasks in isolated tmux windows. Spawned on demand.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: 'Self-Healing Safety',
    subtitle: 'automatic rollback protection',
    description: (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-mono">
          <GitBranch className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-500 shrink-0" />
          <span>changes are automatically committed to git</span>
        </div>
        <div className="flex items-center gap-2 text-sm font-mono">
          <Zap className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500 shrink-0" />
          <span>health daemon monitors the system every 10 seconds</span>
        </div>
        <div className="flex items-center gap-2 text-sm font-mono">
          <Shield className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span>automatic rollback if something breaks</span>
        </div>
        <p className="text-sm pt-2 border-t border-border/60">
          This means agents can safely experiment — if changes break the system,
          it automatically recovers to the last working state.
        </p>
      </div>
    ),
  },
  {
    icon: <Activity className="h-6 w-6" />,
    title: 'Real-Time Dashboard',
    subtitle: 'monitor everything',
    description: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['left panel', 'agents, files, secrets'],
            ['center panel', 'chat with agents'],
            ['right panel', 'activity timeline'],
            ['status bar', 'connection health'],
          ].map(([label, desc]) => (
            <div key={label} className="rounded border border-border/60 bg-muted/30 px-3 py-2">
              <p className="font-mono text-xs uppercase tracking-wide text-foreground/90">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
        <p className="text-sm">All panels resize and update in real-time via WebSocket.</p>
      </div>
    ),
  },
  {
    icon: <BookOpen className="h-6 w-6" />,
    title: 'Persistent Memory',
    subtitle: 'journal system',
    description: (
      <div className="space-y-3">
        <p>
          The journal system maintains context across sessions, so agents remember
          what was tried before and can make informed decisions.
        </p>
        <pre className="rounded border border-border/60 bg-muted/30 p-3 text-xs font-mono text-muted-foreground overflow-x-auto">
{`.soren/journal/
  supervisor/YYYY-MM-DD/    global journal
  teams/<prefix>/YYYY-MM-DD/  each team's own
  YYYY-MM-DD/attachments/   screenshots, logs`}
        </pre>
      </div>
    ),
  },
];

/**
 * Final, interactive step (P6.5) — replaces the old static "here are some
 * commands to try" slide with something that actually does the two things
 * the plan called for: verify the server connection for real (not just
 * assert it in prose) and let the user send a genuine first message from
 * inside onboarding, using the same sendMessageToAgent call ChatInput uses.
 */
function GettingStartedStep({ onDone }: { onDone: () => void }) {
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const queryClient = useQueryClient();

  const { data: health, isFetching: checkingHealth, refetch: recheckHealth } = useQuery({
    queryKey: ['onboarding-health-check'],
    queryFn: () => api.getHealth(),
    staleTime: 0,
  });
  const isHealthy = health?.status === 'healthy';

  const sendMutation = useMutation({
    mutationFn: (content: string) => api.sendMessageToAgent('supervisor', content),
    onSuccess: () => {
      setSent(true);
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Live connection check — a real request, not a claim in prose. */}
      <div className="flex items-center justify-between rounded border border-border/60 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          {checkingHealth ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden />
          ) : isHealthy ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-500" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden />
          )}
          <span className={cn(!checkingHealth && (isHealthy ? 'text-emerald-700 dark:text-emerald-500' : 'text-red-700 dark:text-red-400'))}>
            {checkingHealth ? 'checking server connection…' : isHealthy ? 'server connection verified' : 'server unreachable'}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => recheckHealth()}>
          recheck
        </Button>
      </div>

      {/* Send a real first message to the supervisor. */}
      {sent ? (
        <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-800 dark:text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          sent — the supervisor will respond in the chat panel once you're through here.
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="onboarding-first-message" className="font-mono text-xs text-muted-foreground">
            send your first message to the supervisor
          </label>
          <div className="flex gap-1.5">
            <Textarea
              id="onboarding-first-message"
              rows={2}
              placeholder='e.g. "check the system status"'
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="font-mono text-sm resize-none"
              disabled={sendMutation.isPending}
            />
            <Button
              size="icon"
              className="h-auto shrink-0"
              disabled={!message.trim() || sendMutation.isPending}
              onClick={() => sendMutation.mutate(message.trim())}
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="sr-only">Send</span>
            </Button>
          </div>
          {sendMutation.isError && (
            <p className="text-xs text-red-700 dark:text-red-400 font-mono">failed to send — you can also just use the chat panel directly</p>
          )}
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-muted-foreground hover:text-foreground font-mono underline underline-offset-2"
          >
            skip, I'll send a message later
          </button>
        </div>
      )}
    </div>
  );
}

export function OnboardingModal() {
  const { hasSeenOnboarding, setHasSeenOnboarding } = useOnboardingStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  const isOpen = !hasSeenOnboarding;
  const totalSteps = steps.length + 1; // +1 for the interactive final step
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;
  const isInteractiveStep = currentStep === steps.length;
  const step = isInteractiveStep ? null : steps[currentStep];

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      if (dontShowAgain) {
        setHasSeenOnboarding(true);
      }
      setIsClosing(false);
    }, 150);
  };

  const handleNext = () => {
    if (isLastStep) {
      handleClose();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose();
    }
  };

  return (
    <Dialog open={isOpen && !isClosing} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 gap-0 overflow-hidden">
        {/* Header — terminal-console style: dark, monospace, no per-step
            gradients. Icon + title/subtitle match the uppercase-tracking-wide
            convention used across Overview/Reliability/Settings headers. */}
        <div className="px-6 pt-6 pb-5 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-800 dark:text-emerald-500">
              {isInteractiveStep ? <Send className="h-6 w-6" /> : step!.icon}
            </div>
            <DialogHeader className="text-left space-y-0.5">
              <DialogTitle className="font-mono text-sm font-semibold uppercase tracking-wider">
                {isInteractiveStep ? 'Getting Started' : step!.title}
              </DialogTitle>
              <DialogDescription className="font-mono text-xs text-muted-foreground">
                {isInteractiveStep ? 'verify + send your first message' : step!.subtitle}
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Step indicator — small squares, not white-on-gradient dots. */}
          <div className="flex gap-1 mt-4" role="tablist" aria-label="onboarding steps">
            {Array.from({ length: totalSteps }).map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                role="tab"
                aria-selected={index === currentStep}
                aria-label={`Go to step ${index + 1}`}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors motion-reduce:transition-none',
                  index === currentStep ? 'bg-emerald-500' : 'bg-border hover:bg-border/80'
                )}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <div className="text-sm text-muted-foreground min-h-[180px]">
            {isInteractiveStep ? <GettingStartedStep onDone={handleNext} /> : step!.description}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 bg-muted/30 border-t border-border/60">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center">
              {isLastStep && (
                <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="rounded border-border"
                  />
                  don't show again
                </label>
              )}
            </div>

            <div className="flex gap-2">
              {!isFirstStep && (
                <Button variant="outline" size="sm" onClick={handlePrevious} className="font-mono text-xs">
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  back
                </Button>
              )}
              <Button size="sm" onClick={handleNext} className="font-mono text-xs">
                {isLastStep ? (
                  'get started'
                ) : (
                  <>
                    next
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
