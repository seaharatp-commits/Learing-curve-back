-- CreateTable
CREATE TABLE "career_alignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "scoreSumSnapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "skillScoreHash" TEXT NOT NULL,
    "alignmentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generatedBy" TEXT NOT NULL DEFAULT 'fallback',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_alignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "career_alignment_userId_positionId_key" ON "career_alignment"("userId", "positionId");

-- AddForeignKey
ALTER TABLE "career_alignment" ADD CONSTRAINT "career_alignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_alignment" ADD CONSTRAINT "career_alignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
