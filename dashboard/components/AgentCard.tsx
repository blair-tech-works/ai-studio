'use client';

import { Agent } from '@/lib/api';

interface AgentCardProps {
  agent: Agent;
}

export default function AgentCard({ agent }: AgentCardProps) {
  const statusColors: Record<Agent['status'], string> = {
    active: 'bg-green-500/10 border-green-500 text-green-400',
    idle: 'bg-blue-500/10 border-blue-500 text-blue-400',
    error: 'bg-red-500/10 border-red-500 text-red-400'
  };

  return (
    <div className="card hover:shadow-lg transition-all">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-white">{agent.name}</h3>
          <p className="text-xs text-gray-400 mt-1">{agent.id}</p>
        </div>
        <span
          className={`px-2 py-1 rounded text-xs font-medium border ${
            statusColors[agent.status]
          }`}
        >
          {agent.status}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Tasks Completed:</span>
          <span className="text-white font-medium">{agent.tasksCompleted}</span>
        </div>
        {agent.currentTask && (
          <div className="flex justify-between">
            <span className="text-gray-400">Current Task:</span>
            <span className="text-blue-400 truncate">{agent.currentTask}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">Last Seen:</span>
          <span className="text-gray-300 text-xs">
            {new Date(agent.lastSeen).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
}
