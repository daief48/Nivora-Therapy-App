/**
 * Seeds SupportResource. A row is marked verified (lastVerifiedAt + sourceUrl) ONLY when the number was read
 * on the official/authoritative page named in sourceUrl (see docs/CRISIS_RESOURCES.md for the evidence and date).
 * Every other row is seeded UNVERIFIED (lastVerifiedAt = null): the API and apps flag it as "confirm locally".
 * Do not add numbers here that you have not confirmed with the operating organisation.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const now = new Date();

interface Row { countryCode: string; language: string; resourceType: string; name: string; contactDetails: string; sourceUrl?: string }

const rows: Row[] = [
  // ---- verified against the official page in sourceUrl ----
  { countryCode: 'US', language: 'en', resourceType: 'CRISIS_LINE', name: '988 Suicide & Crisis Lifeline (call or text)', contactDetails: '988', sourceUrl: 'https://988lifeline.org/' },
  { countryCode: 'GB', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '999', sourceUrl: 'https://www.nhs.uk/mental-health/get-urgent-help-for-mental-health/' },
  { countryCode: 'GB', language: 'en', resourceType: 'CRISIS_LINE', name: 'NHS 111 (choose the mental health option)', contactDetails: '111', sourceUrl: 'https://www.nhs.uk/mental-health/get-urgent-help-for-mental-health/' },
  { countryCode: 'CA', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '911', sourceUrl: 'https://www.canada.ca/en/public-health/services/mental-health-services/mental-health-get-help.html' },
  { countryCode: 'CA', language: 'en', resourceType: 'CRISIS_LINE', name: '9-8-8 Suicide Crisis Helpline (call or text)', contactDetails: '988', sourceUrl: 'https://www.canada.ca/en/public-health/services/mental-health-services/mental-health-get-help.html' },
  { countryCode: 'AU', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '000', sourceUrl: 'https://www.lifeline.org.au/131114/' },
  { countryCode: 'AU', language: 'en', resourceType: 'CRISIS_LINE', name: 'Lifeline crisis support', contactDetails: '13 11 14', sourceUrl: 'https://www.lifeline.org.au/131114/' },
  { countryCode: 'AE', language: 'en', resourceType: 'EMERGENCY', name: 'Police', contactDetails: '999', sourceUrl: 'https://u.ae/en/information-and-services/justice-safety-and-the-law/Safety/handling-emergencies' },
  { countryCode: 'AE', language: 'en', resourceType: 'EMERGENCY', name: 'Ambulance', contactDetails: '998', sourceUrl: 'https://u.ae/en/information-and-services/justice-safety-and-the-law/Safety/handling-emergencies' },

  // ---- NOT verified by us yet: widely published numbers, shown with a "confirm locally" label ----
  { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' },
  { countryCode: 'US', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '911' },
  { countryCode: 'IN', language: 'en', resourceType: 'EMERGENCY', name: 'National Emergency Number', contactDetails: '112' },
  { countryCode: 'IN', language: 'en', resourceType: 'CRISIS_LINE', name: 'Tele-MANAS mental health helpline', contactDetails: '14416' },
  { countryCode: 'PK', language: 'en', resourceType: 'EMERGENCY', name: 'Police', contactDetails: '15' },
  { countryCode: 'NP', language: 'en', resourceType: 'EMERGENCY', name: 'Police', contactDetails: '100' },
  { countryCode: 'LK', language: 'en', resourceType: 'EMERGENCY', name: 'Police', contactDetails: '119' },
  { countryCode: 'SA', language: 'en', resourceType: 'EMERGENCY', name: 'Unified emergency number', contactDetails: '911' },
  { countryCode: 'MY', language: 'en', resourceType: 'EMERGENCY', name: 'Emergency services', contactDetails: '999' },
];

let verified = 0;
for (const { sourceUrl, ...r } of rows) {
  const proof = sourceUrl ? { sourceUrl, lastVerifiedAt: now } : {};
  if (sourceUrl) verified++;
  await db.supportResource.upsert({
    where: { countryCode_resourceType_name: { countryCode: r.countryCode, resourceType: r.resourceType, name: r.name } },
    create: { ...r, ...proof },
    update: { contactDetails: r.contactDetails, language: r.language, ...proof },
  });
}
console.log(`Seeded ${rows.length} support resources (${verified} verified against an official page, ${rows.length - verified} UNVERIFIED).`);
await db.$disconnect();
