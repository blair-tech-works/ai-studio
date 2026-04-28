'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Package,
  LayoutDashboard,
  CheckSquare,
  MessageSquare,
  BookOpen,
  Rocket,
  Settings as SettingsIcon
} from 'lucide-react';

const navItems = [
  { href: '/prds', label: 'Products', Icon: Package },
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', Icon: CheckSquare },
  { href: '/messages', label: 'Messages', Icon: MessageSquare },
  { href: '/kb', label: 'Knowledge Base', Icon: BookOpen },
  { href: '/evo', label: 'EVO', Icon: Rocket },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon }
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-surface border-r border-border-subtle px-4 py-6 overflow-y-auto flex flex-col">
      {/* Brand */}
      <div className="mb-8 px-2 flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-sm bg-accent-500" />
        <div>
          <h1 className="text-sm font-semibold text-text-primary leading-none tracking-tight">AI Studio</h1>
          <p className="text-[10px] text-text-muted mt-1 uppercase tracking-wider">Multi-Agent</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="space-y-0.5 flex-1">
        {navItems.map(({ href, label, Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-2.5 pl-4 pr-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
                isActive
                  ? 'bg-accent-500/10 text-text-accent font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent-500" />
              )}
              <Icon size={15} strokeWidth={1.75} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* System footer */}
      <div className="mt-8 pt-4 border-t border-border-subtle px-2">
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
          System
        </h3>
        <div className="space-y-1 text-[11px] text-text-muted font-mono">
          <p>localhost:3001</p>
          <p>v0.1.0</p>
        </div>
      </div>
    </aside>
  );
}
