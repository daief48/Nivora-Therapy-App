-- KaizenGoal: therapy link (origin / session / program), progress and time-ramp fields
ALTER TABLE "KaizenGoal" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN     "sessionId" UUID,
ADD COLUMN     "programId" UUID,
ADD COLUMN     "progressPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plannedSteps" INTEGER,
ADD COLUMN     "startMinutes" INTEGER,
ADD COLUMN     "dailyMaxMinutes" INTEGER,
ADD COLUMN     "rampPhase" TEXT;

-- AlterTable (VIDEO calls are VOICE sessions server-side; keep the mode the user chose)
ALTER TABLE "TherapySession" ADD COLUMN "modeRequested" TEXT;

-- CreateIndex
CREATE INDEX "KaizenGoal_userId_origin_status_idx" ON "KaizenGoal"("userId", "origin", "status");

-- AddForeignKey (a deleted session/program leaves the goal intact, just unlinked)
ALTER TABLE "KaizenGoal" ADD CONSTRAINT "KaizenGoal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TherapySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KaizenGoal" ADD CONSTRAINT "KaizenGoal_programId_fkey" FOREIGN KEY ("programId") REFERENCES "SessionProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
