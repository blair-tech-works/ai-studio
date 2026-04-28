'use client';

import { fetchKB, type KBArticle } from '@/lib/api';
import { useEffect, useMemo, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

// Tags from the API can come back as either string[] or as a Record<string, boolean>.
// Normalize to a clean string array.
function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }
  return [];
}

interface KBEntry extends Omit<KBArticle, 'tags'> {
  tags: string[];
}

export default function KBPage() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTag, setActiveTag] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchKB();
        if (cancelled) return;
        setEntries(
          (data as unknown as KBArticle[]).map((e) => ({
            ...e,
            tags: normalizeTags((e as { tags: unknown }).tags)
          }))
        );
      } catch (err) {
        console.error('Failed to load KB:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeTag && !e.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, searchTerm, activeTag]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Knowledge Base</h1>
        <p className="text-sm text-text-secondary mt-1">
          Searchable repository of documentation and information
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Tags */}
        <aside className="lg:col-span-1">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Tags
          </h2>
          <div className="bg-surface border border-border-subtle rounded-lg p-2 space-y-0.5 max-h-[28rem] overflow-y-auto">
            <button
              onClick={() => setActiveTag('')}
              className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors duration-150 focus-ring flex items-center justify-between ${
                activeTag === ''
                  ? 'bg-accent-500/10 text-text-accent font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }`}
            >
              <span>All</span>
              <span className="font-mono text-[11px] text-text-muted">{entries.length}</span>
            </button>
            {allTags.map(([tag, count]) => {
              const isActive = activeTag === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setActiveTag(isActive ? '' : tag)}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors duration-150 focus-ring flex items-center justify-between ${
                    isActive
                      ? 'bg-accent-500/10 text-text-accent font-medium'
                      : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
                  }`}
                >
                  <span className="truncate">{tag}</span>
                  <span className="font-mono text-[11px] text-text-muted ml-2">{count}</span>
                </button>
              );
            })}
            {allTags.length === 0 && !loading && (
              <p className="text-text-muted text-xs px-2.5 py-1.5">No tags</p>
            )}
          </div>
        </aside>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="mb-4 flex items-center gap-3">
            <input
              type="text"
              placeholder="Search articles…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-surface border border-border-subtle rounded-md px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus-ring"
            />
            {(searchTerm || activeTag) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setActiveTag('');
                }}
              >
                Clear
              </Button>
            )}
            <span className="text-xs text-text-muted font-mono">
              {filteredEntries.length} of {entries.length}
            </span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-text-secondary text-sm">
              Loading knowledge base…
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="bg-surface border border-border-subtle rounded-lg p-8 text-center text-text-secondary text-sm">
              {entries.length === 0 ? 'No articles yet' : 'No articles match'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-surface border border-border-subtle rounded-lg p-4 hover:border-border-strong transition-colors duration-150"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-text-primary truncate">{entry.title}</h3>
                      <p className="text-xs text-text-muted font-mono mt-0.5 truncate">{entry.path}</p>
                    </div>
                    <span className="text-[11px] text-text-muted font-mono flex-shrink-0">
                      {new Date(entry.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  {entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {entry.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant={tag === activeTag ? 'accent' : 'neutral'}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
