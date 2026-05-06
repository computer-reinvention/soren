/**
 * Utilities for human-readable tool call summaries.
 * Used by both the chat activity indicator and the activity timeline.
 */

/**
 * Get a human-readable one-line summary of a tool call.
 * e.g. "Read src/server/config.py" or "$ git status"
 */
export function getToolSummary(toolName: string, toolInput?: unknown): string {
  const input = normalizeInput(toolInput);
  if (!input) return toolName;

  switch (toolName) {
    case 'Read': {
      const path = input.file_path as string;
      return path ? `Read ${shortenPath(path)}` : 'Read';
    }
    case 'Write': {
      const path = input.file_path as string;
      return path ? `Write ${shortenPath(path)}` : 'Write';
    }
    case 'Edit': {
      const path = input.file_path as string;
      return path ? `Edit ${shortenPath(path)}` : 'Edit';
    }
    case 'Bash': {
      const cmd = input.command as string;
      if (!cmd) return 'Bash';
      const firstLine = cmd.split('\n')[0].trim();
      return `$ ${truncate(firstLine, 60)}`;
    }
    case 'Grep': {
      const pattern = input.pattern as string;
      const path = input.path as string;
      if (pattern && path) return `Grep "${truncate(pattern, 25)}" in ${shortenPath(path)}`;
      if (pattern) return `Grep "${truncate(pattern, 40)}"`;
      return 'Grep';
    }
    case 'Glob': {
      const pattern = input.pattern as string;
      return pattern ? `Glob ${truncate(pattern, 50)}` : 'Glob';
    }
    case 'Task': {
      const prompt = input.prompt as string;
      const desc = input.description as string;
      const label = desc || prompt;
      return label ? `Task: ${truncate(label, 50)}` : 'Task';
    }
    case 'WebFetch': {
      const url = input.url as string;
      return url ? `Fetch ${truncate(url, 50)}` : 'WebFetch';
    }
    case 'WebSearch': {
      const query = input.query as string;
      return query ? `Search "${truncate(query, 45)}"` : 'WebSearch';
    }
    case 'NotebookEdit': {
      const path = input.notebook_path as string;
      return path ? `Notebook ${shortenPath(path)}` : 'NotebookEdit';
    }
    default:
      return toolName;
  }
}

/**
 * Get a human-readable action label for a tool (present participle).
 */
export function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Editing',
    Bash: 'Running command',
    Glob: 'Finding files',
    Grep: 'Searching code',
    Task: 'Running task',
    WebFetch: 'Fetching web',
    WebSearch: 'Searching web',
    AskUserQuestion: 'Waiting for input',
    NotebookEdit: 'Editing notebook',
  };
  return labels[toolName] || toolName;
}

/**
 * Extract key details from tool input for display in expanded views.
 */
export function getToolInputDetails(toolName: string, toolInput?: unknown): { label: string; value: string }[] {
  const input = normalizeInput(toolInput);
  if (!input) return [];

  const details: { label: string; value: string }[] = [];

  switch (toolName) {
    case 'Read':
      if (input.file_path) details.push({ label: 'Path', value: String(input.file_path) });
      if (input.offset) details.push({ label: 'Offset', value: `Line ${input.offset}` });
      if (input.limit) details.push({ label: 'Limit', value: `${input.limit} lines` });
      break;
    case 'Write':
      if (input.file_path) details.push({ label: 'Path', value: String(input.file_path) });
      break;
    case 'Edit':
      if (input.file_path) details.push({ label: 'Path', value: String(input.file_path) });
      if (input.old_string) details.push({ label: 'Replace', value: truncate(String(input.old_string), 100) });
      if (input.new_string) details.push({ label: 'With', value: truncate(String(input.new_string), 100) });
      break;
    case 'Bash':
      if (input.command) details.push({ label: 'Command', value: truncate(String(input.command), 200) });
      if (input.description) details.push({ label: 'Description', value: String(input.description) });
      break;
    case 'Grep':
      if (input.pattern) details.push({ label: 'Pattern', value: String(input.pattern) });
      if (input.path) details.push({ label: 'Path', value: String(input.path) });
      if (input.glob) details.push({ label: 'Glob', value: String(input.glob) });
      break;
    case 'Glob':
      if (input.pattern) details.push({ label: 'Pattern', value: String(input.pattern) });
      if (input.path) details.push({ label: 'Path', value: String(input.path) });
      break;
    case 'Task':
      if (input.description) details.push({ label: 'Description', value: String(input.description) });
      if (input.prompt) details.push({ label: 'Prompt', value: truncate(String(input.prompt), 200) });
      break;
    case 'WebFetch':
      if (input.url) details.push({ label: 'URL', value: String(input.url) });
      break;
    case 'WebSearch':
      if (input.query) details.push({ label: 'Query', value: String(input.query) });
      break;
  }

  return details;
}

/**
 * Extract meaningful content from tool output for display.
 */
export function getToolOutputSummary(toolOutput?: unknown): string | null {
  if (!toolOutput) return null;
  if (typeof toolOutput === 'string') {
    return toolOutput.length > 0 ? truncate(toolOutput, 300) : null;
  }
  const output = toolOutput as Record<string, unknown>;
  // Common patterns in tool output
  if (output.content && typeof output.content === 'string') {
    return truncate(output.content, 300);
  }
  if (output.output && typeof output.output === 'string') {
    return truncate(output.output, 300);
  }
  // Fallback: compact JSON
  const json = JSON.stringify(toolOutput);
  return json.length > 5 ? truncate(json, 300) : null;
}

// Helpers

function normalizeInput(toolInput: unknown): Record<string, unknown> | null {
  if (!toolInput) return null;
  if (typeof toolInput === 'string') {
    try {
      const parsed = JSON.parse(toolInput);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof toolInput === 'object' && toolInput !== null) {
    return toolInput as Record<string, unknown>;
  }
  return null;
}

function shortenPath(path: string, maxLen = 45): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  // Try to show the last 2-3 meaningful path segments
  if (parts.length <= 2) return truncate(path, maxLen);
  // Remove common prefixes like /Users/name/Desktop/code/...
  const srcIdx = parts.findIndex(p => p === 'src' || p === 'tools' || p === 'docs' || p === 'tests' || p === '.claude');
  if (srcIdx >= 0) {
    const shortened = parts.slice(srcIdx).join('/');
    if (shortened.length <= maxLen) return shortened;
  }
  return `.../${parts.slice(-2).join('/')}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\u2026';
}
