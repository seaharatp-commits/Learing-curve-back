-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "sourceArticleId" TEXT,
ALTER COLUMN "lessonId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questions_quizId_idx" ON "questions"("quizId");

-- CreateIndex
CREATE INDEX "quizzes_sourceArticleId_idx" ON "quizzes"("sourceArticleId");

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_sourceArticleId_fkey" FOREIGN KEY ("sourceArticleId") REFERENCES "knowledge_base_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
