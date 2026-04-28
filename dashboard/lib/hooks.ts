'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Agent,
  Task,
  Message,
  EvoRecommendation,
  EvoMetrics,
  SSEEvent,
  connectSSE,
  fetchAgents,
  fetchTasks,
  fetchMessages,
  fetchEvoRecommendations,
  fetchEvoMetrics
} from './api';

// Hook for fetching and polling agents
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAgents = async () => {
      try {
        setLoading(true);
        const data = await fetchAgents();
        setAgents(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoading(false);
      }
    };

    loadAgents();
    const interval = setInterval(loadAgents, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, []);

  return { agents, loading, error };
}

// Hook for fetching and auto-refreshing tasks
export function useTasks(filters?: { status?: string; assigned_to?: string; priority?: string; limit?: number; offset?: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable key from filters so a new {} literal each render doesn't re-fire effects.
  const filtersKey = JSON.stringify(filters ?? {});
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks(filtersRef.current);
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Connect to SSE for real-time updates
  useEffect(() => {
    const handleSSEEvent = (event: SSEEvent) => {
      if (event.type === 'task_created' || event.type === 'task_updated') {
        loadTasks();
      }
    };

    const cleanup = connectSSE(handleSSEEvent);
    return cleanup;
  }, [loadTasks]);

  return { tasks, loading, error, refetch: loadTasks };
}

// Hook for fetching and auto-refreshing messages
export function useMessages(filters?: { from_agent?: string; to_agent?: string; task_id?: string; type?: string; read?: boolean; since?: string; limit?: number; offset?: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable key from filters so a new {} literal each render doesn't re-fire effects.
  const filtersKey = JSON.stringify(filters ?? {});
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadMessages = useCallback(async () => {
    try {
      const data = await fetchMessages(filtersRef.current);
      setMessages(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Connect to SSE for real-time updates
  useEffect(() => {
    const handleSSEEvent = (event: SSEEvent) => {
      if (event.type === 'message_received') {
        loadMessages();
      }
    };

    const cleanup = connectSSE(handleSSEEvent);
    return cleanup;
  }, [loadMessages]);

  return { messages, loading, error, refetch: loadMessages };
}

// Hook for SSE connection
export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventQueueRef = useRef<SSEEvent[]>([]);

  useEffect(() => {
    const handleSSEEvent = (event: SSEEvent) => {
      setConnected(true);
      // Skip connection/heartbeat events from the activity feed
      if (event.type === 'connected' || event.type === 'heartbeat') return;
      eventQueueRef.current.push(event);
      setEvents([...eventQueueRef.current].slice(-50)); // Keep last 50 events
    };

    const handleError = (err: Error) => {
      setError(err.message);
      setConnected(false);
    };

    const cleanup = connectSSE(handleSSEEvent, handleError);

    return cleanup;
  }, []);

  return { events, connected, error };
}

// Hook for EVO recommendations
export function useEvoRecommendations() {
  const [recommendations, setRecommendations] = useState<EvoRecommendation[]>([]);
  const [metrics, setMetrics] = useState<EvoMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecommendations = useCallback(async () => {
    try {
      setLoading(true);
      const [recsData, metricsData] = await Promise.all([
        fetchEvoRecommendations(),
        fetchEvoMetrics()
      ]);
      setRecommendations(recsData);
      setMetrics(metricsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch EVO data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  // Connect to SSE for real-time updates
  useEffect(() => {
    const handleSSEEvent = (event: SSEEvent) => {
      if (event.type === 'evo_recommendation') {
        loadRecommendations();
      }
    };

    const cleanup = connectSSE(handleSSEEvent);
    return cleanup;
  }, [loadRecommendations]);

  return { recommendations, metrics, loading, error, refetch: loadRecommendations };
}
