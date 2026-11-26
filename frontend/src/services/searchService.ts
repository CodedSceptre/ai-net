import { apiClient } from './api';

export type SearchEntityType = 'agent' | 'task' | 'payment';

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

const TYPES_PARAM = 'agent,task,payment';

export async function search(query: string): Promise<SearchResponse> {
  if (!query.trim()) return { results: [], total: 0 };
  const encoded = encodeURIComponent(query.trim());
  return apiClient.get<SearchResponse>(`/api/search?q=${encoded}&types=${TYPES_PARAM}`);
}

// ── Recent searches (localStorage) ───────────────────────────────────────────

const STORAGE_KEY = 'ai-net:recent-searches';
const MAX_RECENT = 8;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  if (!query.trim()) return;
  const list = getRecentSearches().filter((q) => q !== query);
  list.unshift(query);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // localStorage may be unavailable in some environments
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
