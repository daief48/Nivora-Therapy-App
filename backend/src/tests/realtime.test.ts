import { describe, expect, it, vi } from 'vitest';
import { createRelay, speechInstructions, upstreamSessionConfig, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';

// No network, no database: the relay core runs against a fake upstream.
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<RelayDeps> = {}) {
  const out: ServerMsg[] = [];
  const upstream: any[] = [];
  let upClosed = false;
  const converse = vi.fn(async (i: any) => { i.onDelta('Hello'); return 'I hear you. What feels hardest right now?'; });
  const crisis = vi.fn(async () => 'Your safety comes first. Please call your local emergency number.');
  const deps: RelayDeps = {
    send: (m) => out.push(m),
    authenticate: async (t) => (t === 'good' ? { userId: 'u1' } : null),
    openSession: async (u, s) => (u === 'u1' && s === 's1' ? { language: 'en' } : null),
    connectUpstream: async () => ({ send: (e) => upstream.push(e), close: () => { upClosed = true; } }),
    converse, crisis,
    ...over,
  };
  const relay = createRelay(deps);
  const hello = (token = 'good', sessionId = 's1') => relay.onClient(JSON.stringify({ type: 'hello', token, sessionId }));
  const types = () => out.map((m) => m.type);
  return { relay, out, upstream, converse, crisis, hello, types, isUpClosed: () => upClosed };
}
const transcript = (t: string) => ({ type: 'conversation.item.input_audio_transcription.completed', transcript: t });

describe('realtime relay: auth and protocol', () => {
  it('rejects a bad token and closes without opening upstream', async () => {
    const connect = vi.fn(async () => null);
    const s = setup({ connectUpstream: connect });
    await s.hello('bad');
    expect(s.out).toEqual([{ type: 'error', code: 'UNAUTHORIZED', message: expect.any(String) }]);
    expect(s.relay.state).toBe('closed');
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects a session that is not the user\'s', async () => {
    const s = setup();
    await s.hello('good', 'someone-elses');
    expect(s.out[0]).toMatchObject({ type: 'error', code: 'NOT_FOUND' });
    expect(s.relay.state).toBe('closed');
  });

  it('does not accept audio before hello', async () => {
    const s = setup();
    await s.relay.onClient(JSON.stringify({ type: 'audio', data: 'AAAA' }));
    expect(s.out[0]).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    expect(s.upstream).toEqual([]);
  });

  it('sends ready after a good hello and forwards audio upstream', async () => {
    const s = setup();
    await s.hello();
    expect(s.out).toEqual([{ type: 'ready', sampleRate: 24000, format: 'pcm16' }]);
    await s.relay.onClient(JSON.stringify({ type: 'audio', data: 'AAAA' }));
    expect(s.upstream).toEqual([{ type: 'input_audio_buffer.append', audio: 'AAAA' }]);
  });

  it('validates messages: junk, unknown type, oversize frame', async () => {
    const s = setup({ maxAudioFrame: 10 });
    await s.hello();
    s.out.length = 0;
    await s.relay.onClient('not json');
    await s.relay.onClient(JSON.stringify({ type: 'nope' }));
    await s.relay.onClient(JSON.stringify({ type: 'audio', data: 'x'.repeat(11) }));
    expect(s.out.map((m: any) => m.code)).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE', 'FRAME_TOO_LARGE']);
    expect(s.relay.state).toBe('listening');
  });

  it('closes a connection that floods control frames', async () => {
    const s = setup({ maxControlPerSec: 3, now: () => 1000 });
    await s.hello();
    for (let i = 0; i < 5; i++) await s.relay.onClient(JSON.stringify({ type: 'ping' }));
    expect(s.out.some((m: any) => m.code === 'RATE_LIMITED')).toBe(true);
    expect(s.relay.state).toBe('closed');
  });

  it('enforces the per-user connection cap', async () => {
    const s = setup({ admit: () => false });
    await s.hello();
    expect(s.out[0]).toMatchObject({ code: 'TOO_MANY_CONNECTIONS' });
    expect(s.relay.state).toBe('closed');
  });

  it('reports unavailable when upstream cannot be opened, and when it drops later', async () => {
    const a = setup({ connectUpstream: async () => null });
    await a.hello();
    expect(a.out).toEqual([{ type: 'unavailable', reason: 'upstream_unavailable' }]);
    const b = setup();
    await b.hello();
    b.relay.onUpstreamClose();
    expect(b.types()).toEqual(['ready', 'unavailable']);
  });
});

describe('realtime relay: turns and safety', () => {
  it('runs a normal turn: transcript -> conversation -> spoken exactly', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream({ type: 'conversation.item.input_audio_transcription.delta', delta: 'I feel ' });
    s.relay.onUpstream(transcript('I feel anxious about exams'));
    await tick();
    expect(s.converse).toHaveBeenCalledOnce();
    expect(s.converse.mock.calls[0]![0]).toMatchObject({ userId: 'u1', sessionId: 's1', text: 'I feel anxious about exams' });
    expect(s.crisis).not.toHaveBeenCalled();
    const create = s.upstream.find((e) => e.type === 'response.create');
    expect(create.response.instructions).toBe(speechInstructions('I hear you. What feels hardest right now?'));
    expect(create.response.conversation).toBe('none');
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'r1', delta: 'QUJD' });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    expect(s.types()).toEqual(['ready', 'partial_transcript', 'final_transcript', 'assistant_text_delta', 'audio', 'assistant_done']);
    expect(s.relay.state).toBe('listening');
  });

  it.each([
    'I want to kill myself tonight',
    'I am going to end my life',
  ])('HIGH/IMMINENT: fixed crisis reply is spoken and the model is NOT called (%s)', async (text) => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript(text));
    await tick();
    expect(s.converse).not.toHaveBeenCalled();
    expect(s.crisis).toHaveBeenCalledOnce();
    const create = s.upstream.find((e) => e.type === 'response.create');
    expect(create.response.instructions).toContain('Your safety comes first');
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    expect(s.out.at(-1)).toEqual({ type: 'assistant_done', crisis: true });
  });

  it('Bangla crisis phrasing also bypasses the model', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript('আমি আত্মহত্যা করতে চাই'));
    await tick();
    expect(s.converse).not.toHaveBeenCalled();
    expect(s.crisis).toHaveBeenCalledOnce();
  });

  it('never logs transcript or reply content', async () => {
    const lines: string[] = [];
    const s = setup({ log: (e, f) => lines.push(JSON.stringify({ e, f })) });
    await s.hello();
    s.relay.onUpstream(transcript('I feel anxious about exams'));
    await tick();
    expect(lines.join('')).not.toMatch(/anxious|hardest/);
  });

  it('surfaces a conversation failure as an error and returns to listening', async () => {
    const s = setup({ converse: async () => { throw Object.assign(new Error('x'), { code: 'AI_NOT_CONFIGURED' }); } });
    await s.hello();
    s.relay.onUpstream(transcript('hello there'));
    await tick();
    expect(s.out.at(-1)).toMatchObject({ type: 'error', code: 'AI_NOT_CONFIGURED' });
    expect(s.relay.state).toBe('listening');
  });
});

