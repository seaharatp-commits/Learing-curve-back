-- Add a nullable preferred position for each learner.
ALTER TABLE "users" ADD COLUMN "preferredPositionId" TEXT;

CREATE INDEX "users_preferredPositionId_idx" ON "users"("preferredPositionId");

ALTER TABLE "users"
  ADD CONSTRAINT "users_preferredPositionId_fkey"
  FOREIGN KEY ("preferredPositionId")
  REFERENCES "positions"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
