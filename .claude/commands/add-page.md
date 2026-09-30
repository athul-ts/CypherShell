Scaffold a new React page for CypherShell following the existing patterns.

The user will specify: **$ARGUMENTS** (e.g. "Notifications page at /notifications")

Steps to follow:

1. Create `src/renderer/src/pages/<PageName>.tsx` — use the same structure as `src/renderer/src/pages/Logs.tsx` as a reference (TanStack Query for data, shadcn/ui components, Tailwind classes)
2. Add the route to `src/renderer/src/App.tsx` inside the existing `<Routes>` block
3. Add a sidebar link in `src/renderer/src/components/layout/Sidebar.tsx` with the matching lucide-react icon
4. If the page needs server data: add the Axios call to `src/renderer/src/lib/api.ts` and a `useQuery` hook

Conventions:

- Use `import { useQuery } from '@tanstack/react-query'` for server data — never `useEffect` + `useState` for fetching
- All UI primitives must come from `src/renderer/src/components/ui/` (shadcn/ui copy-owned components)
- Tailwind only for styling — no inline `style={{}}`
- Page component must be a default export
- Use `lucide-react` for all icons