describe('realtime relay: barge-in', () => {
  it('speech_started while speaking cancels upstream audio and drops late deltas', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript('tell me something calming'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAAA' });
    s.relay.onUpstream({ type: 'input_audio_buffer.speech_started' });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'r1', delta: 'BBBB' }); // late delta
    expect(s.upstream.some((e) => e.type === 'response.cancel')).toBe(true);
    expect(s.out.filter((m) => m.type === 'audio')).toHaveLength(1);
    expect(s.types()).toContain('interrupted');
    expect(s.relay.state).toBe('listening');
  });

  it('client interrupt aborts the in-flight conversation request and discards its reply', async () => {
    let signal!: AbortSignal; let release!: (t: string) => void;
    const s = setup({ converse: (i) => new Promise<string>((res) => { signal = i.signal; release = res; }) });
    await s.hello();
    s.relay.onUpstream(transcript('how do I sleep better'));
    await tick();
    expect(s.relay.state).toBe('thinking');
    await s.relay.onClient(JSON.stringify({ type: 'interrupt' }));
    expect(signal.aborted).toBe(true);
    release('A late reply that must not be spoken.');
    await tick();
    expect(s.upstream.some((e) => e.type === 'response.create')).toBe(false);
    expect(s.types()).toContain('interrupted');
  });

  it('interrupt before upstream announced the response id still cancels it', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript('hello there friend'));
    await tick();
    expect(s.upstream.some((e) => e.type === 'response.create')).toBe(true);
    await s.relay.onClient(JSON.stringify({ type: 'interrupt' }));
    const cancels = () => s.upstream.filter((e) => e.type === 'response.cancel').length;
    expect(cancels()).toBe(1);
    s.relay.onUpstream({ type: 'response.created', response: { id: 'late' } }); // arrives after the cancel
    expect(cancels()).toBe(2);
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'late', delta: 'AAAA' });
    expect(s.out.filter((m) => m.type === 'audio')).toHaveLength(0);
  });

  it('a new utterance replaces the one in flight', async () => {
    const calls: string[] = [];
    const s = setup({ converse: async (i) => { calls.push(i.text); await tick(); return `re: ${i.text}`; } });
    await s.hello();
    s.relay.onUpstream(transcript('first thing'));
    s.relay.onUpstream(transcript('second thing'));
    await tick(); await tick();
    expect(calls).toEqual(['first thing', 'second thing']);
    const creates = s.upstream.filter((e) => e.type === 'response.create');
    expect(creates).toHaveLength(1);
    expect(creates[0].response.instructions).toContain('re: second thing');
  });
});

describe('upstream session config', () => {
  it('uses server VAD that never creates a response by itself, and transcription only', () => {
    const c = upstreamSessionConfig({ transcribeModel: 'gpt-4o-transcribe', language: 'bn', voice: 'shimmer' });
    expect(c.session.turn_detection).toMatchObject({ type: 'server_vad', create_response: false, interrupt_response: false });
    expect(c.session.input_audio_transcription).toEqual({ model: 'gpt-4o-transcribe', language: 'bn' });
    expect(upstreamSessionConfig({ transcribeModel: 'm', language: 'mixed', voice: 'v' }).session.input_audio_transcription).toEqual({ model: 'm' });
  });
});
