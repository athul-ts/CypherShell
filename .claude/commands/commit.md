Stage and commit all current changes using Conventional Commits format.

Steps:

1. Run `git status` and `git diff` to see exactly what changed
2. Group the changes by type and scope
3. Stage the appropriate files
4. Write a commit message following this format:

```
<type>(<scope>): <short description>

[optional body — only if the WHY is not obvious from the diff]
```

Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `test`, `perf`
Scopes for this project: `auth`, `sftp`, `terminal`, `tunnel`, `keys`, `profiles`, `logs`, `config`, `ui`, `backend`, `ipc`, `build`, `deps`

Rules:

- One logical change per commit — split unrelated changes into separate commits
- Subject line max 72 characters
- Use imperative mood ("add cancel button" not "added cancel button")
- Do NOT include "Co-Authored-By" unless the user explicitly asks
- Do NOT push after committing — wait for explicit instruction
