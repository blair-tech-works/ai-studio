'use client';

import { Task } from '@/lib/api';

interface TaskListProps {
  tasks: Task[];
}

export default function TaskList({ tasks }: TaskListProps) {
  const statusColors: Record<Task['status'], string> = {
    pending: 'bg-yellow-500/10 border-yellow-500 text-yellow-400',
    in_progress: 'bg-blue-500/10 border-blue-500 text-blue-400',
    completed: 'bg-green-500/10 border-green-500 text-green-400',
    failed: 'bg-red-500/10 border-red-500 text-red-400'
  };

  return (
    <div className="card">
      {tasks.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No tasks</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="border border-dark-border rounded p-3 hover:border-blue-500 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className="font-medium text-white">{task.title}</h4>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium border ${
                    statusColors[task.status]
                  }`}
                >
                  {task.status.replace('_', ' ')}
                </span>
              </div>

              {task.description && (
                <p className="text-xs text-gray-400 mb-2">{task.description}</p>
              )}

              {task.progress !== undefined && (
                <div className="mb-2">
                  <div className="bg-dark-border rounded-full h-1">
                    <div
                      className="bg-blue-500 h-1 rounded-full transition-all"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{task.progress}%</p>
                </div>
              )}

              <div className="flex justify-between text-xs text-gray-500">
                <span>{task.agentId}</span>
                <span>{new Date(task.updatedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
