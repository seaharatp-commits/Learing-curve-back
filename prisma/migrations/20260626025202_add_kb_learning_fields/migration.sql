-- AlterTable
ALTER TABLE "issue_reports" ADD COLUMN     "knowledgeBaseArticleId" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base_articles" ADD COLUMN     "environment" TEXT,
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "rootCause" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "symptoms" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "verification" TEXT;

-- AddForeignKey
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_knowledgeBaseArticleId_fkey" FOREIGN KEY ("knowledgeBaseArticleId") REFERENCES "knowledge_base_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
