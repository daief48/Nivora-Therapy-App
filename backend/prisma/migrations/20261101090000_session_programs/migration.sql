-- AlterTable
ALTER TABLE "TherapySession" ADD COLUMN     "programId" UUID,
ADD COLUMN     "dayNumber" INTEGER,
ADD COLUMN     "plannedMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SessionProgram" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "topicId" UUID,
    "titleEncrypted" TEXT NOT NULL,
    "goalEncrypted" TEXT,
    "plannedDays" INTEGER NOT NULL,
    "dailyMinutes" INTEGER NOT NULL,
    "reminderTimeMin" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSittingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SessionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionProgram_userId_status_idx" ON "SessionProgram"("userId", "status");

-- CreateIndex
CREATE INDEX "TherapySession_programId_startedAt_idx" ON "TherapySession"("programId", "startedAt");

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_programId_fkey" FOREIGN KEY ("programId") REFERENCES "SessionProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProgram" ADD CONSTRAINT "SessionProgram_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProgram" ADD CONSTRAINT "SessionProgram_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
