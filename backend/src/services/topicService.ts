import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { notFound } from '../utils/errors.js';
import { TOPIC_KINDS, type TopicKind } from './topicPrompts.js';

export interface TopicContent { kind: TopicKind; label: string | null }

/** Kind + optional custom label live in one encrypted blob; "working on addiction" is itself sensitive. */
export const packTopic = (cipher: Cipher, c: TopicContent) => cipher.encrypt(JSON.stringify({ kind: c.kind, label: c.label }));

export function unpackTopic(cipher: Cipher, enc: string): TopicContent {
  try {
    const p = JSON.parse(cipher.decrypt(enc)) as Partial<TopicContent>;
    const kind = (TOPIC_KINDS as readonly string[]).includes(p.kind as string) ? (p.kind as TopicKind) : 'OTHER';
    return { kind, label: typeof p.label === 'string' && p.label ? p.label : null };
  } catch { return { kind: 'OTHER', label: null }; }
}

/** The topic must belong to the user; anything else is a 404 (never reveals other users' ids). */
export async function ownedTopic(db: Db, userId: string, id: string) {
  const t = await db.topic.findFirst({ where: { id, userId } });
  if (!t) throw notFound('Topic not found');
  return t;
}
