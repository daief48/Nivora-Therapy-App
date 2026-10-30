import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelay, speechInstructions, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';
import { classifyTranscript, holdDelay, isEcho, thoughtKind } from '../modules/realtime/transcriptFilter.js';

// Turn state machine, echo/noise filtering, adaptive hold, sentence-by-sentence speech, crisis across fragments and connection hygiene.
// No network, no database: the relay core runs against a fake upstream.
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<RelayDeps> = {}) {
  const out: ServerMsg[] = [];
  const upstream: any[] = [];
  let upClosed = false;
  const converse = vi.fn(async (i: any) => { i.onDelta('Hello'); return 'I hear you. What feels hardest right now?'; });
  const crisis = vi.fn(async (_i: any) => 'Your safety comes first. Please call your local emergency number.');
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
  const types = () => out.filter((m) => m.type !== 'state').map((m) => m.type);
  return { relay, out, upstream, converse, crisis, hello, types, isUpClosed: () => upClosed };
}
type S = ReturnType<typeof setup>;
const transcript = (t: string) => ({ type: 'conversation.item.input_audio_transcription.completed', transcript: t });
const send = (s: S, m: unknown) => s.relay.onClient(JSON.stringify(m));
const gated = () => {
  const calls: { i: any; res: (t: string) => void }[] = [];
  const converse = vi.fn((i: any) => new Promise<string>((res) => { calls.push({ i, res }); }));
  return { calls, converse };
};
const creates = (s: S) => s.upstream.filter((e) => e.type === 'response.create');
const cancels = (s: S) => s.upstream.filter((e) => e.type === 'response.cancel');
const audioOut = (s: S) => s.out.filter((m) => m.type === 'audio').map((m: any) => m.data);
const stateFrames = (s: S) => s.out.filter((m) => m.type === 'state').map((m: any) => m.state);

afterEach(() => { vi.useRealTimers(); });

