-- AlterTable
ALTER TABLE "TherapySession" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "isIntake" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lengthMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "moodAfter" INTEGER,
ADD COLUMN     "moodBefore" INTEGER,
ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'OPENING',
ADD COLUMN     "rememberThis" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "riskFlag" TEXT NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "SessionNote" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "encryptedContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "encryptedContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Homework" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID,
    "titleEncrypted" TEXT NOT NULL,
    "dueDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "feedbackEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeTracker" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "themeKey" TEXT NOT NULL,
    "labelEncrypted" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeTracker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionSchedule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeMin" INTEGER NOT NULL DEFAULT 1200,
    "lengthMin" INTEGER NOT NULL DEFAULT 30,
    "remindersOn" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SessionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityReviewSample" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "encryptedContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityReviewSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionNote_sessionId_key" ON "SessionNote"("sessionId");

-- CreateIndex
CREATE INDEX "SessionNote_userId_createdAt_idx" ON "SessionNote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TreatmentPlan_userId_active_idx" ON "TreatmentPlan"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentPlan_userId_version_key" ON "TreatmentPlan"("userId", "version");

-- CreateIndex
CREATE INDEX "Homework_userId_status_idx" ON "Homework"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeTracker_userId_themeKey_key" ON "ThemeTracker"("userId", "themeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SessionSchedule_userId_key" ON "SessionSchedule"("userId");

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TherapySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeTracker" ADD CONSTRAINT "ThemeTracker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSchedule" ADD CONSTRAINT "SessionSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReviewSample" ADD CONSTRAINT "QualityReviewSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
