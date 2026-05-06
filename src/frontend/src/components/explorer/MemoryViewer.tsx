import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Image, FileVideo, FileAudio, FileType } from 'lucide-react';
import type { FileTreeItem } from './FileTree';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_BASE } from '@/lib/constants';

// File type detection helpers
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'];
const PDF_EXTENSIONS = ['.pdf'];

function getFileType(filename: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (PDF_EXTENSIONS.includes(ext)) return 'pdf';
  return 'text';
}

function getRawFileUrl(path: string): string {
  return `${API_BASE}/api/filesystem/raw?path=${encodeURIComponent(path)}`;
}

interface MemoryViewerProps {
  file: FileTreeItem | null;
}

export function MemoryViewer({ file }: MemoryViewerProps) {
  const fileType = file ? getFileType(file.name) : 'text';
  const isBinaryFile = fileType !== 'text';

  // Only fetch text content for text files
  const { data: content, isLoading } = useQuery({
    queryKey: ['file-content', file?.path],
    queryFn: () => api.getFileContent(file!.path),
    enabled: !!file && !isBinaryFile,
    staleTime: 30_000,
  });

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <FileText className="h-8 w-8 mr-2 opacity-30" />
        Select a file to view
      </div>
    );
  }

  const isStatusLog = file.name === 'status.log';
  const isMarkdown = file.name.endsWith('.md');
  const isJournalEntry = file.path.includes('/journal/');

  // Get appropriate icon for file type
  const FileIcon = fileType === 'image' ? Image
    : fileType === 'video' ? FileVideo
    : fileType === 'audio' ? FileAudio
    : fileType === 'pdf' ? FileType
    : FileText;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2 flex-shrink-0">
        <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium truncate">{file.name}</span>
        <span className="text-xs text-muted-foreground truncate">{file.path}</span>
      </div>

      {/* Content */}
      {isBinaryFile ? (
        <BinaryFileViewer file={file} fileType={fileType} />
      ) : isStatusLog ? (
        <div className="flex-1 min-h-0 p-3" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '0.75rem' }}>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <StatusLogViewer content={content || ''} />
            )}
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : isMarkdown || isJournalEntry ? (
              <MarkdownViewer content={content || ''} />
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                {content || 'Empty file'}
              </pre>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function StatusLogViewer({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm text-muted-foreground">No log entries</p>;
  }

  // Render as preformatted text with horizontal scroll
  return (
    <pre className="text-xs font-mono whitespace-pre text-muted-foreground">
      {content}
    </pre>
  );
}

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

interface BinaryFileViewerProps {
  file: FileTreeItem;
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'text';
}

function BinaryFileViewer({ file, fileType }: BinaryFileViewerProps) {
  const rawUrl = getRawFileUrl(file.path);

  switch (fileType) {
    case 'image':
      return (
        <div className="flex-1 flex items-center justify-center p-4 bg-muted/20">
          <img
            src={rawUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-md shadow-md"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              target.parentElement!.innerHTML = `
                <div class="text-center text-muted-foreground">
                  <p>Failed to load image</p>
                  <p class="text-xs mt-1">${file.name}</p>
                </div>
              `;
            }}
          />
        </div>
      );

    case 'video':
      return (
        <div className="flex-1 flex items-center justify-center p-4 bg-black">
          <video
            src={rawUrl}
            controls
            className="max-w-full max-h-full rounded-md"
          >
            <p className="text-white">Your browser does not support the video tag.</p>
          </video>
        </div>
      );

    case 'audio':
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
          <div className="w-24 h-24 rounded-full bg-muted/50 flex items-center justify-center">
            <FileAudio className="h-12 w-12 text-muted-foreground" />
          </div>
          <span className="text-sm font-medium">{file.name}</span>
          <audio
            src={rawUrl}
            controls
            className="w-full max-w-md"
          >
            <p>Your browser does not support the audio tag.</p>
          </audio>
        </div>
      );

    case 'pdf':
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <iframe
            src={rawUrl}
            title={file.name}
            className="flex-1 w-full border-0"
          />
        </div>
      );

    default:
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <FileType className="h-8 w-8 mr-2 opacity-30" />
          Cannot preview this file type
        </div>
      );
  }
}
