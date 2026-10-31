-- AlterTable
ALTER TABLE "TherapySession" ADD COLUMN     "topicId" UUID;

-- CreateTable
CREATE TABLE "Topic" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "encryptedContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "instrument" TEXT NOT NULL,
    "encryptedContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Topic_userId_createdAt_idx" ON "Topic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Assessment_userId_instrument_createdAt_idx" ON "Assessment"("userId", "instrument", "createdAt");

-- CreateIndex
CREATE INDEX "TherapySession_topicId_idx" ON "TherapySession"("topicId");

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
