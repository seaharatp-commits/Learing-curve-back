-- New quizzes may be scoped to the creator's selected Skill Radar position.
-- Existing quizzes remain legacy records with a NULL positionId.
ALTER TABLE "quizzes" ADD COLUMN "positionId" TEXT;

CREATE INDEX "quizzes_positionId_idx" ON "quizzes"("positionId");

ALTER TABLE "quizzes"
  ADD CONSTRAINT "quizzes_positionId_fkey"
  FOREIGN KEY ("positionId")
  REFERENCES "positions"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
