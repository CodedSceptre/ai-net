import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CheckSquare, Wallet, Search, X, Clock, Loader } from 'lucide-react';
import {
  search,
  addRecentSearch,
  getRecentSearches,
  clearRecentSearches,
} from '../../services/searchService';
import type { SearchResult, SearchEntityType } from '../../services/searchService';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './GlobalSearch.module.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENTITY_ICON: Record<SearchEntityType, React.ReactNode> = {
  agent:   <Bot   size={15} aria-hidden />,
  task:    <CheckSquare size={15} aria-hidden />,
  payment: <Wallet size={15} aria-hidden />,
};

const ENTITY_LABEL: Record<SearchEntityType, string> = {
  agent:   'Agents',
  task:    'Tasks',
  payment: 'Payments',
};

const ENTITY_ORDER: SearchEntityType[] = ['agent', 'task', 'payment'];

function groupResults(results: SearchResult[]): Record<SearchEntityType, SearchResult[]> {
  const grouped: Record<SearchEntityType, SearchResult[]> = { agent: [], task: [], payment: [] };
  for (const r of results) {
    if (grouped[r.type]) grouped[r.type].push(r);
  }
  return grouped;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const GlobalSearch: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(isOpen);
  const navigate = useNavigate();
  const debouncedQuery = useDebounce(query, 300);

  // Flatten results for keyboard navigation
  const grouped = groupResults(results);
  const flatResults: SearchResult[] = ENTITY_ORDER.flatMap((t) => grouped[t].slice(0, 3));

  // ── Open / close ────────────────────────────────────────────────────────────

  const open = useCallback(() => {
    setRecentSearches(getRecentSearches());
    setIsOpen(true);
    setQuery('');
    setResults([]);
    setActiveIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setActiveIndex(-1);
  }, []);

  // ── Global keyboard shortcut: / or Ctrl+K ───────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      if ((e.key === '/' && !isEditable) || ((e.ctrlKey || e.metaKey) && e.key === 'k')) {
        e.preventDefault();
        if (isOpen) close();
        else open();
      }
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen, open, close]);

  // ── Fetch results on debounced query ────────────────────────────────────────

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    search(debouncedQuery)
      .then((res) => {
        if (!cancelled) {
          setResults(res.results);
          setActiveIndex(-1);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  const navigateTo = useCallback(
    (result: SearchResult) => {
      addRecentSearch(query || result.title);
      navigate(result.href);
      close();
    },
    [navigate, close, query],
  );

  const handleRecentSearch = useCallback(
    (term: string) => {
      setQuery(term);
      inputRef.current?.focus();
    },
    [],
  );

  // ── Keyboard navigation inside the list ────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!flatResults.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      navigateTo(flatResults[activeIndex]);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const showRecent = !query && recentSearches.length > 0;
  const showNoResults = !loading && query.trim() && results.length === 0;
  const showResults = !loading && results.length > 0;

  return (
    <>
      {/* Trigger button in the nav */}
      <button
        type="button"
        className={styles.trigger}
        onClick={open}
        aria-label="Open global search (/ or Ctrl+K)"
      >
        <Search size={16} aria-hidden />
        <span className={styles.triggerLabel}>Search</span>
        <span className={styles.shortcutHint} aria-hidden>
          <kbd>/</kbd>
        </span>
      </button>

      {/* Overlay + panel */}
      {isOpen && (
        <div className={styles.overlay} onClick={close}>
          <div
            ref={panelRef}
            className={styles.panel}
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label="Global search"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            {/* Input row */}
            <div className={styles.inputRow}>
              <Search size={16} className={styles.inputIcon} aria-hidden />
              <input
                ref={inputRef}
                type="text"
                role="searchbox"
                aria-label="Search agents, tasks, payments"
                aria-autocomplete="list"
                aria-controls="gs-listbox"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents, tasks, payments…"
                className={styles.input}
              />
              {loading && <Loader size={16} className={styles.spinner} aria-label="Searching…" />}
              {query && !loading && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
                  className={styles.clearBtn}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Results */}
            <div id="gs-listbox" role="listbox" className={styles.body}>

              {/* Recent searches */}
              {showRecent && (
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <span>Recent</span>
                    <button
                      type="button"
                      className={styles.clearRecentBtn}
                      onClick={() => { clearRecentSearches(); setRecentSearches([]); }}
                    >
                      Clear
                    </button>
                  </div>
                  {recentSearches.map((term) => (
                    <button
                      key={term}
                      type="button"
                      className={styles.recentItem}
                      onClick={() => handleRecentSearch(term)}
                    >
                      <Clock size={13} className={styles.recentIcon} aria-hidden />
                      <span>{term}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Grouped results */}
              {showResults &&
                ENTITY_ORDER.map((type) => {
                  const items = grouped[type].slice(0, 3);
                  if (!items.length) return null;
                  return (
                    <div key={type} className={styles.section}>
                      <div className={styles.sectionHeader}>
                        <span className={styles.entityIcon}>{ENTITY_ICON[type]}</span>
                        <span>{ENTITY_LABEL[type]}</span>
                      </div>
                      {items.map((result) => {
                        const flatIdx = flatResults.indexOf(result);
                        return (
                          <button
                            key={result.id}
                            type="button"
                            role="option"
                            aria-selected={activeIndex === flatIdx}
                            className={`${styles.resultItem} ${activeIndex === flatIdx ? styles.active : ''}`}
                            onClick={() => navigateTo(result)}
                          >
                            <span className={styles.resultIcon}>{ENTITY_ICON[type]}</span>
                            <span className={styles.resultText}>
                              <span className={styles.resultTitle}>{result.title}</span>
                              <span className={styles.resultSubtitle}>{result.subtitle}</span>
                            </span>
                            <span className={`${styles.typeBadge} ${styles[`badge_${type}`]}`}>
                              {type}
                            </span>
                          </button>
                        );
                      })}
                      {/* View all link */}
                      <a
                        href={`/${type}s?q=${encodeURIComponent(query)}`}
                        className={styles.viewAll}
                        onClick={close}
                      >
                        View all {ENTITY_LABEL[type].toLowerCase()} matching "{query}"
                      </a>
                    </div>
                  );
                })}

              {/* No results */}
              {showNoResults && (
                <div className={styles.empty}>
                  <p className={styles.emptyMsg}>No results for <strong>"{query}"</strong></p>
                  <ul className={styles.suggestions}>
                    <li><a href="/tasks/new" onClick={close}>Submit a new task</a></li>
                    <li><a href="/agents" onClick={close}>Browse all agents</a></li>
                    <li><a href="/wallet" onClick={close}>View wallet &amp; payments</a></li>
                  </ul>
                </div>
              )}

              {/* Empty state — nothing typed, no recents */}
              {!query && !recentSearches.length && (
                <p className={styles.hint}>
                  Type to search agents, tasks, and payments.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalSearch;
