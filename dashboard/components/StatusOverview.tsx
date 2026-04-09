'use client';

interface StatusOverviewProps {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  sseConnected: boolean;
}

export default function StatusOverview({
  totalAgents,
  activeAgents,
  totalTasks,
  activeTasks,
  completedTasks,
  failedTasks,
  sseConnected
}: StatusOverviewProps) {
  const stats = [
    {
      label: 'Agents',
      value: activeAgents,
      total: totalAgents,
      color: 'text-green-400',
      bg: 'bg-green-500/10'
    },
    {
      label: 'Active Tasks',
      value: activeTasks,
      total: totalTasks,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10'
    },
    {
      label: 'Completed',
      value: completedTasks,
      total: totalTasks,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10'
    },
    {
      label: 'Failed',
      value: failedTasks,
      total: totalTasks,
      color: 'text-red-400',
      bg: 'bg-red-500/10'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className={`card ${stat.bg} border border-dark-border`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">{stat.label}</p>
              <p className={`text-3xl font-bold ${stat.color} mt-1`}>{stat.value}</p>
              {stat.total > 0 && (
                <p className="text-xs text-gray-500 mt-1">of {stat.total} total</p>
              )}
            </div>
            <div className="text-4xl opacity-20">{stat.value > 0 ? '✓' : '○'}</div>
          </div>
        </div>
      ))}

      {/* SSE Status */}
      <div className={`card border-2 ${sseConnected ? 'border-green-500' : 'border-red-500'}`}>
        <p className="text-gray-400 text-sm">Stream Status</p>
        <div className="flex items-center mt-2">
          <div
            className={`w-3 h-3 rounded-full mr-2 ${
              sseConnected ? 'bg-green-500 pulse' : 'bg-red-500'
            }`}
          />
          <p className={`font-medium ${sseConnected ? 'text-green-400' : 'text-red-400'}`}>
            {sseConnected ? 'Connected' : 'Disconnected'}
          </p>
        </div>
      </div>
    </div>
  );
}
