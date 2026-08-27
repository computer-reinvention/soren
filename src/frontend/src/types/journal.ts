// Journal storage is split into isolated scopes: a single global
// "supervisor" journal, and one private journal per team
// (.soren/journal/teams/<prefix>/). Every read/write endpoint accepts an
// optional scope + team pair, defaulting to "supervisor".
export type JournalScope = 'supervisor' | 'team';

export interface JournalScopeParams {
  scope?: JournalScope;
  team?: string;
}

export interface JournalDayResponse {
  date: string;
  content: string;
  artifacts: string[];
}

export interface JournalDatesResponse {
  dates: string[];
}

export interface JournalTeamsResponse {
  teams: string[];
}

export interface JournalSearchResult {
  date: string;
  title: string;
  snippet: string;
  line_number: number;
}

export interface JournalSearchResponse {
  query: string;
  results: JournalSearchResult[];
  total: number;
}

export interface JournalEntryCreate {
  title: string;
  content: string;
  project_id?: string;
  tags?: string[];
  scope?: JournalScope;
  team?: string;
}

// Journal Intelligence types
export interface RecurringIssue {
  canonical_title: string;
  occurrences: number;
  distinct_dates: number;
  dates: string[];
  variant_titles: string[];
}

export interface RecurringIssuesResponse {
  recurring_issues: RecurringIssue[];
  total_clusters: number;
}

export interface WeeklySummaryTag {
  tag: string;
  count: number;
}

export interface WeeklySummaryResponse {
  week_start: string;
  week_end: string;
  total_entries: number;
  entries_per_day: Record<string, number>;
  top_tags: WeeklySummaryTag[];
  commit_count: number;
  task_completions: number;
}

export interface CorrectionCompliance {
  id: string;
  category: string;
  rule: string;
  added: string;
  total_relevant_entries: number;
  violations: number;
  compliance_rate: number;
}

export interface CorrectionComplianceResponse {
  corrections: CorrectionCompliance[];
  overall_compliance: number;
  total_rules: number;
}
