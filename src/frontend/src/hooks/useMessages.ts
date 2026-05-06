import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../lib/api';
import type { Message } from '../types/message';

const PAGE_SIZE = 50;

export function useMessages() {
  const result = useInfiniteQuery({
    queryKey: ['messages'],
    queryFn: ({ pageParam = 0 }) => api.getMessages(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.has_more) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    staleTime: 30_000,        // Prevent refetch storms within 30s
    refetchInterval: 45_000,  // Background consistency fallback
  });

  // Flatten all pages into a single deduplicated array of messages
  const messages = useMemo(() => {
    if (!result.data?.pages) return [];
    const seen = new Set<string>();
    const all: Message[] = [];
    for (const page of result.data.pages) {
      for (const msg of page.messages) {
        if (!seen.has(msg.id)) {
          seen.add(msg.id);
          all.push(msg);
        }
      }
    }
    return all;
  }, [result.data?.pages]);

  const total = result.data?.pages[0]?.total ?? 0;

  return {
    ...result,
    messages,
    total,
  };
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, content }: { agentId: string; content: string }) =>
      api.sendMessageToAgent(agentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}
