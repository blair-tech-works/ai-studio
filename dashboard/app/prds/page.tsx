'use client';

import {
  fetchPRDs,
  fetchPRDById,
  fetchAgents,
  fetchTasks,
  fetchMessages,
  publishPRD,
  overridePRD,
  submitPRDApproval,
  sendMessage,
  startAgent,
  type PRD,
  type PRDApproval,
  type Agent,
  type Task,
  type Message,
} from '@/lib/api';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function PRDsPage() {
  const [prds, setPRDs] = useState<PRD[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  // Expanded PRD detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPRD, setExpandedPRD] = useState<PRD | null>(null);
  const [showContent, setShowContent] = useState(false);
  const [showReviewDetails, setShowReviewDetails] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // Publish flow state
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);

  // Task message expansion
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Question resolution state
  const [replyingTo, setReplyingTo] = useState<string | null>(null); // agent_id
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [repliedAgents, setRepliedAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const [prdData, agentData, taskData, msgData] = await Promise.all([fetchPRDs(), fetchAgents(), fetchTasks(), fetchMessages({ limit: 100 })]);
        setPRDs(prdData);
        setAgents(agentData);
        setTasks(taskData);
        setMessages(msgData);
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
    // Poll for updates every 15s
    const interval = setInterval(async () => {
      try {
        const [prdData, agentData, taskData, msgData] = await Promise.all([fetchPRDs(), fetchAgents(), fetchTasks(), fetchMessages({ limit: 100 })]);
        setPRDs(prdData);
        setAgents(agentData);
        setTasks(taskData);
        setMessages(msgData);
        // Refresh expanded PRD if open
        if (expandedId) {
          const detail = await fetchPRDById(expandedId);
          setExpandedPRD(detail);
        }
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [expandedId]);

  const filteredPRDs =
    filter === 'all' ? prds : prds.filter((p) => p.status === filter);

  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-500/10 border-yellow-500 text-yellow-400',
    review: 'bg-blue-500/10 border-blue-500 text-blue-400',
    approved: 'bg-green-500/10 border-green-500 text-green-400',
    active: 'bg-green-500/10 border-green-500 text-green-400',
    completed: 'bg-gray-500/10 border-gray-500 text-gray-400',
  };

  const agentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.display_name || agent?.name || agentId.slice(0, 8);
  };

  const agentById = (agentId: string) => agents.find((a) => a.id === agentId);

  // Derive a richer review status from approval + agent process state + reply history
  const reviewStatus = (approval: PRDApproval) => {
    const agent = agentById(approval.agent_id);
    const agentStatus = agent?.status || 'idle';
    const wasRepliedTo = repliedAgents.has(approval.agent_id);

    if (approval.status === 'approved') return { label: 'Approved', color: 'bg-green-500/20 text-green-400 border-green-500/50', icon: '✓' };
    if (approval.status === 'questions') {
      if (agentStatus === 'active') return { label: 'Re-reviewing...', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50', icon: '◉', pulse: true };
      return { label: 'Has Questions', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50', icon: '?' };
    }
    if (approval.status === 'overridden') return { label: 'Overridden', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50', icon: '⏭' };

    // pending — check agent process state + whether we replied
    if (agentStatus === 'active' && wasRepliedTo) return { label: 'Re-reviewing...', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50', icon: '◉', pulse: true };
    if (agentStatus === 'active') return { label: 'Reviewing...', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50', icon: '◉', pulse: true };
    if (agentStatus === 'error') return { label: 'Agent Crashed', color: 'bg-red-500/20 text-red-400 border-red-500/50', icon: '✕' };
    if (wasRepliedTo) return { label: 'Reply Sent', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50', icon: '↩' };

    return { label: 'Awaiting Review', color: 'bg-gray-500/20 text-gray-400 border-gray-500/50', icon: '○' };
  };

  const handleCardClick = async (prdId: string) => {
    if (expandedId === prdId) {
      setExpandedId(null);
      setExpandedPRD(null);
      setShowContent(false);
      return;
    }
    setExpandedId(prdId);
    setShowContent(false);
    setDetailLoading(true);
    try {
      const detail = await fetchPRDById(prdId);
      setExpandedPRD(detail);
      // Auto-collapse review section if PRD is approved (show tasks instead)
      const prd = prds.find(p => p.id === prdId);
      setShowReviewDetails(prd?.status === 'review' || prd?.status === 'draft');
    } catch (err) {
      console.error('Failed to load PRD details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePublishClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPublishingId(id);
    setRepoUrl('');
    setPublishError(null);
  };

  const handlePublishConfirm = async () => {
    if (!publishingId || !repoUrl.trim()) return;
    setPublishError(null);
    setPublishLoading(true);
    try {
      await publishPRD(publishingId, repoUrl.trim());
      setPublishingId(null);
      setRepoUrl('');
      const data = await fetchPRDs();
      setPRDs(data);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish PRD');
    } finally {
      setPublishLoading(false);
    }
  };

  const handleOverride = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await overridePRD(id);
      const data = await fetchPRDs();
      setPRDs(data);
      if (expandedId === id) {
        const detail = await fetchPRDById(id);
        setExpandedPRD(detail);
      }
    } catch (err) {
      console.error('Failed to override PRD:', err);
    }
  };

  // Restart a single agent's review
  const handleRestartReview = async (agentId: string) => {
    const agent = agentById(agentId);
    if (!agent) return;
    try {
      await startAgent(agent.name);
      // Refresh to pick up active status
      const [agentData, detail] = await Promise.all([
        fetchAgents(),
        expandedId ? fetchPRDById(expandedId) : Promise.resolve(null),
      ]);
      setAgents(agentData);
      if (detail) setExpandedPRD(detail);
    } catch (err) {
      console.error('Failed to restart agent:', err);
    }
  };

  // Per-agent override: set one agent's approval to 'overridden'
  const handleAgentOverride = async (prdId: string, agentId: string) => {
    try {
      await submitPRDApproval(prdId, { agent_id: agentId, status: 'overridden', comments: 'Overridden by human' });
      const detail = await fetchPRDById(prdId);
      setExpandedPRD(detail);
      const data = await fetchPRDs();
      setPRDs(data);
    } catch (err) {
      console.error('Failed to override agent:', err);
    }
  };

  // Reply to agent questions and re-spawn for re-review
  const handleReply = async (prdId: string, agentId: string) => {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const agent = agentById(agentId);
      const agentNameStr = agent?.name || 'unknown';

      // Send human's reply as a message to the agent
      await sendMessage({
        from_agent: 'pm',
        to_agent: agentNameStr,
        content: `Human response to your PRD review questions:\n\n${replyText.trim()}`,
        type: 'message',
      });

      // Re-start the agent so it can re-review with the new context
      const repoPath = expandedPRD?.metadata?.repoPath;
      if (repoPath) {
        // Reset approval to pending before re-review
        await submitPRDApproval(prdId, { agent_id: agentId, status: 'pending' });
        try {
          await startAgent(agentNameStr);
        } catch {}
      }

      setRepliedAgents(prev => new Set(prev).add(agentId));
      setReplyingTo(null);
      setReplyText('');

      // Refresh
      const detail = await fetchPRDById(prdId);
      setExpandedPRD(detail);
      const data = await fetchPRDs();
      setPRDs(data);
    } catch (err) {
      console.error('Failed to reply:', err);
    } finally {
      setReplyLoading(false);
    }
  };

  // Simple markdown-to-html (headings, bold, lists, checkboxes, tables, paragraphs)
  const renderMarkdown = (md: string) => {
    const lines = md.split('\n');
    const html: string[] = [];
    let inTable = false;

    for (const line of lines) {
      // Table
      if (line.startsWith('|')) {
        if (line.match(/^\|[\s-|]+\|$/)) continue; // separator row
        if (!inTable) { html.push('<table class="w-full text-sm border-collapse my-2">'); inTable = true; }
        const cells = line.split('|').filter(Boolean).map((c) => c.trim());
        html.push('<tr>' + cells.map((c) => `<td class="border border-dark-border px-2 py-1 text-gray-300">${c}</td>`).join('') + '</tr>');
        continue;
      }
      if (inTable) { html.push('</table>'); inTable = false; }

      if (line.startsWith('# '))
        html.push(`<h1 class="text-xl font-bold text-white mt-4 mb-2">${line.slice(2)}</h1>`);
      else if (line.startsWith('## '))
        html.push(`<h2 class="text-lg font-semibold text-white mt-4 mb-1">${line.slice(3)}</h2>`);
      else if (line.startsWith('### '))
        html.push(`<h3 class="text-base font-medium text-white mt-3 mb-1">${line.slice(4)}</h3>`);
      else if (line.startsWith('- [ ] '))
        html.push(`<div class="flex items-start gap-2 ml-4 text-sm text-gray-300"><span class="text-gray-500 mt-0.5">☐</span><span>${styleLine(line.slice(6))}</span></div>`);
      else if (line.startsWith('- [x] '))
        html.push(`<div class="flex items-start gap-2 ml-4 text-sm text-gray-300"><span class="text-green-400 mt-0.5">☑</span><span class="line-through opacity-60">${styleLine(line.slice(6))}</span></div>`);
      else if (line.match(/^[-*] /))
        html.push(`<div class="ml-4 text-sm text-gray-300 leading-relaxed">• ${styleLine(line.slice(2))}</div>`);
      else if (line.match(/^\d+\. /))
        html.push(`<div class="ml-4 text-sm text-gray-300 leading-relaxed">${styleLine(line)}</div>`);
      else if (line === '---')
        html.push('<hr class="border-dark-border my-3" />');
      else if (line.trim() === '')
        html.push('<div class="h-2"></div>');
      else
        html.push(`<p class="text-sm text-gray-300 leading-relaxed">${styleLine(line)}</p>`);
    }
    if (inTable) html.push('</table>');
    return html.join('\n');
  };

  const styleLine = (text: string) =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="bg-dark-border px-1 rounded text-blue-300 text-xs">$1</code>');

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">PRDs</h1>
          <p className="text-gray-400">Product Requirements Documents</p>
        </div>
        <Link
          href="/prds/new"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          + Create PRD
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {['all', 'draft', 'review', 'approved', 'active', 'completed'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              filter === s ? 'bg-blue-500 text-white' : 'bg-dark-border text-gray-400 hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading PRDs...</div>
      ) : (
        <div className="space-y-3">
          {filteredPRDs.length === 0 ? (
            <div className="card"><p className="text-gray-400 text-center py-8">No PRDs found</p></div>
          ) : (
            filteredPRDs.map((prd) => (
              <div
                key={prd.id}
                className={`card border transition-colors cursor-pointer ${
                  expandedId === prd.id ? 'border-blue-500' : 'border-dark-border hover:border-blue-500/50'
                }`}
              >
                {/* Header row — always visible */}
                <div className="flex items-start justify-between" onClick={() => handleCardClick(prd.id)}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs">{expandedId === prd.id ? '▼' : '▶'}</span>
                      <h3 className="font-semibold text-white">{prd.title}</h3>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 ml-5">
                      v{prd.version} by {prd.created_by || 'human'} &middot;{' '}
                      {new Date(prd.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${statusColors[prd.status]}`}>
                      {prd.status}
                    </span>
                    {prd.status === 'draft' && publishingId !== prd.id && (
                      <button
                        onClick={(e) => handlePublishClick(prd.id, e)}
                        className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                      >
                        Publish
                      </button>
                    )}
                    {prd.status === 'review' && (
                      <button
                        onClick={(e) => handleOverride(prd.id, e)}
                        className="px-2 py-1 bg-purple-500 text-white rounded text-xs hover:bg-purple-600"
                      >
                        Override
                      </button>
                    )}
                    {(prd.status === 'approved' || prd.status === 'active') && (() => {
                      const prdTasks = tasks.filter(t => t.prd_id === prd.id);
                      const pmAgent = agents.find(a => a.name === 'pm');
                      const pmActive = pmAgent?.status === 'active';
                      return prdTasks.length > 0 ? (
                        <Link
                          href="/tasks"
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded text-xs hover:bg-green-500/30"
                        >
                          {prdTasks.filter(t => t.status === 'done').length}/{prdTasks.length} tasks
                        </Link>
                      ) : pmActive ? (
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs animate-pulse">
                          Decomposing...
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Publish flow: repo URL input */}
                {publishingId === prd.id && (
                  <div className="mt-3 p-3 bg-dark-bg rounded border border-dark-border">
                    <p className="text-sm text-gray-300 mb-2">
                      Enter the GitHub repo for this project. Agents will clone it and work in isolated worktrees.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/user/repo"
                        className="flex-1 bg-dark-card border border-dark-border rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.key === 'Enter' && handlePublishConfirm()}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePublishConfirm(); }}
                        disabled={!repoUrl.trim() || publishLoading}
                        className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {publishLoading ? 'Publishing...' : 'Publish'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPublishingId(null); }}
                        className="px-3 py-1.5 bg-dark-border text-gray-400 rounded text-sm hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                    {publishError && <p className="text-xs text-red-400 mt-2">{publishError}</p>}
                    {publishLoading && (
                      <p className="text-xs text-blue-400 mt-2">Cloning repo and starting agents... this may take 30-60 seconds.</p>
                    )}
                  </div>
                )}

                {/* Expanded detail */}
                {expandedId === prd.id && (
                  <div className="mt-4 border-t border-dark-border pt-4">
                    {detailLoading ? (
                      <p className="text-sm text-gray-400 py-4 text-center">Loading details...</p>
                    ) : expandedPRD ? (
                      <>
                        {/* Agent approval grid — collapsible when approved */}
                        {expandedPRD.approvals && expandedPRD.approvals.length > 0 && (
                          <div className="mb-4">
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowReviewDetails(!showReviewDetails); }}
                              className="flex items-center justify-between w-full mb-3"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">{showReviewDetails ? '▼' : '▶'}</span>
                                <h4 className="text-sm font-semibold text-white">Agent Review Status</h4>
                              </div>
                              <span className="text-xs text-gray-500">
                                {expandedPRD.approvals.filter((a: PRDApproval) => a.status === 'approved').length}/{expandedPRD.approvals.length} approved
                              </span>
                            </button>
                            {showReviewDetails ? (<div className="space-y-2">
                              {expandedPRD.approvals.map((approval: PRDApproval) => {
                                const status = reviewStatus(approval);
                                const agent = agentById(approval.agent_id);
                                return (
                                  <div
                                    key={approval.id}
                                    className="bg-dark-bg border border-dark-border rounded px-3 py-2.5"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className={`text-xs ${status.pulse ? 'animate-pulse' : ''}`}>{status.icon}</span>
                                        <span className="text-sm text-gray-200">{agentName(approval.agent_id)}</span>
                                        <span className="text-[10px] text-gray-500">{agent?.type || ''}</span>
                                      </div>
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${status.color}`}>
                                        {status.label}
                                      </span>
                                    </div>
                                    {approval.comments && (
                                      <div
                                        className="mt-2 pl-5 text-xs text-gray-400 border-l-2 border-dark-border"
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(approval.comments) }}
                                      />
                                    )}
                                    {status.label === 'Agent Error' && (
                                      <p className="mt-1 pl-5 text-[10px] text-red-400/70">
                                        Agent process exited. May need restart.
                                      </p>
                                    )}
                                    {/* Action: restart review for pending+idle or pending+error agents */}
                                    {approval.status === 'pending' && ((agent?.status || 'idle') === 'idle' || (agent?.status || 'idle') === 'error') && expandedPRD && (
                                      <div className="mt-3 pl-5 flex gap-2">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleRestartReview(approval.agent_id); }}
                                          className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-[11px] hover:bg-blue-500/30"
                                        >
                                          Restart Review
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleAgentOverride(expandedPRD.id, approval.agent_id); }}
                                          className="px-3 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-[11px] hover:bg-purple-500/30"
                                        >
                                          Override
                                        </button>
                                      </div>
                                    )}
                                    {/* Resolution actions for agents with questions */}
                                    {approval.status === 'questions' && expandedPRD && (
                                      <div className="mt-3 pl-5">
                                        {replyingTo === approval.agent_id ? (
                                          <div className="space-y-2">
                                            <textarea
                                              value={replyText}
                                              onChange={(e) => setReplyText(e.target.value)}
                                              placeholder="Answer the agent's questions..."
                                              rows={3}
                                              className="w-full bg-dark-card border border-dark-border rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                                              autoFocus
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                            <div className="flex gap-2">
                                              <button
                                                onClick={(e) => { e.stopPropagation(); handleReply(expandedPRD.id, approval.agent_id); }}
                                                disabled={!replyText.trim() || replyLoading}
                                                className="px-3 py-1 bg-blue-500 text-white rounded text-[11px] hover:bg-blue-600 disabled:opacity-40"
                                              >
                                                {replyLoading ? 'Sending...' : 'Reply & Re-review'}
                                              </button>
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setReplyingTo(null); setReplyText(''); }}
                                                className="px-3 py-1 bg-dark-border text-gray-400 rounded text-[11px] hover:text-white"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="flex gap-2">
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setReplyingTo(approval.agent_id); setReplyText(''); }}
                                              className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-[11px] hover:bg-blue-500/30"
                                            >
                                              Reply
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleAgentOverride(expandedPRD.id, approval.agent_id); }}
                                              className="px-3 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-[11px] hover:bg-purple-500/30"
                                            >
                                              Override
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            ) : null}
                          </div>
                        )}

                        {/* Task progress — shown when PRD has tasks */}
                        {(() => {
                          const prdTasks = tasks.filter(t => t.prd_id === expandedPRD.id);
                          if (prdTasks.length === 0) return null;

                          const statusOrder = ['in_progress', 'review', 'qa', 'todo', 'backlog', 'blocked', 'done'];
                          const sortedTasks = [...prdTasks].sort((a, b) =>
                            statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
                          );

                          const taskStatusColors: Record<string, string> = {
                            backlog: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
                            todo: 'bg-gray-500/20 text-gray-300 border-gray-500/50',
                            in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
                            review: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
                            qa: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
                            done: 'bg-green-500/20 text-green-400 border-green-500/50',
                            blocked: 'bg-red-500/20 text-red-400 border-red-500/50',
                          };

                          const done = prdTasks.filter(t => t.status === 'done').length;
                          const inProgress = prdTasks.filter(t => t.status === 'in_progress').length;

                          // Get messages related to these tasks
                          const taskIds = new Set(prdTasks.map(t => t.id));

                          return (
                            <div className="mb-4">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold text-white">Task Progress</h4>
                                <span className="text-xs text-gray-500">
                                  {done}/{prdTasks.length} done{inProgress > 0 ? `, ${inProgress} in progress` : ''}
                                </span>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full bg-dark-border rounded-full h-1.5 mb-3">
                                <div
                                  className="bg-green-500 h-1.5 rounded-full transition-all"
                                  style={{ width: `${prdTasks.length > 0 ? (done / prdTasks.length) * 100 : 0}%` }}
                                />
                              </div>

                              <div className="space-y-2">
                                {sortedTasks.map((task) => {
                                  const assignedAgent = agents.find(a => a.id === task.assigned_to);
                                  const taskMessages = messages.filter(m =>
                                    (m.from_agent === task.assigned_to || m.to_agent === task.assigned_to) &&
                                    m.content.toLowerCase().includes(task.external_id?.toLowerCase() || '___none___')
                                  );
                                  const isExpanded = expandedTaskId === task.id;

                                  return (
                                    <div
                                      key={task.id}
                                      className={`bg-dark-bg border rounded px-3 py-2 cursor-pointer transition-colors ${isExpanded ? 'border-blue-500/50' : 'border-dark-border hover:border-dark-border/80'}`}
                                      onClick={(e) => { e.stopPropagation(); setExpandedTaskId(isExpanded ? null : task.id); }}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          <span className="text-[10px] text-gray-500">{isExpanded ? '▼' : '▶'}</span>
                                          <span className="text-[10px] text-gray-500 font-mono shrink-0">{task.external_id}</span>
                                          <span className="text-xs text-gray-200 truncate">{task.title}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 ml-2">
                                          {assignedAgent && (
                                            <span className="text-[10px] text-gray-500">{assignedAgent.name}</span>
                                          )}
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${taskStatusColors[task.status] || taskStatusColors.backlog}`}>
                                            {task.status.replace('_', ' ')}
                                          </span>
                                          {taskMessages.length > 0 && (
                                            <span className="text-[10px] text-gray-500">{taskMessages.length} msg{taskMessages.length !== 1 ? 's' : ''}</span>
                                          )}
                                        </div>
                                      </div>

                                      {isExpanded && (
                                        <div className="mt-3 border-t border-dark-border pt-3">
                                          {/* Task description */}
                                          {task.description && (
                                            <div
                                              className="text-xs text-gray-400 mb-3 max-h-32 overflow-y-auto"
                                              dangerouslySetInnerHTML={{ __html: renderMarkdown(task.description) }}
                                            />
                                          )}

                                          {/* Message feed */}
                                          {taskMessages.length > 0 ? (
                                            <div>
                                              <p className="text-[10px] text-gray-500 font-medium mb-2">Messages ({taskMessages.length})</p>
                                              <div className="space-y-2 max-h-60 overflow-y-auto">
                                                {taskMessages.map((msg, idx) => (
                                                  <div key={idx} className="bg-dark-card border border-dark-border rounded px-2.5 py-2">
                                                    <div className="flex items-center justify-between mb-1">
                                                      <span className="text-[10px] text-blue-400 font-medium">
                                                        {agentName(msg.from_agent || '')}
                                                        {msg.to_agent && (<span className="text-gray-500"> → {agentName(msg.to_agent)}</span>)}
                                                      </span>
                                                      <span className="text-[9px] text-gray-600">
                                                        {new Date(msg.created_at).toLocaleTimeString()}
                                                      </span>
                                                    </div>
                                                    <div
                                                      className="text-[11px] text-gray-300 leading-relaxed"
                                                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                                                    />
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ) : (
                                            <p className="text-[10px] text-gray-500 italic">No messages yet</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* PRD content toggle */}
                        <div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowContent(!showContent); }}
                            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 mb-2"
                          >
                            <span>{showContent ? '▼' : '▶'}</span>
                            <span>{showContent ? 'Hide PRD Content' : 'Show PRD Content'}</span>
                          </button>
                          {showContent && (
                            <div
                              className="bg-dark-bg border border-dark-border rounded p-4 max-h-[600px] overflow-y-auto"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(expandedPRD.content) }}
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 py-4 text-center">Failed to load details</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
