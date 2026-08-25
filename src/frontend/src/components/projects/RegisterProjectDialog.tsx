import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
import { Button } from '@/components/ui/button';

interface RegisterProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegisterProjectDialog({ open, onOpenChange }: RegisterProjectDialogProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [installHooks, setInstallHooks] = useState(false);
  const [startSupervisor, setStartSupervisor] = useState(false);

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const project = await api.createProject({
        path,
        name: name || undefined,
        description: description || undefined,
      });

      // If start supervisor was checked, activate the project
      if (startSupervisor) {
        await api.activateProject(project.id);
      }

      return project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      onOpenChange(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setPath('');
    setName('');
    setDescription('');
    setInstallHooks(false);
    setStartSupervisor(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Project</DialogTitle>
          <DialogDescription>
            Add an external project to manage with SOREN.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Path *</label>
              <Input
                placeholder="/path/to/project"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Absolute path to the project directory
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name</label>
              <Input
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Derived from directory name if not provided.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="A brief description of the project..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={installHooks}
                  onChange={(e) => setInstallHooks(e.target.checked)}
                  className="rounded border-input"
                />
                Install SOREN hooks
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={startSupervisor}
                  onChange={(e) => setStartSupervisor(e.target.checked)}
                  className="rounded border-input"
                />
                Start project supervisor
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !path.trim()}
            >
              {createMutation.isPending ? 'Registering...' : 'Register Project'}
            </Button>
          </DialogFooter>
          {createMutation.isError && (
            <p className="text-sm text-red-700 dark:text-red-400 mt-2">
              {createMutation.error?.message || 'Failed to register project'}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
