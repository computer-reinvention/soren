import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface ToolCallDisplayProps {
  data: Record<string, unknown>;
}

export function ToolCallDisplay({ data }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  const toolName = data.tool_name as string || 'Unknown Tool';
  const input = data.input as Record<string, unknown> | undefined;
  const output = data.output as Record<string, unknown> | undefined;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          <Badge variant="outline">{toolName}</Badge>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {input && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Input:</p>
              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Output:</p>
              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                {JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
