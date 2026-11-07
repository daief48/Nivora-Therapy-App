-- UserGoal: setup questions (daily time, habit anchor, gentle reminder) + adaptive sizing / milestone bookkeeping
ALTER TABLE "UserGoal" ADD COLUMN "timePerDayMin" INTEGER,
ADD COLUMN     "anchorEnc" TEXT,
ADD COLUMN     "reminderMin" INTEGER,
ADD COLUMN     "difficultyJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "milestonesJson" TEXT NOT NULL DEFAULT '[]';
