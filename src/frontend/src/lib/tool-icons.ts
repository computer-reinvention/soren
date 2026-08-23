import {
  Terminal,
  FileText,
  FileEdit,
  Play,
  FolderSearch,
  Search,
  Globe,
} from 'lucide-react';

/** Map tool names to lucide icons for visual distinction in timelines. */
export const toolIcons: Record<string, typeof Terminal> = {
  Read: FileText,
  Write: FileEdit,
  Edit: FileEdit,
  Bash: Play,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
};

/** Look up the icon for a tool name, falling back to Terminal. */
export function getToolIcon(toolName: string | undefined): typeof Terminal {
  if (!toolName) return Terminal;
  return toolIcons[toolName] ?? Terminal;
}
