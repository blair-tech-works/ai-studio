'use client';

import { useMemo, useState } from 'react';
import { useMessages, useAgents } from '@/lib/hooks';
import { sendMessage } from '@/lib/api';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

const MESSAGE_FILTERS = { limit: 100 } as const;

export default function MessagesPage() {
  const { messages, loading, refetch } = useMessages(MESSAGE_FILTERS);
  const { agents } = useAgents();

  const [fromFilter, setFromFilter] = useState<string>('');
  const [toFilter, setToFilter] = useState<string>('');
  const [composing, setComposing] = useState(false);
  const [composeFrom, setComposeFrom] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeContent, setComposeContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (fromFilter && m.from_agent !== fromFilter) return false;
        if (toFilter && m.to_agent !== toFilter) return false;
        return true;
      }),
    [messages, fromFilter, toFilter]
  );

  const agentLabel = (name: string) =>
    agents.find((a) => a.name === name)?.display_name || name;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeFrom || !composeTo || !composeContent.trim()) return;
    setSubmitting(true);
    try {
      await sendMessage({
        from_agent: composeFrom,
        to_agent: composeTo,
        content: composeContent,
        type: 'message'
      });
      setComposeContent('');
      setComposing(false);
      await refetch();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-7 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Messages</h1>
          <p className="text-sm text-text-secondary mt-1">
            Communication between agents and tasks
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setComposing((c) => !c)}>
          {composing ? 'Cancel' : 'New Message'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted uppercase tracking-wider">From</span>
          <select
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            className="bg-surface border border-border-subtle rounded-md px-2.5 py-1 text-sm text-text-primary focus-ring"
          >
            <option value="">Any</option>
            {agents.map((a) => (
              <option key={a.id} value={a.name}>
                {a.display_name || a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted uppercase tracking-wider">To</span>
          <select
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
            className="bg-surface border border-border-subtle rounded-md px-2.5 py-1 text-sm text-text-primary focus-ring"
          >
            <option value="">Any</option>
            {agents.map((a) => (
              <option key={a.id} value={a.name}>
                {a.display_name || a.name}
              </option>
            ))}
          </select>
        </div>
        {(fromFilter || toFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setFromFilter(''); setToFilter(''); }}>
            Clear
          </Button>
        )}
        <span className="text-xs text-text-muted ml-auto font-mono">
          {filteredMessages.length} of {messages.length}
        </span>
      </div>

      {/* Compose */}
      {composing && (
        <form
          onSubmit={handleSend}
          className="bg-surface border border-border-subtle rounded-lg p-4 mb-6 space-y-3"
        >
          <div className="flex gap-3">
            <select
              value={composeFrom}
              onChange={(e) => setComposeFrom(e.target.value)}
              className="flex-1 bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 text-sm text-text-primary focus-ring"
              required
            >
              <option value="">From agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.display_name || a.name}
                </option>
              ))}
            </select>
            <span className="text-text-muted self-center">→</span>
            <select
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              className="flex-1 bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 text-sm text-text-primary focus-ring"
              required
            >
              <option value="">To agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.display_name || a.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Message…"
            value={composeContent}
            onChange={(e) => setComposeContent(e.target.value)}
            className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-muted focus-ring resize-none"
            rows={3}
            required
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting || !composeFrom || !composeTo || !composeContent.trim()}
            >
              {submitting ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      )}

      {/* Message list */}
      {loading && messages.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">Loading messages…</div>
      ) : filteredMessages.length === 0 ? (
        <div className="bg-surface border border-border-subtle rounded-lg p-8 text-center text-text-secondary text-sm">
          {messages.length === 0
            ? 'No messages yet'
            : 'No messages match the current filters'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMessages.map((msg) => (
            <div
              key={msg.id}
              className="bg-surface border border-border-subtle rounded-lg p-3 hover:border-border-strong transition-colors duration-150"
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-text-primary truncate">
                    {agentLabel(msg.from_agent)}
                  </span>
                  <span className="text-text-muted">→</span>
                  <span className="text-sm font-medium text-text-primary truncate">
                    {agentLabel(msg.to_agent)}
                  </span>
                  <Badge variant={msg.type === 'message' ? 'neutral' : 'accent'}>
                    {msg.type}
                  </Badge>
                </div>
                <span className="text-[11px] text-text-muted font-mono flex-shrink-0">
                  {new Date(msg.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
