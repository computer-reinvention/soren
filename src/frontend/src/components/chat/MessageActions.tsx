import { useState } from 'react';
import { Copy, Check, FileText, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface MessageActionsProps {
  content: string;
  isUser?: boolean;
  className?: string;
}

export function MessageActions({
  content,
  isUser,
  className,
}: MessageActionsProps) {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Extract code blocks from content
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  const hasCode = codeBlocks.length > 0;

  const copyToClipboard = async (text: string, type: 'text' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'text') {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleCopyText = () => {
    copyToClipboard(content, 'text');
  };

  const handleCopyCode = () => {
    // Strip the ``` markers and join all code blocks
    const code = codeBlocks
      .map((block) => block.replace(/```\w*\n?/g, '').replace(/```$/g, '').trim())
      .join('\n\n');
    copyToClipboard(code, 'code');
  };

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 opacity-0 group-hover:opacity-100',
        'transition-opacity duration-150',
        className
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6',
              isUser
                ? 'hover:bg-primary-foreground/20 text-primary-foreground/70'
                : 'hover:bg-muted-foreground/20 text-muted-foreground'
            )}
            onClick={handleCopyText}
          >
            {copiedText ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {copiedText ? 'Copied!' : 'Copy message'}
        </TooltipContent>
      </Tooltip>

      {hasCode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6',
                isUser
                  ? 'hover:bg-primary-foreground/20 text-primary-foreground/70'
                  : 'hover:bg-muted-foreground/20 text-muted-foreground'
              )}
              onClick={handleCopyCode}
            >
              {copiedCode ? (
                <Check className="h-3 w-3" />
              ) : (
                <Code className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {copiedCode ? 'Copied!' : 'Copy code'}
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6',
              isUser
                ? 'hover:bg-primary-foreground/20 text-primary-foreground/70'
                : 'hover:bg-muted-foreground/20 text-muted-foreground'
            )}
            onClick={() => {
              // Open raw content in a new window
              const win = window.open('', '_blank');
              if (win) {
                win.document.write(
                  `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; padding: 16px;">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
                );
                win.document.title = 'Raw Message';
              }
            }}
          >
            <FileText className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          View raw
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
