-- Feature A: the single therapy-given Kaizen task
CREATE TABLE "KaizenTask" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastSessionId" UUID,
    "contentEnc" TEXT NOT NULL,
    "reasonEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stateNoteEnc" TEXT,
    "stillSince" TIMESTAMP(3),
    "stillCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "dropReason" TEXT,

    CONSTRAINT "KaizenTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KaizenTask_userId_status_idx" ON "KaizenTask"("userId", "status");

-- AddForeignKey
ALTER TABLE "KaizenTask" ADD CONSTRAINT "KaizenTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
