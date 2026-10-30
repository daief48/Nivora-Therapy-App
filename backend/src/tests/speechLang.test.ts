import { describe, expect, it } from 'vitest';
import { createSttClient } from '../services/sttClient.js';
import { createTtsClient } from '../services/ttsClient.js';

const audio = Buffer.alloc(2000, 1);
const okRes = (text: string) => new Response(JSON.stringify({ text }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('speech in Hindi and Nepali (voice and video calls)', () => {
  it('sends an explicit language hint and a native-script prompt for hi and ne', async () => {
    const seen: { language: unknown; prompt: unknown }[] = [];
    const stt = createSttClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', timeoutMs: 5000 }, (async (_u: unknown, init: any) => {
      seen.push({ language: init.body.get('language'), prompt: init.body.get('prompt') });
      return okRes('ok');
    }) as typeof fetch);
    await stt.transcribe(audio, 'audio/webm', 'hi');
    await stt.transcribe(audio, 'audio/webm', 'ne');
    await stt.transcribe(audio, 'audio/webm', 'mixed');
    expect(seen[0]!.language).toBe('hi');
    expect(String(seen[0]!.prompt)).toMatch(/[ऀ-ॿ]/);
    expect(seen[1]!.language).toBe('ne');
    expect(String(seen[1]!.prompt)).toMatch(/नेपाली/);
    expect(seen[2]!.language).toBeNull(); // mixed stays auto-detect
  });

  it('retries once without the hint when the provider rejects an unsupported language', async () => {
    const hints: unknown[] = [];
    const stt = createSttClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', timeoutMs: 5000 }, (async (_u: unknown, init: any) => {
      hints.push(init.body.get('language'));
      return hints.length === 1 ? new Response('{}', { status: 400 }) : okRes('नमस्ते');
    }) as typeof fetch);
    expect(await stt.transcribe(audio, 'audio/webm', 'ne')).toBe('नमस्ते');
    expect(hints).toEqual(['ne', null]);
  });

  it('does not echo the language prompt back as speech', async () => {
    const stt = createSttClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', timeoutMs: 5000 }, (async (_u: unknown, init: any) => okRes(String(init.body.get('prompt')))) as typeof fetch);
    expect(await stt.transcribe(audio, 'audio/webm', 'hi')).toBe('');
  });

  it('asks the voice to speak Hindi or Nepali natively', async () => {
    const bodies: any[] = [];
    const tts = createTtsClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', voice: 'v', timeoutMs: 5000 }, (async (_u: unknown, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response(new Uint8Array(1200), { status: 200 });
    }) as typeof fetch);
    await tts.synthesize('नमस्ते', 'hi');
    await tts.synthesize('नमस्ते', 'ne');
    expect(bodies[0].instructions).toMatch(/Hindi/);
    expect(bodies[1].instructions).toMatch(/Nepali/);
  });
});
