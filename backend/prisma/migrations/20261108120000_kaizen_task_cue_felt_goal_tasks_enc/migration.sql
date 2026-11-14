-- KaizenTask: implementation-intention cue, suggested cue, outcome feeling (all additive)
ALTER TABLE "KaizenTask" ADD COLUMN "cueEnc" TEXT;
ALTER TABLE "KaizenTask" ADD COLUMN "cueTime" TEXT;
ALTER TABLE "KaizenTask" ADD COLUMN "suggestedCueEnc" TEXT;
ALTER TABLE "KaizenTask" ADD COLUMN "felt" TEXT;

-- UserGoal: encrypted tasks. Legacy plaintext tasksJson stays readable (no drop, no data change);
-- it only becomes nullable so new rows can omit it.
ALTER TABLE "UserGoal" ADD COLUMN "tasksEnc" TEXT;
ALTER TABLE "UserGoal" ALTER COLUMN "tasksJson" DROP NOT NULL;