describe('realtime relay: state frames', () => {
  it('sends state on every change and once after ready', async () => {
    const s = setup();
    await s.hello();
    expect(stateFrames(s)).toEqual(['listening']);
    s.relay.onUpstream(transcript('I feel anxious about exams'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    expect(stateFrames(s)).toEqual(['listening', 'thinking', 'speaking', 'listening']);
    expect(s.types().at(-1)).toBe('assistant_done');
  });
});

describe('realtime relay: the last utterance is never lost', () => {
  it('a transcript while thinking cancels the request and the unanswered words are answered together with it', async () => {
    const g = gated();
    const s = setup({ converse: g.converse });
    await s.hello();
    s.relay.onUpstream(transcript('how do I sleep'));
    await tick();
    expect(s.relay.state).toBe('thinking');
    s.relay.onUpstream(transcript('better at night'));
    expect(g.calls[0]!.i.signal.aborted).toBe(true);
    expect(s.types()).toContain('interrupted');
    await tick();
    expect(g.calls[1]!.i.text).toBe('how do I sleep better at night');
    g.calls[0]!.res('A stale reply.'); await tick();
    expect(creates(s)).toHaveLength(0);
    g.calls[1]!.res('Try a calm routine.'); await tick();
    expect(creates(s)).toHaveLength(1);
    expect(creates(s)[0].response.instructions).toContain('Try a calm routine.');
  });

  it('a transcript while speaking cancels the voice (audio_reset + cancel by id) and is answered afterwards, one assistant_done', async () => {
    const s = setup({ converse: async (i) => `re ${i.text} ok` });
    await s.hello();
    s.relay.onUpstream(transcript('tell me something calming'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAAA' });
    s.relay.onUpstream(transcript('actually I prefer a story please'));
    expect(s.types()).toContain('audio_reset');
    expect(cancels(s).at(-1)).toMatchObject({ type: 'response.cancel', response_id: 'r1' });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'r1', delta: 'BBBB' }); // late audio of the cancelled reply
    await tick();
    expect(audioOut(s)).toEqual(['AAAA']);
    expect(creates(s)).toHaveLength(2);
    expect(creates(s)[1].response.instructions).toContain('re actually I prefer a story please ok');
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r2' } });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'r2', delta: 'CCCC' });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } }); // the cancelled one finishing must not end the new reply
    expect(s.types()).not.toContain('assistant_done');
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r2' } });
    expect(audioOut(s)).toEqual(['AAAA', 'CCCC']);
    expect(s.types().filter((t) => t === 'assistant_done')).toHaveLength(1);
  });

  it('speech_started while thinking, then the words arrive: both parts are answered as one', async () => {
    const g = gated();
    const s = setup({ converse: g.converse });
    await s.hello();
    s.relay.onUpstream(transcript('I have been feeling low'));
    await tick();
    s.relay.onUpstream({ type: 'input_audio_buffer.speech_started' });
    expect(g.calls[0]!.i.signal.aborted).toBe(true);
    expect(stateFrames(s).at(-1)).toBe('listening');
    s.relay.onUpstream(transcript('since last week'));
    await tick();
    expect(g.calls[1]!.i.text).toBe('I have been feeling low since last week');
    s.relay.close('test');
  });

  it('speech_started that never yields words: the interrupted thinking turn is still answered after the grace time', async () => {
    vi.useFakeTimers();
    const g = gated();
    const s = setup({ converse: g.converse, speechGraceMs: 500 });
    await s.hello();
    s.relay.onUpstream(transcript('I have been feeling low'));
    await vi.advanceTimersByTimeAsync(0);
    s.relay.onUpstream({ type: 'input_audio_buffer.speech_started' }); // a cough
    await vi.advanceTimersByTimeAsync(400);
    expect(g.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(g.calls).toHaveLength(2);
    expect(g.calls[1]!.i.text).toBe('I have been feeling low');
    s.relay.close('test');
  });

  it('an explicit interrupt discards the pending words (the user pressed stop)', async () => {
    vi.useFakeTimers();
    const g = gated();
    const s = setup({ converse: g.converse, speechGraceMs: 100 });
    await s.hello();
    s.relay.onUpstream(transcript('please talk about exams'));
    await vi.advanceTimersByTimeAsync(0);
    await send(s, { type: 'interrupt' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.calls).toHaveLength(1);
    s.relay.close('test');
  });

  it('a transcript right after response.done is answered normally', async () => {
    const s = setup({ converse: async (i) => `re ${i.text} ok` });
    await s.hello();
    s.relay.onUpstream(transcript('first thing here'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    expect(s.relay.state).toBe('listening');
    s.relay.onUpstream(transcript('something else entirely now'));
    await tick();
    expect(creates(s)).toHaveLength(2);
    expect(s.types()).not.toContain('interrupted');
  });
});

describe('realtime relay: no overlapping replies, no orphaned audio', () => {
  const twoTurns = async () => {
    const s = setup({ converse: async (i) => `re ${i.text} ok` });
    await s.hello();
    s.relay.onUpstream(transcript('first thing here'));
    await tick();
    s.relay.onUpstream(transcript('second thing here')); // cancelled before upstream announced the first response
    await tick();
    return s;
  };

  it('cancel before created, then created for the cancelled response arrives', async () => {
    const s = await twoTurns();
    expect(creates(s)).toHaveLength(2);
    s.relay.onUpstream({ type: 'response.created', response: { id: 'rA' } });
    expect(cancels(s).at(-1)).toMatchObject({ response_id: 'rA' });
    s.relay.onUpstream({ type: 'response.created', response: { id: 'rB' } });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'rA', delta: 'AAAA' });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'rB', delta: 'BBBB' });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'rA' } });
    expect(s.types()).not.toContain('assistant_done');
    s.relay.onUpstream({ type: 'response.done', response: { id: 'rB' } });
    expect(audioOut(s)).toEqual(['BBBB']);
    expect(s.types().filter((t) => t === 'assistant_done')).toHaveLength(1);
  });

  it('done without created for a cancelled response does not steal the next response id', async () => {
    const s = await twoTurns();
    s.relay.onUpstream({ type: 'response.done', response: { id: 'rA' } }); // never announced
    s.relay.onUpstream({ type: 'response.created', response: { id: 'rB' } });
    s.relay.onUpstream({ type: 'response.audio.delta', response_id: 'rB', delta: 'BBBB' });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'rB' } });
    expect(audioOut(s)).toEqual(['BBBB']);
    expect(s.types().at(-1)).toBe('assistant_done');
  });
});

