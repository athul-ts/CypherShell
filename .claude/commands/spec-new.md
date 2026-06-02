Add a new requirement to the CypherShell spec before writing any code.

**New requirement description:** $ARGUMENTS

## Rules
- NO implementation code until the spec is written and complete
- Every new feature must have a spec item before a single line of code is written
- This is the SDD contract: spec first, always

## Step 1 — Classify the requirement
Determine:
- Is this a new Functional Requirement (FR) or an extension of an existing one?
- Which module does it belong to? (profiles, terminal, sftp, keys, tunnel, auth, audit, config)
- What priority? High / Medium / Low

## Step 2 — Assign the ID
- Read `specs/index.md` to find the next available ID
- For a new module: next FR-XX number
- For an addition to an existing module: next FR-XX.YY sub-item number
- For a backlog item on top of existing code: next BL-XX number

## Step 3 — Write the spec entry
Use `specs/templates/fr-template.md` as the template. Fill in:
- All requirement sub-items (FR-XX.1, FR-XX.2, etc.)
- Acceptance criteria (specific, testable conditions)
- Implementation notes (which files will change)
- Out of scope (what is explicitly excluded)

## Step 4 — Update the SRS
Add the new requirement to `SRS_SSH_Desktop_App.md` in the correct section:
- Under the right FR-XX heading if it is a sub-item
- As a new `### FR-XX` heading if it is a new module
- Update the Overall Status badge on the parent FR if partial

## Step 5 — Update the index
Add a row to the correct table in `specs/index.md` with status ❌.

## Step 6 — Confirm with the user
Present the written spec and ask: "Spec is written. Ready to implement? Use `/spec-implement <ID>` to proceed."

Do NOT write any implementation code in this command — spec writing only.
