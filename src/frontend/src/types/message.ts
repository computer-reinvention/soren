export type MessageType = 'task' | 'status' | 'response' | 'error' | 'user' | 'mailbox' | 'system';

export interface Message {
  id: string;
  timestamp: string;
  from_agent: string;
  to_agent: string;
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MessageListResponse {
  messages: Message[];
  total: number;
  has_more: boolean;
}

export interface UserMessagePayload {
  content: string;
  from_agent?: string;
}
