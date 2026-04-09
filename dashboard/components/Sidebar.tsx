'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: '📊' },
    { href: '/tasks', label: 'Tasks', icon: '✓' },
    { href: '/messages', label: 'Messages', icon: '💬' },
    { href: '/prds', label: 'PRDs', icon: '📄' },
    { href: '/kb', label: 'Knowledge Base', icon: '📚' },
    { href: '/evo', label: 'EVO', icon: '🚀' }
  ];

  return (
    <aside className="w-64 bg-dark-card border-r border-dark-border p-6 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-blue-500">AI Studio</h1>
        <p className="text-xs text-gray-400 mt-1">Multi-Agent Dashboard</p>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-500 bg-opacity-20 text-blue-400 border border-blue-500'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-dark-border'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-12 pt-6 border-t border-dark-border">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          System
        </h3>
        <div className="space-y-2 text-xs text-gray-500">
          <p>API: http://localhost:3001</p>
          <p>Version: 0.1.0</p>
        </div>
      </div>
    </aside>
  );
}
