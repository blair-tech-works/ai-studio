'use client';

import { useState } from 'react';
import { useMessages, useAgents } from '@/lib/hooks';
import { sendMessage } from '@/lib/api';

export default function MessagesPage() {
  const { messages, loading, refetch } = useMessages({ limit: 100 });
  const { agents } = useAgents();
  const [fromAgent, setFromAgent] = useState('');
  const [toAgent, setToAgent] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredMessages = messages.filter(m => {
    if (fromAgent && m.from_agent !== fromAgent) return false;
    if (toAgent && m.to_agent !== toAgent) return false;
    return true;
  });

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromAgent || !toAgent || !content) return;

    setSubmitting(true);
    try {
      await sendMessage({
        from_agent: fromAgent,
        to_agent: toAgent,
        content,
        type: 'message'
      });
      setContent('');
      await refetch();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Messages</h1>
        <p className="text-gray-400">Communication between agents and tasks</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Agent Selection */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold text-white mb-4">Agents</h2>
          <div className="card space-y-2 max-h-96 overflow-y-auto">
            {agents.length === 0 ? (
              <p className="text-gray-400 text-sm">No agents available</p>
            ) : (
              <>
                <div>
                  <p className="text-xs text-gray-400 mb-2">From:</p>
                  {agents.map(agent => (
                    <button
                      key={`from-${agent.id}`}
                      onClick={() => setFromAgent(agent.name)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        fromAgent === agent.name
                          ? 'bg-blue-500 text-white'
                          : 'text-gray-400 hover:bg-dark-border'
                      }`}
                    >
                      {agent.display_name || agent.name}
                    </button>
                  ))}
                </div>
                <hr className="border-dark-border my-3" />
                <div>
                  <p className="text-xs text-gray-400 mb-2">To:</p>
                  {agents.map(agent => (
                    <button
                      key={`to-${agent.id}`}
                      onClick={() => setToAgent(agent.name)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        toAgent === agent.name
                          ? 'bg-green-500 text-white'
                          : 'text-gray-400 hover:bg-dark-border'
                      }`}
                    >
                      {agent.display_name || agent.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="lg:col-span-3">
          {!fromAgent || !toAgent ? (
            <div className="card text-center py-12 text-gray-400">
              Select from and to agents to view messages
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-4">
                {agents.find(a => a.name === fromAgent)?.display_name || fromAgent} → {agents.find(a => a.name === toAgent)?.display_name || toAgent}
              </h2>
              <div className="card mb-4 max-h-96 overflow-y-auto space-y-3">
                {loading ? (
                  <p className="text-gray-400">Loading messages...</p>
                ) : filteredMessages.length === 0 ? (
                  <p className="text-gray-400">No messages</p>
                ) : (
                  filteredMessages.map(msg => (
                    <div
                      key={msg.id}
                      className="border border-dark-border rounded p-3"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium text-blue-400 text-sm">
                          {msg.from_agent} → {msg.to_agent}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(msg.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-purple-400 mb-1">{msg.type}</p>
                      <p className="text-sm text-gray-300">{msg.content}</p>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleSendMessage} className="space-y-3">
                <textarea
                  placeholder="Type your message..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-white placeholder-gray-500"
                  rows={3}
                />
                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  disabled={submitting}
                >
                  {submitting ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
