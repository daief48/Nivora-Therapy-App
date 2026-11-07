-- TherapySession: scope card (encrypted) + topic-drift redirect state
ALTER TABLE "TherapySession" ADD COLUMN "scopeKind" TEXT,
ADD COLUMN     "scopeCardEnc" TEXT,
ADD COLUMN     "scopeChoice" TEXT,
ADD COLUMN     "scopeChoiceTurn" INTEGER;
