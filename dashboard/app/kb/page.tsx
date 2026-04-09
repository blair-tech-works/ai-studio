'use client';

import { fetchKB, type KBArticle } from '@/lib/api';
import { useEffect, useState } from 'react';

export default function KBPage() {
  const [entries, setEntries] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const loadKB = async () => {
      try {
        const data = await fetchKB(searchTerm ? { search: searchTerm } : undefined);
        setEntries(data);
      } catch (err) {
        console.error('Failed to load KB:', err);
      } finally {
        setLoading(false);
      }
    };

    loadKB();
  }, [searchTerm]);

  const categories = Array.from(new Set(entries.flatMap(e => e.tags)));
  
  const filteredEntries = entries.filter(e =>
    e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Knowledge Base</h1>
        <p className="text-gray-400">Searchable repository of documentation and information</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Tags */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold text-white mb-4">Tags</h2>
          <div className="card space-y-2 max-h-96 overflow-y-auto">
            <button
              onClick={() => setSearchTerm('')}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                searchTerm === ''
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:bg-dark-border'
              }`}
            >
              All ({entries.length})
            </button>
            {categories.map(tag => {
              const count = entries.filter(e => e.tags.includes(tag)).length;
              return (
                <button
                  key={tag}
                  onClick={() => setSearchTerm(tag)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    searchTerm === tag
                      ? 'bg-blue-500 text-white'
                      : 'text-gray-400 hover:bg-dark-border'
                  }`}
                >
                  {tag} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search entries..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-dark-bg border border-dark-border rounded px-4 py-2 text-white placeholder-gray-500"
            />
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading knowledge base...</div>
          ) : (
            <div className="card">
              {filteredEntries.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No entries found</p>
              ) : (
                <div className="space-y-3">
                  {filteredEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="border border-dark-border rounded p-4 hover:border-blue-500 transition-colors"
                    >
                      <div className="mb-2">
                        <h3 className="font-semibold text-white">{entry.title}</h3>
                        <p className="text-xs text-blue-400 mt-1">{entry.path}</p>
                      </div>
                      {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {entry.tags.map(tag => (
                            <span
                              key={tag}
                              className="px-2 py-1 rounded text-xs bg-dark-border text-gray-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        <p>Created: {new Date(entry.created_at).toLocaleDateString()}</p>
                        <p>Updated: {new Date(entry.updated_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
