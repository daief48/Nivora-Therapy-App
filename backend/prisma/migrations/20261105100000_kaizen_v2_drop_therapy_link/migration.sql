-- Kaizen v2: the therapy↔Kaizen goal link and the daily-step engine fields are removed.
-- The user's existing goals are ARCHIVED (status ABANDONED), never deleted.

-- Archive every user-facing goal from the old engine (helper goals keep their PAUSED status).
UPDATE "KaizenGoal" SET "status" = 'ABANDONED' WHERE "systemKey" IS NULL;

-- DropColumn
ALTER TABLE "KaizenGoal" DROP COLUMN IF EXISTS "origin",
DROP COLUMN IF EXISTS "sessionId",
DROP COLUMN IF EXISTS "programId",
DROP COLUMN IF EXISTS "progressPercent",
DROP COLUMN IF EXISTS "plannedSteps",
DROP COLUMN IF EXISTS "startMinutes",
DROP COLUMN IF EXISTS "dailyMaxMinutes",
DROP COLUMN IF EXISTS "rampPhase";

-- DropForeignKey
ALTER TABLE "KaizenGoal" DROP CONSTRAINT IF EXISTS "KaizenGoal_sessionId_fkey";
ALTER TABLE "KaizenGoal" DROP CONSTRAINT IF EXISTS "KaizenGoal_programId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "KaizenGoal_userId_origin_status_idx";
