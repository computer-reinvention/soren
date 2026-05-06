import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface WorkerConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  onConfirm: () => void;
}

export function WorkerConfirmModal({
  open,
  onOpenChange,
  agentName,
  onConfirm,
}: WorkerConfirmModalProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Direct Worker Interaction
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                You are about to send a message directly to worker agent{' '}
                <span className="font-semibold text-foreground">{agentName}</span>.
              </p>
              <p>
                Workers are typically managed by supervisors. Direct interaction may:
              </p>
              <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                <li>Interrupt ongoing tasks</li>
                <li>Conflict with supervisor instructions</li>
                <li>Cause unexpected behavior</li>
              </ul>
              <p className="mt-2 font-medium">
                Are you sure you want to proceed?
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Yes, Send Message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
