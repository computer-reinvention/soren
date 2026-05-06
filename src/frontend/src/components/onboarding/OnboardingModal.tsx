import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { cn } from '@/lib/utils';
import {
  Users,
  Shield,
  Activity,
  BookOpen,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Bot,
  GitBranch,
  Zap,
} from 'lucide-react';

interface OnboardingStep {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: React.ReactNode;
  gradient: string;
}

const steps: OnboardingStep[] = [
  {
    icon: <Sparkles className="h-8 w-8" />,
    title: 'Welcome to SOREN',
    subtitle: 'Multi-Agent AI Orchestration',
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
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: 'Supervisor + Workers',
    subtitle: 'Hierarchical Agent Architecture',
    description: (
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">Supervisor Agent</p>
            <p className="text-sm">Coordinates work, delegates tasks, and reviews changes. Always running.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent/50 p-2 mt-0.5">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">Worker Agents</p>
            <p className="text-sm">Execute specific tasks in isolated tmux windows. Spawned on demand.</p>
          </div>
        </div>
      </div>
    ),
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    icon: <Shield className="h-8 w-8" />,
    title: 'Self-Healing Safety',
    subtitle: 'Automatic Rollback Protection',
    description: (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <GitBranch className="h-4 w-4 text-green-500" />
          <span>Changes are automatically committed to git</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-amber-500" />
          <span>Health daemon monitors system every 10 seconds</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4 text-blue-500" />
          <span>Automatic rollback if something breaks</span>
        </div>
        <p className="text-sm pt-2 border-t border-border">
          This means agents can safely experiment - if changes break the system,
          it automatically recovers to the last working state.
        </p>
      </div>
    ),
    gradient: 'from-emerald-500 to-teal-500',
  },
  {
    icon: <Activity className="h-8 w-8" />,
    title: 'Real-Time Dashboard',
    subtitle: 'Monitor Everything',
    description: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card p-3">
            <p className="font-medium text-sm">Left Panel</p>
            <p className="text-xs text-muted-foreground">Agents, files, mailbox</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="font-medium text-sm">Center Panel</p>
            <p className="text-xs text-muted-foreground">Chat with agents</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="font-medium text-sm">Right Panel</p>
            <p className="text-xs text-muted-foreground">Activity timeline</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="font-medium text-sm">Status Bar</p>
            <p className="text-xs text-muted-foreground">Connection health</p>
          </div>
        </div>
        <p className="text-sm">
          All panels resize and update in real-time via WebSocket.
        </p>
      </div>
    ),
    gradient: 'from-orange-500 to-amber-500',
  },
  {
    icon: <BookOpen className="h-8 w-8" />,
    title: 'Persistent Memory',
    subtitle: 'Journal System',
    description: (
      <div className="space-y-3">
        <p>
          The journal system maintains context across sessions, so agents remember
          what was tried before and can make informed decisions.
        </p>
        <div className="rounded-lg border bg-muted/50 p-3 text-sm font-mono">
          <p className="text-muted-foreground">.soren/journal/YYYY-MM-DD/</p>
          <p className="pl-4">journal.md - Daily entries</p>
          <p className="pl-4">attachments/ - Screenshots, logs</p>
        </div>
      </div>
    ),
    gradient: 'from-pink-500 to-rose-500',
  },
  {
    icon: <MessageSquare className="h-8 w-8" />,
    title: 'Getting Started',
    subtitle: 'Send Your First Task',
    description: (
      <div className="space-y-3">
        <p>
          Use the <span className="font-semibold text-foreground">chat panel</span> in
          the center to send tasks to the supervisor agent.
        </p>
        <div className="rounded-lg border bg-muted/50 p-3">
          <p className="text-sm font-medium mb-2">Try these commands:</p>
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li>"Check the system status"</li>
            <li>"List all active workers"</li>
            <li>"Create a new feature for..."</li>
          </ul>
        </div>
        <p className="text-sm">
          The supervisor will coordinate workers as needed to complete your request.
        </p>
      </div>
    ),
    gradient: 'from-indigo-500 to-blue-600',
  },
];

export function OnboardingModal() {
  const { hasSeenOnboarding, setHasSeenOnboarding } = useOnboardingStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  const isOpen = !hasSeenOnboarding;
  const step = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

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
        {/* Gradient Header */}
        <div className={cn(
          'relative px-6 pt-8 pb-6 bg-gradient-to-br text-white',
          step.gradient
        )}>
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-white/20 p-3 backdrop-blur-sm">
                {step.icon}
              </div>
              <div>
                <DialogHeader className="text-left space-y-1">
                  <DialogTitle className="text-xl font-bold text-white">
                    {step.title}
                  </DialogTitle>
                  <DialogDescription className="text-white/80 text-sm">
                    {step.subtitle}
                  </DialogDescription>
                </DialogHeader>
              </div>
            </div>
          </div>

          {/* Step Indicator Dots */}
          <div className="flex justify-center gap-1.5 mt-6">
            {steps.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  index === currentStep
                    ? 'w-6 bg-white'
                    : 'w-1.5 bg-white/40 hover:bg-white/60'
                )}
                aria-label={`Go to step ${index + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <div className="text-sm text-muted-foreground min-h-[180px]">
            {step.description}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 bg-muted/30 border-t">
          <div className="flex items-center justify-between w-full">
            {/* Don't show again checkbox - only on last step */}
            <div className="flex items-center">
              {isLastStep && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="rounded border-border"
                  />
                  Don't show again
                </label>
              )}
            </div>

            {/* Navigation Buttons */}
            <div className="flex gap-2">
              {!isFirstStep && (
                <Button variant="outline" size="sm" onClick={handlePrevious}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
              <Button size="sm" onClick={handleNext}>
                {isLastStep ? (
                  'Get Started'
                ) : (
                  <>
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
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
