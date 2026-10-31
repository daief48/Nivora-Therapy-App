import { describe, expect, it } from 'vitest';
import { createRelay, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function run(deltas: string[], full: string) {
  const out: ServerMsg[] = []; const up: any[] = [];
  const deps: RelayDeps = {
    send: (m) => out.push(m), authenticate: async () => ({ userId: 'u1' }), openSession: async () => ({ language: 'en' }),
    connectUpstream: async () => ({ send: (e) => up.push(e), close: () => {} }),
    converse: async (i: any) => { for (const d of deltas) i.onDelta(d); return full; },
    crisis: async () => 'x', holdMs: 0,
  } as any;
  const relay = createRelay(deps);
  await relay.onClient(JSON.stringify({ type: 'hello', token: 'good', sessionId: 's1' }));
  relay.onUpstream({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'how are you' });
  await tick();
  // play every queued chunk to completion like upstream would
  for (let k = 0; k < 8; k++) {
    const c = up.filter((e) => e.type === 'response.create').length;
    if (c <= k) break;
    relay.onUpstream({ type: 'response.created', response: { id: 'r' + k } });
    relay.onUpstream({ type: 'response.done', response: { id: 'r' + k } });
    await tick();
  }
  return { creates: up.filter((e) => e.type === 'response.create').map((e) => e.response.instructions), resets: out.filter((m) => m.type === 'audio_reset').length };
}
describe('dup', () => {
  it('same text', async () => { console.log(JSON.stringify(await run(['I am ', 'fine, thanks. ', 'How about you?'], 'I am fine, thanks. How about you?'))); });
  it('shortened final', async () => { console.log(JSON.stringify(await run(['I am fine, thanks for asking. ', 'It has been a calm day. ', 'I like talking with you. ', 'What about you?'], 'I am fine, thanks for asking. It has been a calm day. What about you?'))); });
  it('short', async () => { console.log(JSON.stringify(await run(['I am fine.'], 'I am fine.'))); });
});
