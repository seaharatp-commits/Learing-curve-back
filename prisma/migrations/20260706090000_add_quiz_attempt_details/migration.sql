ALTER TABLE "quiz_attempts"
ADD COLUMN "lessonId" TEXT,
ADD COLUMN "selectedAnswers" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "correctAnswers" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "result" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "quiz_attempts_userId_submittedAt_idx" ON "quiz_attempts"("userId", "submittedAt");
CREATE INDEX "quiz_attempts_quizId_submittedAt_idx" ON "quiz_attempts"("quizId", "submittedAt");
