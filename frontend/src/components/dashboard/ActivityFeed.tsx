import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Filter } from 'lucide-react';
import { ActivityFeedItem } from './ActivityFeedItem';
import type { FeedEvent, FeedEventType } from './ActivityFeedItem';
import { apiClient } from '../../services/api';
import styles from './ActivityFeed.module.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ITEMS = 50;
const POLL_INTERVAL_MS = 5000;
const TIMESTAMP_REFRESH_MS = 60_000;

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterOption = 'all' | 'tasks' | 'payments' | 'agents';

const FILTER_LABELS: Record<FilterOption, string> = {
  all:      'All activity',
  tasks:    'Tasks only',
  payments: 'Payments only',
  agents:   'Agents only',
};

const FILTER_TYPES: Record<FilterOption, FeedEventType[]> = {
  all:      ['TaskSubmitted', 'NodeCompleted', 'PaymentReleased', 'AgentRegistered', 'DisputeRaised'],
  tasks:    ['TaskSubmitted', 'NodeCompleted', 'DisputeRaised'],
  payments: ['PaymentReleased'],
  agents:   ['AgentRegistered'],
};

// ── API ───────────────────────────────────────────────────────────────────────

interface FeedResponse {
  events: FeedEvent[];
}

async function fetchFeed(): Promise<FeedEvent[]> {
  const res = await apiClient.get<FeedResponse>('/api/events/feed');
  return res.events ?? [];
}

// ── Component ──────────────────────────────────────────────────────────────────

export const ActivityFeed: React.FC = () => {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [now, setNow] = useState(() => new Date());
  const seenIds = useRef(new Set<string>());
  const prevLengthRef = useRef(0);

  // ── Poll for new events ───────────────────────────────────────────────────

  const poll = useCallback(async () => {
    try {
      const incoming = await fetchFeed();
      setEvents((prev) => {
        const next = [...prev];
        let added = 0;
        for (const ev of incoming) {
          if (!seenIds.current.has(ev.id)) {
            seenIds.current.add(ev.id);
            next.unshift(ev); // newest first
            added++;
          }
        }
        if (added === 0) return prev; // no-op if nothing new
        // Cap at MAX_ITEMS
        return next.slice(0, MAX_ITEMS);
      });
    } catch {
      // Silently swallow — the feed is a non-critical enhancement
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // ── Refresh time-ago labels every 60 s without re-rendering items ─────────

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TIMESTAMP_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const allowed = new Set(FILTER_TYPES[filter]);
    return events.filter((e) => allowed.has(e.type));
  }, [events, filter]);

  // ── Slide-in animation for newly prepended items ──────────────────────────

  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const newCount = filtered.length - prevLengthRef.current;
    prevLengthRef.current = filtered.length;
    if (newCount <= 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLLIElement>(
      `li:nth-child(-n+${newCount})`,
    );
    items.forEach((el) => {
      el.classList.remove(styles.slideIn);
      void el.offsetWidth; // force reflow
      el.classList.add(styles.slideIn);
    });
  }, [filtered]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-testid="activity-feed">
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>Live Activity</h2>
        <div className={styles.filterWrapper}>
          <Filter size={14} className={styles.filterIcon} aria-hidden />
          <select
            className={styles.filterSelect}
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterOption)}
            aria-label="Filter activity feed"
          >
            {(Object.keys(FILTER_LABELS) as FilterOption[]).map((opt) => (
              <option key={opt} value={opt}>
                {FILTER_LABELS[opt]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className={styles.empty}>
          <span className={styles.pulse} aria-label="Loading activity…" />
          <p className={styles.emptyText}>Connecting to network…</p>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={styles.empty} data-testid="feed-empty">
          <span className={styles.pulse} aria-label="Waiting for activity" />
          <p className={styles.emptyText}>Network activity will appear here</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <ul
          ref={listRef}
          className={styles.list}
          aria-label="Network activity feed"
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions"
        >
          {filtered.map((event) => (
            <ActivityFeedItem key={event.id} event={event} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default ActivityFeed;
