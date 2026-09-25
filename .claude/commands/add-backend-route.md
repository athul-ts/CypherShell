Scaffold a complete new backend route for CypherShell following the existing patterns.

The user will specify: **$ARGUMENTS** (e.g. "GET /api/widgets — list all widgets")

Steps to follow:

1. Create `backend/src/routes/<resource>.routes.ts` — register the Express router, apply `authMiddleware`, wire controller methods
2. Create `backend/src/controllers/<resource>.controller.ts` — thin controller, calls the service, returns JSON
3. Create `backend/src/services/<resource>.service.ts` — all Prisma DB access goes here, imports from `backend/src/config/db.ts`
4. Register the new router in `backend/src/index.ts` under the correct `/api/<resource>` prefix
5. Add the corresponding Axios call to `src/renderer/src/lib/api.ts`

Follow these conventions exactly:

- All controllers must be `async (req, res) => {}` with try/catch returning `res.status(500).json({ error: ... })` on failure
- Services interact with Prisma only — no raw SQL
- Routes always import `authMiddleware` from `../middleware/auth.middleware`
- Use `z.object({})` from Zod for request body validation in the controller
- Never use `any` — type all request bodies with Zod inferred types
