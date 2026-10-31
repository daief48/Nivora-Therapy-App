-- Review fixes (additive only).

-- AlterTable: stable marker for the app's own helper goals (replaces matching by title + category)
ALTER TABLE "KaizenGoal" ADD COLUMN     "systemKey" TEXT;

-- AlterTable: pre-shrink step size and encrypted user text
ALTER TABLE "KaizenAction" ADD COLUMN     "baseTarget" INTEGER,
ADD COLUMN     "userTextEncrypted" TEXT;

-- Backfill: the earliest PAUSED helper goal per user and category gets the marker (practice tools and "Small step")
UPDATE "KaizenGoal" g SET "systemKey" = g."category"
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId", "category" ORDER BY "createdAt") AS rn
  FROM "KaizenGoal"
  WHERE "status" = 'PAUSED' AND (
    ("category" = 'BREATHING' AND "title" = 'Breathing') OR
    ("category" = 'GROUNDING' AND "title" = 'Grounding 5-4-3-2-1') OR
    ("category" = 'REFLECTION' AND "title" = 'Thought record') OR
    ("category" = 'RELAXATION' AND "title" = 'Sounds') OR
    "title" = 'Small step'
  )
) x
WHERE g.id = x.id AND x.rn = 1;

-- CreateIndex
CREATE UNIQUE INDEX "KaizenGoal_userId_systemKey_key" ON "KaizenGoal"("userId", "systemKey");
