-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "tags" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SupportResource" ADD COLUMN     "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "TrustedContact" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nameEncrypted" TEXT NOT NULL,
    "phoneEncrypted" TEXT NOT NULL,
    "relation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "encryptedContent" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramEnrollment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "programId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "ProgramEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "anonId" TEXT NOT NULL,
    "propsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyPlan_userId_key" ON "SafetyPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramEnrollment_userId_programId_key" ON "ProgramEnrollment"("userId", "programId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_language_idx" ON "KnowledgeChunk"("language");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_day_idx" ON "AnalyticsEvent"("name", "day");

-- AddForeignKey
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyPlan" ADD CONSTRAINT "SafetyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEnrollment" ADD CONSTRAINT "ProgramEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
