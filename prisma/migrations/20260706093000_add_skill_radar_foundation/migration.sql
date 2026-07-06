CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "position_skills" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_skill_scores" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_skill_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_score_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "scoreDelta" DOUBLE PRECISION NOT NULL,
    "scoreBefore" DOUBLE PRECISION NOT NULL,
    "scoreAfter" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_score_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quiz_question_skills" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "quiz_question_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "positions_name_key" ON "positions"("name");
CREATE UNIQUE INDEX "position_skills_positionId_name_key" ON "position_skills"("positionId", "name");
CREATE INDEX "position_skills_positionId_idx" ON "position_skills"("positionId");
CREATE UNIQUE INDEX "user_skill_scores_userId_skillId_key" ON "user_skill_scores"("userId", "skillId");
CREATE INDEX "user_skill_scores_userId_positionId_idx" ON "user_skill_scores"("userId", "positionId");
CREATE INDEX "skill_score_events_userId_createdAt_idx" ON "skill_score_events"("userId", "createdAt");
CREATE INDEX "skill_score_events_skillId_idx" ON "skill_score_events"("skillId");
CREATE UNIQUE INDEX "quiz_question_skills_questionId_skillId_key" ON "quiz_question_skills"("questionId", "skillId");
CREATE INDEX "quiz_question_skills_skillId_idx" ON "quiz_question_skills"("skillId");

ALTER TABLE "position_skills" ADD CONSTRAINT "position_skills_positionId_fkey"
FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_skill_scores" ADD CONSTRAINT "user_skill_scores_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_skill_scores" ADD CONSTRAINT "user_skill_scores_positionId_fkey"
FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_skill_scores" ADD CONSTRAINT "user_skill_scores_skillId_fkey"
FOREIGN KEY ("skillId") REFERENCES "position_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_score_events" ADD CONSTRAINT "skill_score_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_score_events" ADD CONSTRAINT "skill_score_events_positionId_fkey"
FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_score_events" ADD CONSTRAINT "skill_score_events_skillId_fkey"
FOREIGN KEY ("skillId") REFERENCES "position_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_question_skills" ADD CONSTRAINT "quiz_question_skills_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_question_skills" ADD CONSTRAINT "quiz_question_skills_skillId_fkey"
FOREIGN KEY ("skillId") REFERENCES "position_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
