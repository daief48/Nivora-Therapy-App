/**
 * Seeds SupportResource with a MINIMAL set of widely-published emergency numbers.
 * Every row is seeded with lastVerifiedAt = null (UNVERIFIED): the API and apps flag these as "confirm locally".
 * A named operator must verify each entry and set lastVerifiedAt (docs/CRISIS_RESOURCES.md) before launch.
 * Do not add numbers here that you have not confirmed with the operating organisation.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const rows = [
  { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' },
  { countryCode: 'US', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '911' },
  { countryCode: 'US', language: 'en', resourceType: 'CRISIS_LINE', name: '988 Suicide & Crisis Lifeline (call or text)', contactDetails: '988' },
  { countryCode: 'GB', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '999' },
  { countryCode: 'CA', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '911' },
  { countryCode: 'IN', language: 'en', resourceType: 'EMERGENCY', name: 'National Emergency Number', contactDetails: '112' },
  { countryCode: 'AU', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '000' },
];

for (const r of rows) {
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: r.countryCode, resourceType: r.resourceType, name: r.name } },
    create: r, update: {},
  });
}
console.log(`Seeded ${rows.length} support resources (all UNVERIFIED).`);
await db.$disconnect();
