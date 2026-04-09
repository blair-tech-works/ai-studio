'use client';

import { useEvoRecommendations } from '@/lib/hooks';
import { approveEvoRecommendation, rejectEvoRecommendation } from '@/lib/api';
import { useState } from 'react';

export default function EvoPage() {
  const { recommendations, metrics, loading, refetch } = useEvoRecommendations();
  const [filter, setFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const filteredRecs =
    filter === 'all'
      ? recommendations
      : recommendations.filter(r => r.status === filter);

  const priorityColors: Record<string, string> = {
    critical: 'bg-red-500/10 border-red-500 text-red-400',
    high: 'bg-red-500/10 border-red-500 text-red-400',
    medium: 'bg-yellow-500/10 border-yellow-500 text-yellow-400',
    low: 'bg-blue-500/10 border-blue-500 text-blue-400'
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-purple-500/10 border-purple-500 text-purple-400',
    approved: 'bg-green-500/10 border-green-500 text-green-400',
    rejected: 'bg-red-500/10 border-red-500 text-red-400',
    implemented: 'bg-green-500/10 border-green-500 text-green-400'
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await approveEvoRecommendation(id);
      await refetch();
    } catch (err) {
      console.error('Failed to approve:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    try {
      await rejectEvoRecommendation(id);
      await refetch();
    } catch (err) {
      console.error('Failed to reject:', err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">EVO</h1>
        <p className="text-gray-400">AI-generated optimization recommendations</p>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card bg-blue-500/10 border-blue-500">
            <p className="text-gray-400 text-sm">Total Agents</p>
            <p className="text-3xl font-bold text-blue-400 mt-1">{metrics.message_counts.length}</p>
          </div>
          <div className="card bg-green-500/10 border-green-500">
            <p className="text-gray-400 text-sm">Total Messages</p>
            <p className="text-3xl font-bold text-green-400 mt-1">{metrics.message_counts.reduce((sum, m) => sum + m.message_count, 0)}</p>
          </div>
          <div className="card bg-purple-500/10 border-purple-500">
            <p className="text-gray-400 text-sm">Avg Task Completion</p>
            <p className="text-3xl font-bold text-purple-400 mt-1">
              {metrics.task_completion.length > 0
                ? Math.round(
                    metrics.task_completion.reduce((sum, t) => sum + t.completion_rate, 0) /
                      metrics.task_completion.length
                  )
                : 0}
              %
            </p>
          </div>
          <div className="card bg-yellow-500/10 border-yellow-500">
            <p className="text-gray-400 text-sm">Avg Cycle Time</p>
            <p className="text-3xl font-bold text-yellow-400 mt-1">
              {metrics.cycle_time.length > 0
                ? (
                    metrics.cycle_time.reduce((sum, c) => sum + c.avg_cycle_time_hours, 0) /
                    metrics.cycle_time.length
                  ).toFixed(1)
                : 0}
              h
            </p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        {['all', 'pending', 'approved', 'rejected', 'implemented'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-blue-500 text-white'
                : 'bg-dark-border text-gray-400 hover:text-white'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading recommendations...</div>
      ) : (
        <div className="card">
          {filteredRecs.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No recommendations</p>
          ) : (
            <div className="space-y-3">
              {filteredRecs.map((rec) => (
                <div
                  key={rec.id}
                  className="border border-dark-border rounded p-4 hover:border-blue-500 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white">{rec.title}</h3>
                      <p className="text-sm text-gray-400 mt-1">{rec.description}</p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium border ${
                          priorityColors[rec.priority]
                        }`}
                      >
                        {rec.priority}
                      </span>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium border ${
                          statusColors[rec.status]
                        }`}
                      >
                        {rec.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 mb-3">{rec.category}</p>

                  {rec.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(rec.id)}
                        className="btn btn-primary text-sm"
                        disabled={actionLoading === rec.id}
                      >
                        {actionLoading === rec.id ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(rec.id)}
                        className="btn btn-secondary text-sm"
                        disabled={actionLoading === rec.id}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
