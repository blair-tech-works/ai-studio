'use client';

import { useEffect, useState } from 'react';

interface Integrations {
  github: {
    installed: boolean;
    authenticated: boolean;
    user: string | null;
    version: string | null;
    message: string;
  };
  claude: {
    installed: boolean;
    version: string;
  };
  postgres: {
    connected: boolean;
    message: string;
  };
}

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [concurrency, setConcurrency] = useState(1);

  const loadConcurrency = async () => {
    try {
      const res = await fetch('/api/settings/concurrency');
      if (res.ok) {
        const data = await res.json();
        setConcurrency(data.limit);
      }
    } catch {}
  };

  const saveConcurrency = async (limit: number) => {
    try {
      await fetch('/api/settings/concurrency', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      setConcurrency(limit);
    } catch {}
  };

  const loadIntegrations = async () => {
    try {
      const res = await fetch('/api/settings/integrations');
      if (res.ok) {
        setIntegrations(await res.json());
      }
    } catch (err) {
      console.error('Failed to load integrations:', err);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
    loadConcurrency();
  }, []);

  const handleRefresh = () => {
    setChecking(true);
    loadIntegrations();
  };

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
  );

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">Integrations and configuration</p>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : integrations ? (
        <div className="space-y-4">
          {/* GitHub */}
          <div className={`card border rounded-lg p-5 ${integrations.github.authenticated ? 'border-dark-border' : 'border-red-500/50'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">🐙</span>
                <h3 className="text-lg font-semibold text-white">GitHub</h3>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot ok={integrations.github.authenticated} />
                <span className={`text-sm ${integrations.github.authenticated ? 'text-green-400' : 'text-red-400'}`}>
                  {integrations.github.authenticated ? 'Connected' : 'Not Connected'}
                </span>
              </div>
            </div>

            {integrations.github.authenticated ? (
              <div className="space-y-1 text-sm text-gray-400">
                <p>Logged in as <span className="text-white font-medium">{integrations.github.user}</span></p>
                <p className="text-xs text-gray-500">{integrations.github.version}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-300 mb-3">
                  GitHub CLI authentication is required for agents to create and merge pull requests.
                </p>
                <div className="bg-dark-bg border border-dark-border rounded p-3 mb-3">
                  <p className="text-xs text-gray-500 mb-1">Run this in your terminal:</p>
                  <code className="text-sm text-blue-400 font-mono">gh auth login</code>
                </div>
                <p className="text-xs text-gray-500">
                  Choose GitHub.com → HTTPS → Login with a web browser. Once authenticated, click "Check Again" below.
                </p>
              </div>
            )}
          </div>

          {/* Claude CLI */}
          <div className="card border border-dark-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">🤖</span>
                <h3 className="text-lg font-semibold text-white">Claude CLI</h3>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot ok={integrations.claude.installed} />
                <span className="text-sm text-green-400">Installed</span>
              </div>
            </div>
            <p className="text-sm text-gray-400">Version: {integrations.claude.version}</p>
          </div>

          {/* PostgreSQL */}
          <div className={`card border rounded-lg p-5 ${integrations.postgres.connected ? 'border-dark-border' : 'border-red-500/50'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">🐘</span>
                <h3 className="text-lg font-semibold text-white">PostgreSQL</h3>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot ok={integrations.postgres.connected} />
                <span className={`text-sm ${integrations.postgres.connected ? 'text-green-400' : 'text-red-400'}`}>
                  {integrations.postgres.message}
                </span>
              </div>
            </div>
          </div>

          {/* Concurrency */}
          <div className="card border border-dark-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">🔄</span>
                <h3 className="text-lg font-semibold text-white">Concurrent PRDs</h3>
              </div>
            </div>
            <p className="text-sm text-gray-400 mb-3">
              Maximum number of PRDs that can have active agent teams simultaneously.
              Additional PRDs will be queued until a slot is freed.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= 10) saveConcurrency(val);
                }}
                className="w-20 bg-dark-bg border border-dark-border rounded px-3 py-1.5 text-sm text-gray-200 text-center focus:outline-none focus:border-blue-500"
              />
              <span className="text-xs text-gray-500">1–10 (default: 1)</span>
            </div>
          </div>

          {/* Refresh button */}
          <div className="pt-2">
            <button
              onClick={handleRefresh}
              disabled={checking}
              className="px-4 py-2 bg-dark-border text-gray-300 rounded-lg text-sm hover:text-white hover:bg-dark-card transition-colors disabled:opacity-50"
            >
              {checking ? 'Checking...' : 'Check Again'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-red-400">Failed to load integration status</p>
      )}
    </div>
  );
}
