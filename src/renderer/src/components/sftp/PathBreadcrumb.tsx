import { ChevronRight } from 'lucide-react';

interface Segment {
  label: string;
  path: string;
}

interface PathBreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

function buildSegments(path: string): Segment[] {
  if (!path || path === '.') {
    return [{ label: '~', path: '.' }];
  }

  const isWindows = path.includes('\\');

  if (isWindows) {
    const parts = path.split('\\').filter(Boolean);
    return parts.map((part, i) => ({
      label: part,
      path: i === 0 ? part + '\\' : parts.slice(0, i + 1).join('\\'),
    }));
  }

  if (path.startsWith('/')) {
    const parts = path.split('/').filter(Boolean);
    return [
      { label: '/', path: '/' },
      ...parts.map((part, i) => ({
        label: part,
        path: '/' + parts.slice(0, i + 1).join('/'),
      })),
    ];
  }

  // Relative remote path (e.g. "home/user/docs")
  const parts = path.split('/').filter(Boolean);
  return [
    { label: '~', path: '.' },
    ...parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join('/'),
    })),
  ];
}

export function PathBreadcrumb({ path, onNavigate }: PathBreadcrumbProps) {
  const segments = buildSegments(path);

  return (
    <div className="flex items-center flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 font-mono text-sm min-w-0 overflow-x-auto">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center shrink-0">
          {i > 0 && <ChevronRight className="w-3 h-3 text-slate-600 mx-0.5" />}
          <button
            onClick={() => onNavigate(seg.path)}
            className="text-slate-300 hover:text-emerald-400 transition-colors rounded px-0.5"
          >
            {seg.label}
          </button>
        </span>
      ))}
    </div>
  );
}
