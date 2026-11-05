-- Feature B: the user's own goal + its updates
CREATE TABLE "UserGoal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "titleEnc" TEXT NOT NULL,
    "tasksJson" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "UserGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserGoalUpdate" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "noteEnc" TEXT,
    "doneCurrent" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGoalUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserGoal_userId_status_idx" ON "UserGoal"("userId", "status");
CREATE INDEX "UserGoalUpdate_goalId_createdAt_idx" ON "UserGoalUpdate"("goalId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserGoal" ADD CONSTRAINT "UserGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGoalUpdate" ADD CONSTRAINT "UserGoalUpdate_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "UserGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
