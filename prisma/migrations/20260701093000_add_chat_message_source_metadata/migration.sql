ALTER TABLE "chat_messages"
ADD COLUMN "sourceType" TEXT,
ADD COLUMN "sourceArticleId" TEXT,
ADD COLUMN "sourceArticleTitle" TEXT,
ADD COLUMN "sourceConfidenceScore" DOUBLE PRECISION;
