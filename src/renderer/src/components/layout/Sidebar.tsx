import { NavLink } from 'react-router-dom';
import { Home, Key, FileText, Settings, TerminalSquare } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Sidebar() {
  const links = [
    { name: 'Profiles', to: '/', icon: Home },
    { name: 'Keys', to: '/keys', icon: Key },
    { name: 'Logs', to: '/logs', icon: FileText },
    { name: 'Settings', to: '/settings', icon: Settings },
  ];

  return (
    <div className="w-16 md:w-56 h-full border-r border-slate-800 bg-[#0f1117] flex flex-col items-center md:items-start py-4">
      <div className="px-4 mb-8 hidden md:flex items-center gap-2">
        <TerminalSquare className="w-6 h-6 text-emerald-500" />
        <span className="font-bold text-slate-200">CypherShell</span>
      </div>

      <div className="flex flex-col w-full gap-2 px-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                isActive
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              )
            }
          >
            <link.icon className="w-5 h-5 shrink-0" />
            <span className="hidden md:block font-medium">{link.name}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
