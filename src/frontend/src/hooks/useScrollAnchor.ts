import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@/types/message';

const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "near bottom"

/**
 * Scroll anchoring for message feeds (shared by ChatMessages/InboxView):
 * bottom-follow while near the bottom, unread counting while reading
 * history, instant anchor on initial mount and on agent switch.
 */
export function useScrollAnchor(messages: Message[]) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMessageCountRef = useRef(messages.length);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const nearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    setIsNearBottom(nearBottom);
    if (nearBottom) setUnreadCount(0);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
    setUnreadCount(0);
  }, []);

  // Instant anchor on initial mount when messages exist
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      initialScrollDone.current = true;
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }, [messages.length, scrollToBottom]);

  // New messages: follow if near bottom, else count unread
  useEffect(() => {
    const newMessages = messages.length - prevMessageCountRef.current;
    if (newMessages > 0) {
      if (isNearBottom) {
        requestAnimationFrame(() => scrollToBottom(false));
      } else {
        setUnreadCount((prev) => prev + newMessages);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Agent switch (array identity + leading id changed): reset and re-anchor
  const messagesRef = useRef(messages);
  useEffect(() => {
    const isAgentSwitch =
      messages !== messagesRef.current &&
      messages.length > 0 &&
      (messagesRef.current.length === 0 || messages[0]?.id !== messagesRef.current[0]?.id);

    if (isAgentSwitch) {
      setUnreadCount(0);
      initialScrollDone.current = true; // don't double-scroll
      prevMessageCountRef.current = messages.length;
      requestAnimationFrame(() => scrollToBottom(false));
    }
    messagesRef.current = messages;
  }, [messages, scrollToBottom]);

  return { viewportRef, bottomRef, isNearBottom, unreadCount, handleScroll, scrollToBottom };
}

interface InfiniteScrollTopOptions {
  viewportRef: React.RefObject<HTMLDivElement>;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

/**
 * Load older messages when the top sentinel becomes visible; restores the
 * scroll position after prepending so the view doesn't jump.
 */
export function useInfiniteScrollTop({
  viewportRef,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: InfiniteScrollTopOptions) {
  const topSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport || !onLoadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          const prevScrollHeight = viewport.scrollHeight;
          const prevScrollTop = viewport.scrollTop;
          onLoadMore();
          requestAnimationFrame(() => {
            const heightDiff = viewport.scrollHeight - prevScrollHeight;
            viewport.scrollTop = prevScrollTop + heightDiff;
          });
        }
      },
      { root: viewport, rootMargin: '100px 0px 0px 0px', threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewportRef, onLoadMore, hasMore, isLoadingMore]);

  return topSentinelRef;
}
