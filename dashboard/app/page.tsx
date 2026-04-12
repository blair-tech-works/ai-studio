'use client';

import { useAgents, useTasks, useSSE } from '@/lib/hooks';
import { fetchPRDs, type PRD } from '@/lib/api';
import { useEffect, useState } from 'react';

const LANES = [
  { key: 'backlog', label: 'Backlog', color: 'border-gray-600' },
  { key: 'todo', label: 'To Do', color: 'border-gray-500' },
  { key: 'in_progress', label: 'In Progress', color: 'border-blue-500' },
  { key: 'review', label: 'Review', color: 'border-purple-500' },
  { key: 'qa', label: 'QA', color: 'border-yellow-500' },
  { key: 'done', label: 'Done', color: 'border-green-500' },
  { key: 'blocked', label: 'Blocked', color: 'border-red-500' },
];

const priorityColors: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-blue-400',
  low: 'text-gray-400',
};

// Deterministic color from string — same name always gets the same hue
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

// Short PRD label — first meaningful words, max ~20 chars
function shortPrdName(title: string): string {
  return title
    .replace(/^PRD:\s*/i, '')
    .replace(/\s*[-—]\s*v\d.*$/i, '')
    .slice(0, 22)
    .trim();
}

export default function Dashboard() {
  const { agents } = useAgents();
  const { tasks } = useTasks();
  const { connected } = useSSE();
  const [prds, setPrds] = useState<PRD[]>([]);

  useEffect(() => {
    fetchPRDs().then(setPrds).catch(() => {});
    const interval = setInterval(() => fetchPRDs().then(setPrds).catch(() => {}), 15000);
    return () => clearInterval(interval);
  }, []);

  const agentForId = (id: string) => agents.find((a) => a.id === id);
  const agentName = (id: string) => agentForId(id)?.name || '';

  const prdForTask = (prdId?: string) => prds.find((p) => p.id === prdId);

  // Only show lanes that have tasks (except always show todo, in_progress, done)
  const alwaysShow = new Set(['todo', 'in_progress', 'done']);
  const activeLanes = LANES.filter(
    (lane) => alwaysShow.has(lane.key) || tasks.some((t) => t.status === lane.key)
  );

  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const connectedCount = agents.filter((a) => a.connected).length;

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-gray-500">
            {connectedCount} agent{connectedCount !== 1 ? 's' : ''} connected &middot; {done}/{total} tasks done &middot;{' '}
            <span className={connected ? 'text-green-400' : 'text-red-400'}>
              {connected ? 'connected' : 'disconnected'}
            </span>
          </p>
        </div>
      </div>

      {/* Swim lanes */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 h-full min-w-0" style={{ minHeight: 'calc(100vh - 140px)' }}>
          {activeLanes.map((lane) => {
            const laneTasks = tasks.filter((t) => t.status === lane.key);

            return (
              <div
                key={lane.key}
                className={`flex-shrink-0 w-56 flex flex-col border-t-2 ${lane.color} bg-dark-card/50 rounded-lg`}
              >
                {/* Lane header */}
                <div className="px-3 py-2 flex items-center justify-between shrink-0">
                  <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    {lane.label}
                  </h3>
                  <span className="text-[10px] text-gray-500 bg-dark-border rounded-full px-1.5 py-0.5">
                    {laneTasks.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {laneTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-dark-bg border border-dark-border rounded p-2.5 hover:border-blue-500/40 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-500 font-mono">{task.external_id}</span>
                        {(() => {
                          const prd = prdForTask(task.prd_id);
                          if (!prd) return null;
                          const color = stringToColor(prd.title);
                          return (
                            <span
                              className="text-[9px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[100px]"
                              style={{ backgroundColor: color + '22', color, borderColor: color + '44', borderWidth: 1 }}
                            >
                              {shortPrdName(prd.title)}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-xs text-gray-200 leading-snug line-clamp-2">{task.title}</p>
                      <div className="flex items-center justify-between mt-2">
                        {task.assigned_to ? (() => {
                          const agent = agentForId(task.assigned_to);
                          const connected = agent?.connected;
                          return (
                            <div className="flex items-center gap-1 min-w-0">
                              {connected ? (
                                <span className="shrink-0 text-[10px] animate-pulse text-green-400">⚡</span>
                              ) : (
                                <span className="shrink-0 text-[10px] text-gray-600">⏸</span>
                              )}
                              <span className={`text-[10px] truncate max-w-[80px] ${connected ? 'text-gray-400' : 'text-gray-600'}`}>
                                {agentName(task.assigned_to)}
                              </span>
                            </div>
                          );
                        })() : (
                          <span className="text-[10px] text-gray-600">unassigned</span>
                        )}
                        <span className={`text-[10px] ${priorityColors[task.priority] || 'text-gray-500'}`}>
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  ))}

                  {laneTasks.length === 0 && (
                    <p className="text-[10px] text-gray-600 text-center py-4 italic">empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
