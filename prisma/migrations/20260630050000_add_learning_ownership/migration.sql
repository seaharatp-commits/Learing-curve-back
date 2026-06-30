ALTER TABLE "lessons" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "quizzes" ADD COLUMN "createdByUserId" TEXT;

UPDATE "lessons"
SET "createdByUserId" = (
  SELECT "id" FROM "users" WHERE "email" = 'admin@learningcurve.dev' LIMIT 1
)
WHERE "createdByUserId" IS NULL;

UPDATE "quizzes"
SET "createdByUserId" = COALESCE(
  (
    SELECT "createdByUserId"
    FROM "lessons"
    WHERE "lessons"."id" = "quizzes"."lessonId"
  ),
  (
    SELECT "id" FROM "users" WHERE "email" = 'admin@learningcurve.dev' LIMIT 1
  )
)
WHERE "createdByUserId" IS NULL;

CREATE INDEX "lessons_createdByUserId_idx" ON "lessons"("createdByUserId");
CREATE INDEX "quizzes_createdByUserId_idx" ON "quizzes"("createdByUserId");

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
