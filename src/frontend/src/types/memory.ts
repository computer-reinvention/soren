export interface MemorySearchResult {
  id: string;
  content: string;
  source_type: string; // 'journal' | 'artifact' | 'pattern' | 'documentation'
  source_path: string | null;
  keywords: string[];
  tags: string[];
  score: number;
  created_at: string;
  project_id: string;
}

export interface MemorySearchResponse {
  query: string;
  results: MemorySearchResult[];
  total: number;
  project_id: string | null;
}

export interface MemoryStatsResponse {
  total: number;
  by_type: Record<string, number>;
  by_project: Record<string, number>;
  query_count: number;
}
