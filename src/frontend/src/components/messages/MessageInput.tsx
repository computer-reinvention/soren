import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAgentStore } from '@/stores/agentStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function MessageInput() {
  const [message, setMessage] = useState('');
  const { selectedAgentId } = useAgentStore();

  const sendMutation = useMutation({
    mutationFn: (content: string) => {
      if (!selectedAgentId) throw new Error('No agent selected');
      return api.sendMessageToAgent(selectedAgentId, content);
    },
    onSuccess: () => setMessage(''),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !selectedAgentId) return;
    sendMutation.mutate(message.trim());
  };

  return (
    <div className="p-4 border-t">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            selectedAgentId
              ? `Message to ${selectedAgentId}...`
              : 'Select an agent to send a message'
          }
          disabled={!selectedAgentId || sendMutation.isPending}
        />
        <Button
          type="submit"
          disabled={!selectedAgentId || !message.trim() || sendMutation.isPending}
        >
          Send
        </Button>
      </form>
    </div>
  );
}
