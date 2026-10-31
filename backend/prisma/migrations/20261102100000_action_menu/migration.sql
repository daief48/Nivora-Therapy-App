-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "suggestionLevel" TEXT NOT NULL DEFAULT 'SOMETIMES',
ADD COLUMN     "analyticsOptIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "emotionEncrypted" TEXT;

-- AlterTable
ALTER TABLE "KaizenAction" ADD COLUMN     "adaptedBy" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'GOAL';

-- AlterTable
ALTER TABLE "RoutineLog" ADD COLUMN     "doneIds" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "extras" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "WeeklySummary" ADD COLUMN     "reportEncrypted" TEXT,
ADD COLUMN     "reportAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ActionOffer" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "actionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "sessionId" UUID,
    "messageId" UUID,
    "outcome" TEXT NOT NULL DEFAULT 'OFFERED',
    "feedback" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcomeAt" TIMESTAMP(3),

    CONSTRAINT "ActionOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionOffer_userId_createdAt_idx" ON "ActionOffer"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActionOffer" ADD CONSTRAINT "ActionOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
