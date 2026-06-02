Create and apply a new Prisma database migration for CypherShell.

The user will specify the migration name: **$ARGUMENTS** (e.g. "add-transfer-cancel-flag")

Steps:
1. Read `backend/prisma/schema.prisma` to understand the current schema
2. Apply the schema change needed for this migration (if not already done by the user)
3. Run the migration:

```bash
cd backend && npx prisma migrate dev --name $ARGUMENTS
```

4. Regenerate the Prisma client:

```bash
cd backend && npx prisma generate
```

5. Check if any service files need to be updated to use the new fields/models

Rules:
- Never run `prisma migrate reset` — it wipes all data
- Never edit migration SQL files directly after they are created
- Always run `prisma generate` after a schema change so the TypeScript types are up to date
- If adding a new required field to an existing model, always provide a `@default()` value so existing rows aren't broken