describe('realtime relay: echo and noise', () => {
  const spokenReply = async (extra: Partial<RelayDeps> = {}) => {
    const s = setup({ converse: async () => 'Try breathing in slowly for four counts. Then let it go gently.', ...extra });
    await s.hello();
    s.relay.onUpstream(transcript('I cannot relax at all'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    return s;
  };

  it('drops a transcript that is a fragment of the assistant voice, without cutting the reply', async () => {
    const s = await spokenReply();
    s.relay.onUpstream(transcript('breathing in slowly for four counts'));
    expect(s.out.at(-1)).toEqual({ type: 'ignored', reason: 'echo' });
    expect(s.relay.state).toBe('speaking');
    await tick();
    expect(cancels(s)).toHaveLength(0);
  });

  it('drops an echo shortly after the reply finished, but not later or for a genuine reply', async () => {
    let t = 1_000_000;
    const s = await spokenReply({ now: () => t });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    t += 3000;
    s.relay.onUpstream(transcript('Try breathing in slowly for four counts.'));
    expect(s.out.at(-1)).toEqual({ type: 'ignored', reason: 'echo' });
    s.relay.onUpstream(transcript('yes'));
    expect(s.out.some((m) => m.type === 'final_transcript' && (m as any).text === 'yes')).toBe(true);
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r2' } });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r2' } });
    t += 30_000;
    s.relay.onUpstream(transcript('Try breathing in slowly for four counts.')); // far later: the user may really say it
    expect(s.out.at(-1)).not.toEqual({ type: 'ignored', reason: 'echo' });
    s.relay.close('test');
  });

  it.each([
    ['', 'empty'], ['  ...  ', 'empty'], ['hmm...', 'noise'], ['um', 'noise'], ['উম', 'noise'], ['Thank you for watching!', 'noise'],
    ['Subtitles by the Amara.org community', 'noise'], [' you', 'noise'], ['♪♪', 'noise'], ['aaaaaa', 'noise'],
  ] as const)('ignores %j as %s and never calls the model', async (text, reason) => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript(text));
    await tick();
    expect(s.out.at(-1)).toEqual({ type: 'ignored', reason });
    expect(s.converse).not.toHaveBeenCalled();
    expect(s.crisis).not.toHaveBeenCalled();
  });

  it('a dropped transcript does not strand words that are being held', async () => {
    vi.useFakeTimers();
    const s = setup({ holdMs: 100 });
    await s.hello();
    s.relay.onUpstream(transcript('I need to talk about work.'));
    s.relay.onUpstream({ type: 'input_audio_buffer.speech_started' });
    s.relay.onUpstream(transcript('hmm'));
    await vi.advanceTimersByTimeAsync(150);
    expect(s.converse).toHaveBeenCalledTimes(1);
    expect(s.converse.mock.calls[0]![0].text).toBe('I need to talk about work.');
    s.relay.close('test');
  });
});

