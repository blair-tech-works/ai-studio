'use client';

import { useState } from 'react';
import { useTasks, useAgents } from '@/lib/hooks';
import TaskList from '@/components/TaskList';
import { createTask } from '@/lib/api';

export default function TasksPage() {
  const { agents } = useAgents();
  const { tasks, loading, refetch } = useTasks();
  const [filter, setFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '', assigned_to: '' });
  const [submitting, setSubmitting] = useState(false);

  const filteredTasks = 
    filter === 'all' 
      ? tasks 
      : tasks.filter(t => t.status === filter);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title) return;

    setSubmitting(true);
    try {
      await createTask({
        title: formData.title,
        description: formData.description || undefined,
        assigned_to: formData.assigned_to || undefined
      });
      setFormData({ title: '', description: '', assigned_to: '' });
      setShowForm(false);
      await refetch();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Tasks</h1>
          <p className="text-gray-400">Manage and monitor all tasks</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn btn-primary"
        >
          + New Task
        </button>
      </div>

      {showForm && (
        <div className="card mb-8 border-blue-500">
          <h2 className="text-lg font-semibold text-white mb-4">Create New Task</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              placeholder="Task title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-white placeholder-gray-500"
              required
            />
            <textarea
              placeholder="Description (optional)"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-white placeholder-gray-500"
              rows={3}
            />
            <select
              value={formData.assigned_to}
              onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-white"
            >
              <option value="">Assign to Agent (optional)</option>
              {agents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.display_name || agent.name}
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Task'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {['all', 'backlog', 'todo', 'in_progress', 'review', 'qa', 'done', 'blocked'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-blue-500 text-white'
                : 'bg-dark-border text-gray-400 hover:text-white'
            }`}
          >
            {status.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading tasks...</div>
      ) : (
        <TaskList tasks={filteredTasks} />
      )}
    </div>
  );
}
