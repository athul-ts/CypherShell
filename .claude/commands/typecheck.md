Run full TypeScript type checking for both the Electron main process and the renderer, then report any errors.

```bash
npm run typecheck
```

List every error with its file path, line number, and a short explanation of what's wrong. If there are no errors, confirm that both `typecheck:node` and `typecheck:web` passed cleanly.