describe('realtime relay: adaptive end of speech', () => {
  it('answers a finished sentence sooner than one that trails off', async () => {
    vi.useFakeTimers();
    const a = setup({ holdMs: 100 });
    await a.hello();
    a.relay.onUpstream(transcript('I feel much better today.'));
    await vi.advanceTimersByTimeAsync(110);
    expect(a.converse).toHaveBeenCalledTimes(1);

    const b = setup({ holdMs: 100 });
    await b.hello();
    b.relay.onUpstream(transcript('I feel better today, but'));
    await vi.advanceTimersByTimeAsync(110);
    expect(b.converse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(b.converse).toHaveBeenCalledTimes(1);
    a.relay.close('test'); b.relay.close('test');
  });

  it('handles Bangla conjunctions and caps the wait at ~1.6 s', async () => {
    vi.useFakeTimers();
    const s = setup({ holdMs: 1000 });
    await s.hello();
    s.relay.onUpstream(transcript('আমি ভালো আছি কিন্তু'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.converse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(s.converse).toHaveBeenCalledTimes(1);
    s.relay.close('test');
  });
});

describe('realtime relay: sentence-by-sentence speech', () => {
  const streaming = () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const converse = async (i: any) => {
      i.onDelta('First sentence is here. Second');
      await gate;
      i.onDelta(' sentence follows now.');
      return 'First sentence is here. Second sentence follows now.';
    };
    return { converse, release };
  };

  it('starts speaking after the first sentence and feeds the rest sequentially, with one assistant_done', async () => {
    const st = streaming();
    const s = setup({ converse: st.converse });
    await s.hello();
    s.relay.onUpstream(transcript('please help me relax'));
    await tick();
    expect(creates(s)).toHaveLength(1);
    expect(creates(s)[0].response.instructions).toBe(speechInstructions('First sentence is here.'));
    expect(s.relay.state).toBe('speaking');
    st.release(); await tick();
    expect(creates(s)).toHaveLength(1); // the next one waits for response.done of the previous
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    expect(creates(s)).toHaveLength(2);
    expect(creates(s)[1].response.instructions).toBe(speechInstructions('Second sentence follows now.'));
    expect(s.types()).not.toContain('assistant_done');
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r2' } });
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r2' } });
    expect(s.types().filter((t) => t === 'assistant_done')).toHaveLength(1);
    expect(s.relay.state).toBe('listening');
  });

  it('barge-in drops the queued sentences', async () => {
    const st = streaming();
    const s = setup({ converse: st.converse });
    await s.hello();
    s.relay.onUpstream(transcript('please help me relax'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    await send(s, { type: 'interrupt' });
    st.release(); await tick();
    s.relay.onUpstream({ type: 'response.done', response: { id: 'r1' } });
    expect(creates(s)).toHaveLength(1);
    expect(s.types()).not.toContain('assistant_done');
  });

  it('if the final reply differs from what was streamed (unsafe text replaced), it is spoken again from the top', async () => {
    const s = setup({ converse: async (i) => { i.onDelta('Unsafe start. Okay'); return 'Safe fallback text.'; } });
    await s.hello();
    s.relay.onUpstream(transcript('please help me relax'));
    await tick();
    expect(creates(s)).toHaveLength(2);
    expect(creates(s)[1].response.instructions).toBe(speechInstructions('Safe fallback text.'));
    expect(s.types()).toContain('audio_reset');
  });
});

describe('realtime relay: crisis across fragments', () => {
  it('takes the crisis path when the last fragments together are HIGH, though each alone is not', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript('I am so tired and I want to end'));
    await tick();
    expect(s.converse).toHaveBeenCalledTimes(1);
    s.relay.onUpstream(transcript('my life now'));
    await tick();
    expect(s.converse).toHaveBeenCalledTimes(1); // the model was not called for the second fragment
    expect(s.crisis).toHaveBeenCalledOnce();
    expect((s.crisis.mock.calls[0] as any[])[0].text).toBe('I am so tired and I want to end my life now');
    expect(creates(s).at(-1).response.instructions).toContain('Your safety comes first');
  });

  it('forgets fragments older than ~45 s', async () => {
    let t = 1_000_000;
    const s = setup({ now: () => t });
    await s.hello();
    s.relay.onUpstream(transcript('I am so tired and I want to end'));
    await tick();
    t += 60_000;
    s.relay.onUpstream(transcript('my life now'));
    await tick();
    expect(s.crisis).not.toHaveBeenCalled();
  });
});

describe('realtime relay: connection hygiene', () => {
  const expiring = (inMs: number) => ({ authenticate: async (tk: string) => (tk === 'good' ? { userId: 'u1', expiresAt: Date.now() + inMs } : null) });

  it('warns before the token expires, then closes with TOKEN_EXPIRED', async () => {
    vi.useFakeTimers();
    const s = setup(expiring(90_000));
    await s.hello();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(s.out).toContainEqual({ type: 'token_expiring', inSec: 60 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.out.at(-1)).toMatchObject({ type: 'error', code: 'TOKEN_EXPIRED' });
    expect(s.relay.state).toBe('closed');
    expect(s.isUpClosed()).toBe(true);
  });

  it('accepts a refreshed token (auth -> auth_ok) and keeps the call alive past the old expiry', async () => {
    vi.useFakeTimers();
    const s = setup(expiring(90_000));
    await s.hello();
    await vi.advanceTimersByTimeAsync(40_000);
    await send(s, { type: 'auth', token: 'good' }); // the new token expires 90 s from "now"
    expect(s.out.at(-1)).toEqual({ type: 'auth_ok' });
    await vi.advanceTimersByTimeAsync(80_000);
    expect(s.relay.state).toBe('listening');
    expect(s.out.some((m: any) => m.code === 'TOKEN_EXPIRED')).toBe(false);
    s.relay.close('test');
  });

  it('a bad refresh token ends the call with UNAUTHORIZED', async () => {
    const s = setup();
    await s.hello();
    await send(s, { type: 'auth', token: 'bad' });
    expect(s.out.at(-1)).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    expect(s.relay.state).toBe('closed');
  });

  it('a refresh for a different user is refused', async () => {
    const s = setup({ authenticate: async (tk) => (tk === 'good' ? { userId: 'u1' } : tk === 'other' ? { userId: 'u2' } : null) });
    await s.hello();
    await send(s, { type: 'auth', token: 'other' });
    expect(s.relay.state).toBe('closed');
  });

  it('replace() tells the old connection and closes it', async () => {
    const s = setup();
    await s.hello();
    s.relay.replace();
    expect(s.out.at(-1)).toEqual({ type: 'replaced' });
    expect(s.relay.state).toBe('closed');
    expect(s.isUpClosed()).toBe(true);
  });

  it('hello with resume:true is handled like a normal hello; admit sees the session id', async () => {
    const admit = vi.fn((_u: string, _s?: string) => true);
    const s = setup({ admit });
    await send(s, { type: 'hello', token: 'good', sessionId: 's1', resume: true });
    expect(s.types()).toEqual(['ready']);
    expect(admit).toHaveBeenCalledWith('u1', 's1');
  });

  it('close() clears the hold timer, aborts in-flight work and never answers into a dead call', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const g = gated();
    const s = setup({ converse: g.converse, holdMs: 100, onClose });
    await s.hello();
    s.relay.onUpstream(transcript('first words here.'));
    await vi.advanceTimersByTimeAsync(150);
    expect(g.calls).toHaveLength(1);
    s.relay.onUpstream(transcript('and a held fragment'));
    s.relay.close('test');
    expect(g.calls[0]!.i.signal.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledWith('test');
    g.calls[0]!.res('too late'); await vi.advanceTimersByTimeAsync(0);
    s.relay.onUpstream(transcript('more words here.'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(g.calls).toHaveLength(1);
    expect(creates(s)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives an upstream that throws on send, garbage events, and an upstream that closes mid-reply', async () => {
    const s = setup({ connectUpstream: async () => ({ send: () => { throw new Error('socket gone'); }, close: () => {} }) });
    await s.hello();
    await send(s, { type: 'audio', data: 'AAAA' });
    s.relay.onUpstream(transcript('hello there friend'));
    await tick();
    s.relay.onUpstream({ type: 'response.audio.delta', delta: 5 });
    s.relay.onUpstream(null as any);
    s.relay.onUpstream({ type: 'response.done', response: null });
    s.relay.onUpstreamClose();
    expect(s.out.at(-1)).toEqual({ type: 'unavailable', reason: 'upstream_closed' });
    expect(s.relay.state).toBe('closed');
  });

  it('a failed speech response reports SPEECH_FAILED and still finishes the turn', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript('hello there friend'));
    await tick();
    s.relay.onUpstream({ type: 'response.created', response: { id: 'r1' } });
    s.relay.onUpstream({ type: 'error', error: { code: 'server_error' } });
    expect(s.out.some((m: any) => m.code === 'SPEECH_FAILED')).toBe(true);
    expect(s.types().at(-1)).toBe('assistant_done');
    expect(s.relay.state).toBe('listening');
  });
});

describe('classifyTranscript', () => {
  it.each(['', '   ', '...', '?!', '— —'])('empty: %j', (t) => expect(classifyTranscript(t)).toBe('empty'));
  it.each([
    'um', 'Uh.', 'Hmm...', 'hm', 'ah', 'umm uh', 'আ', 'উম', 'হুম', 'हम्म', 'आह', '♪', '🎵 🎶',
    'Thank you for watching', 'Thanks for watching!', 'Please subscribe', 'Subtitles by the Amara.org community', ' you', 'You.',
    'aaaaa', 'ااااا', 'দেখার জন্য ধন্যবাদ', 'देखने के लिए धन्यवाद', 'हेर्नु भएकोमा धन्यवाद',
  ])('noise: %j', (t) => expect(classifyTranscript(t)).toBe('noise'));
  it.each([
    'yes', 'no', 'I am fine', 'Thank you', 'thank you so much for listening to me', 'হ্যাঁ', 'আমি ভালো নেই', 'मैं ठीक हूँ', 'म ठीक छु', 'ok', 'haha',
  ])('ok: %j', (t) => expect(classifyTranscript(t)).toBe('ok'));
});

describe('isEcho', () => {
  const said = [{ text: 'Try breathing in slowly for four counts. Then let it go gently.', at: 1000, live: false }];
  it('matches fragments and near copies within the window', () => {
    expect(isEcho('breathing in slowly for four counts', said, 5000)).toBe(true);
    expect(isEcho('Try breathing in slowly for four counts. Then let it go gently.', said, 5000)).toBe(true);
    expect(isEcho('try breathing in slowly four counts then let it go gentle', said, 5000)).toBe(true);
  });
  it('does not match short genuine replies, other speech, or old speech', () => {
    expect(isEcho('yes', said, 5000)).toBe(false);
    expect(isEcho('I tried that before and it did not help', said, 5000)).toBe(false);
    expect(isEcho('breathing in slowly for four counts', said, 1000 + 13_000)).toBe(false);
  });
  it('still matches while the assistant is speaking, whatever the elapsed time', () => {
    expect(isEcho('breathing in slowly for four counts', [{ ...said[0]!, live: true }], 60_000)).toBe(true);
  });
  it('a short reply equal to a whole spoken chunk is an echo', () => {
    expect(isEcho('Yes.', [{ text: 'Yes.', at: 1000, live: false }], 2000)).toBe(true);
  });
  it('works for Bangla', () => {
    const bn = [{ text: 'আমি তোমার কথা শুনছি। এখন কেমন লাগছে?', at: 0, live: false }];
    expect(isEcho('আমি তোমার কথা শুনছি', bn, 1000)).toBe(true);
    expect(isEcho('আমার খুব ভয় লাগছে', bn, 1000)).toBe(false);
  });
});

describe('thoughtKind / holdDelay', () => {
  it('classifies the end of an utterance', () => {
    expect(thoughtKind('I feel fine.')).toBe('complete');
    expect(thoughtKind('Why is that?')).toBe('complete');
    expect(thoughtKind('আমি ভালো আছি।')).toBe('complete');
    expect(thoughtKind('I was thinking,')).toBe('mid');
    expect(thoughtKind('well...')).toBe('mid');
    expect(thoughtKind('I want to go but')).toBe('mid');
    expect(thoughtKind('আমি যাব কিন্তু')).toBe('mid');
    expect(thoughtKind('मैं जाऊंगा और')).toBe('mid');
    expect(thoughtKind('म जान्छु तर')).toBe('mid');
    expect(thoughtKind('I went home')).toBe('open');
  });
  it('is shortest for complete, longest for mid, capped at 1.6 s, and 0 when disabled', () => {
    expect(holdDelay('Done.', 600)).toBe(600);
    expect(holdDelay('I went home', 600)).toBe(900);
    expect(holdDelay('and', 600)).toBe(1500);
    expect(holdDelay('and', 1000)).toBe(1600);
    expect(holdDelay('and', 0)).toBe(0);
    expect(holdDelay('and', 600, { midMs: 5000 })).toBe(1600);
    expect(holdDelay('Done.', 600, { completeMs: 200 })).toBe(200);
  });
});
