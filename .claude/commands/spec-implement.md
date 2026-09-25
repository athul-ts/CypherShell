Implement a CypherShell spec item end-to-end, following the SDD workflow.

**Spec ID to implement:** $ARGUMENTS (e.g. "BL-01" or "FR-04.16")

## Step 1 — Read the spec

1. Read `specs/index.md` to find the ID and confirm its current status
2. Read the full requirement text in `SRS_SSH_Desktop_App.md` (check the linked §section)
3. If status is already ✅, stop and tell the user it is already implemented
4. If status is ⚠️, read what partial work exists before proceeding

## Step 2 — Read all files that will change

Before writing any code, read every file listed in the implementation notes for that spec item. Do not guess — read the actual code.

## Step 3 — State the plan

In 3–5 bullet points, describe exactly what will change and in which files. Wait for implicit approval (proceeding is fine unless the user objects).

## Step 4 — Implement

Follow this order:

1. Database schema change (if needed) → run `cd backend && npx prisma migrate dev --name <name> && npx prisma generate`
2. Backend service method
3. Backend controller method
4. Backend route registration
5. Frontend API client method in `src/renderer/src/lib/api.ts`
6. Frontend store update (if state change needed)
7. Frontend component / page wiring

Coding conventions (mandatory):

- All request bodies validated with Zod in the controller
- Service files are the only place that touch Prisma
- No `any` types
- No `console.log` in committed code
- Tailwind only for styling

## Step 5 — Type-check

Run `npm run typecheck` and fix every error before proceeding.

## Step 6 — Update spec status

- In `specs/index.md`: change the status cell from ❌ or ⚠️ to ✅
- In `SRS_SSH_Desktop_App.md`: update the ❌/⚠️ badge to ✅ in the relevant FR section AND in §16 Implementation Status

## Step 7 — Commit

Commit with the format: `<type>(<scope>): <description> [<spec-id>]`
Example: `feat(sftp): implement transfer cancel [BL-01]`
