Demo data is created by `server/src/db/seed.ts` (run `npm run seed` in `server/`), because passwords must be hashed by the application.
The schema lives in `database/schema/001_schema.sql` and is applied automatically on server start (`npm run migrate` runs it by hand).
