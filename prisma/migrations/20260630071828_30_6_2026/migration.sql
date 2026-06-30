/*
  Warnings:

  - You are about to drop the `issue_reports` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "issue_reports" DROP CONSTRAINT "issue_reports_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "issue_reports" DROP CONSTRAINT "issue_reports_knowledgeBaseArticleId_fkey";

-- DropForeignKey
ALTER TABLE "issue_reports" DROP CONSTRAINT "issue_reports_reporterId_fkey";

-- DropTable
DROP TABLE "issue_reports";

-- DropEnum
DROP TYPE "IssuePriority";

-- DropEnum
DROP TYPE "IssueStatus";
