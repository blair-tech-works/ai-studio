'use client';

import { useAgents, useTasks, useSSE } from '@/lib/hooks';
import AgentCard from '@/components/AgentCard';
import TaskList from '@/components/TaskList';
import StatusOverview from '@/components/StatusOverview';

export default function Dashboard() {
  const { agents, loading: agentsLoading } = useAgents();
  const { tasks, loading: tasksLoading } = useTasks();
  const { events, connected } = useSSE();

  const activeTasks = tasks.filter((t) => t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">
          Real-time monitoring of agents, tasks, and system activity
        </p>
      </div>

      {/* Status Overview */}
      <StatusOverview
        totalAgents={agents.length}
        activeAgents={agents.filter((a) => a.status === 'active').length}
        totalTasks={tasks.length}
        activeTasks={activeTasks.length}
        completedTasks={completedTasks.length}
        failedTasks={failedTasks.length}
        sseConnected={connected}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        {/* Agents Section */}
        <div className="lg:col-span-1">
          <h2 className="text-xl font-semibold text-white mb-4">Agents ({agents.length})</h2>
          {agentsLoading ? (
            <div className="text-center py-8 text-gray-400">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No agents available</div>
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Tasks Section */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-semibold text-white mb-4">Recent Tasks ({tasks.length})</h2>
          {tasksLoading ? (
            <div className="text-center py-8 text-gray-400">Loading tasks...</div>
          ) : (
            <TaskList tasks={tasks.slice(0, 10)} />
          )}
        </div>
      </div>

      {/* Recent Events */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold text-white mb-4">
          Recent Activity ({events.length})
        </h2>
        <div className="card max-h-80 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-gray-400">No recent events</p>
          ) : (
            <div className="space-y-2">
              {[...events].reverse().map((event, idx) => (
                <div
                  key={idx}
                  className="text-sm border-b border-dark-border pb-2 last:border-0"
                >
                  <p className="text-blue-400 font-mono text-xs">{event.type}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
