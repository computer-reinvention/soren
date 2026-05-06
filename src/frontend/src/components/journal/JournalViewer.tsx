import { useState } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { useJournal, useJournalDates, useJournalSearch } from '@/hooks/useJournal';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/projectStore';
import { WeeklySummaryCards } from './WeeklySummaryCards';
import { RecurringIssuesTable } from './RecurringIssuesTable';
import { CorrectionCompliancePanel } from './CorrectionCompliancePanel';

export function JournalViewer() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [journalProjectFilter, setJournalProjectFilter] = useState<string | null>(null);
  const { selectedProjectId } = useProjectStore();
  const { data: projectsData } = useProjects();

  // Use local filter if set, otherwise fall back to global project selection
  const effectiveProjectId = journalProjectFilter ?? selectedProjectId;

  const { data: dates, isLoading: datesLoading } = useJournalDates();
  const { data: journal, isLoading: journalLoading } = useJournal(selectedDate, effectiveProjectId);
  const { data: searchResults } = useJournalSearch(searchQuery, isSearching);

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setIsSearching(false);
    setSearchQuery('');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setIsSearching(true);
    }
  };

  return (
    <div className="h-full flex">
      {/* Sidebar with dates */}
      <div className="w-48 border-r flex flex-col">
        <div className="p-3 border-b">
          <h3 className="font-medium text-sm">Journal Dates</h3>
        </div>
        <ScrollArea className="flex-1">
          {datesLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading...</p>
          ) : !dates?.dates.length ? (
            <p className="p-3 text-sm text-muted-foreground">No journals yet</p>
          ) : (
            <div className="divide-y">
              {dates.dates.map((date) => (
                <button
                  key={date}
                  onClick={() => handleDateSelect(date)}
                  className={`w-full p-2 text-left text-xs hover:bg-muted/50 transition-colors ${
                    selectedDate === date ? 'bg-muted font-medium' : ''
                  }`}
                >
                  {formatDate(date)}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">
            {isSearching
              ? `Search: "${searchQuery}"`
              : selectedDate
              ? formatDate(selectedDate)
              : 'Select a date'}
          </span>
          <div className="flex items-center gap-1">
            {/* Project filter dropdown */}
            {projectsData && projectsData.projects.length > 0 && (
              <select
                value={journalProjectFilter ?? ''}
                onChange={(e) => setJournalProjectFilter(e.target.value || null)}
                className="h-7 text-xs rounded-md border bg-background px-2"
              >
                <option value="">All Projects</option>
                {projectsData.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <form onSubmit={handleSearch} className="flex gap-1">
              <Input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) setIsSearching(false);
                }}
                className="w-32 h-7 text-xs"
              />
              <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
                Go
              </Button>
            </form>
          </div>
        </div>

        {/* Insights section */}
        {!isSearching && !selectedDate && (
          <div className="p-3 space-y-4 border-b">
            <WeeklySummaryCards />
            <div className="border-t pt-3">
              <RecurringIssuesTable />
            </div>
            <div className="border-t pt-3">
              <CorrectionCompliancePanel />
            </div>
          </div>
        )}

        <ScrollArea className="flex-1">
          {isSearching ? (
            <div className="p-3 space-y-2">
              {!searchResults?.results.length ? (
                <p className="text-sm text-muted-foreground">No results found</p>
              ) : (
                searchResults.results.map((result, idx) => (
                  <Card
                    key={`${result.date}-${idx}`}
                    className="p-2 cursor-pointer hover:bg-muted/50"
                    onClick={() => handleDateSelect(result.date)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px]">{result.date}</Badge>
                      <span className="text-xs font-medium truncate">{result.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{result.snippet}</p>
                  </Card>
                ))
              )}
            </div>
          ) : journalLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading...</p>
          ) : !selectedDate ? (
            <div className="p-6 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📓</div>
              <p className="text-sm">Select a date to view journal entries</p>
              <p className="text-xs mt-1">The journal captures the system's memory and learnings</p>
            </div>
          ) : !journal?.content ? (
            <p className="p-3 text-sm text-muted-foreground">No entries for this date</p>
          ) : (
            <div className="p-3">
              <JournalContent content={journal.content} />
              {journal.artifacts.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <div>
                    <h4 className="text-xs font-medium mb-2">Artifacts</h4>
                    <div className="flex flex-wrap gap-1">
                      {journal.artifacts.map((artifact) => (
                        <Badge key={artifact} variant="secondary" className="text-[10px]">
                          {artifact}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function JournalContent({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="space-y-1 text-sm">
      {lines.map((line, idx) => {
        if (line.startsWith('# ')) {
          return <h1 key={idx} className="text-base font-bold mt-2">{line.slice(2)}</h1>;
        }
        if (line.startsWith('## ')) {
          return <h2 key={idx} className="text-sm font-semibold mt-2 text-primary">{line.slice(3)}</h2>;
        }
        if (line.startsWith('- ')) {
          return <li key={idx} className="ml-3 text-xs list-disc">{line.slice(2)}</li>;
        }
        if (line.trim() === '') {
          return <div key={idx} className="h-1" />;
        }
        return <p key={idx} className="text-xs">{line}</p>;
      })}
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
