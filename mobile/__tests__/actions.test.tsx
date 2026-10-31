import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Share } from 'react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, dispatch: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ api: (...a: [string, any]) => mockApi(...a), ApiError: class extends Error {} }));
jest.mock('../src/utils/copyText', () => ({ copyText: jest.fn(async () => true) }));

import type { ActionCardData } from '../src/api/actions';
import { ActionCard } from '../src/components/ActionCard';
import { SessionCloseCard } from '../src/components/SessionCloseCard';
import { en, bn, hi, ne } from '../src/i18n/ext/actions';
import { ActionGratitudeScreen } from '../src/screens/ActionGratitudeScreen';
import { ActionReachOutScreen } from '../src/screens/ActionReachOutScreen';
import { ActionWalkScreen } from '../src/screens/ActionWalkScreen';
import { useSettings } from '../src/store/settings';
import { mapActionLink, resolveActionLink } from '../src/utils/actionLink';

const card = (over: Partial<ActionCardData> = {}): ActionCardData => ({
  offerId: 'o1', id: 'BREATHING', kind: 'BREATHING', crisis: false, minutes: 2, deepLink: { route: 'Exercise', params: { kind: 'breathing' } }, surface: 'CHAT',
  title: 'Two slow breaths', why: 'Slow breathing can settle the body.', reason: 'You said things felt fast.', cta: 'Try it', notNow: 'Not now',
  titleKey: 't', whyKey: 'w', reasonKey: 'r', ...over,
});
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const crisis = { crisis: true, safety: { severity: 'HIGH', crisis: true, message: 'Please reach out now.', resources: [{ name: 'Helpline X', contactDetails: '999' }] } };

beforeEach(() => {
  useSettings.setState({ reducedMotion: false, uiLang: 'en' });
  mockNavigate.mockClear(); mockGoBack.mockClear(); mockApi.mockClear(); mockParams = undefined;
  mockHandler = () => ({});
});

describe('ActionCard', () => {
  it('shows title, why, reason and minutes; Try it posts ACCEPTED by offer id and opens the target', async () => {
    await render(<ActionCard card={card()} />);
    expect(screen.getByText('Two slow breaths')).toBeTruthy();
    expect(screen.getByText('Slow breathing can settle the body.')).toBeTruthy();
    expect(screen.getByText('You said things felt fast.')).toBeTruthy();
    expect(screen.getByText('2 min')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try it' }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/o1/outcome', { method: 'POST', body: { outcome: 'ACCEPTED', surface: 'CHAT' } });
    expect(mockNavigate).toHaveBeenCalledWith('Exercise', { kind: 'breathing' });
  });

  it('uses the action id when there is no offer, and onTry replaces navigation', async () => {
    const onTry = jest.fn();
    await render(<ActionCard card={card({ offerId: null, surface: 'TODAY' })} onTry={onTry} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try it' }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/BREATHING/outcome', expect.anything());
    expect(onTry).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('Not now hides the card, posts DISMISSED and reports it', async () => {
    const onOutcome = jest.fn();
    await render(<ActionCard card={card()} onOutcome={onOutcome} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await flush();
    expect(screen.queryByText('Two slow breaths')).toBeNull();
    expect(mockApi).toHaveBeenCalledWith('/actions/o1/outcome', { method: 'POST', body: { outcome: 'DISMISSED', surface: 'CHAT' } });
    expect(onOutcome).toHaveBeenCalledWith('DISMISSED');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('thumbs post once and say thanks (only when asked for)', async () => {
    await render(<ActionCard card={card()} showFeedback />);
    await fireEvent.press(screen.getByRole('button', { name: 'Helpful' }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/o1/outcome', { method: 'POST', body: { outcome: 'THUMBS_UP', surface: 'CHAT' } });
    expect(screen.getByText('Thank you, noted.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
  });

  it('a failed outcome post never blocks the person', async () => {
    mockHandler = () => new Error('down');
    await render(<ActionCard card={card()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try it' }));
    await flush();
    expect(mockNavigate).toHaveBeenCalledWith('Exercise', { kind: 'breathing' });
  });

  it('crisis card: support action prominent, no thumbs and no Not now', async () => {
    await render(<ActionCard card={card({ crisis: true, id: 'EMERGENCY', kind: 'CRISIS', minutes: 0, cta: 'Get help now', deepLink: { route: 'Emergency' } })} showFeedback />);
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
    expect(screen.queryByText('0 min')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Get help now' }));
    await flush();
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });

  it('renders static under reduced motion', async () => {
    useSettings.setState({ reducedMotion: true });
    await render(<ActionCard card={card()} />);
    expect(screen.getByText('Two slow breaths')).toBeTruthy();
  });

  it('Bengali chrome uses the translated minutes label', async () => {
    useSettings.setState({ uiLang: 'bn' });
    await render(<ActionCard card={card()} />);
    expect(screen.getByText('2 মিনিট')).toBeTruthy();
  });
});

describe('resolveActionLink', () => {
  const nav = { navigate: jest.fn() };
  beforeEach(() => nav.navigate.mockClear());
  it('keeps existing routes as they are', () => {
    resolveActionLink(nav, { route: 'Exercise', params: { kind: 'thought' } });
    resolveActionLink(nav, { route: 'JournalEdit' });
    resolveActionLink(nav, { route: 'JournalEdit', params: { mode: 'voice' } });
    resolveActionLink(nav, { route: 'Routine' });
    resolveActionLink(nav, { route: 'Sounds' });
    resolveActionLink(nav, { route: 'SafetyPlan' });
    resolveActionLink(nav, { route: 'Emergency' });
    expect(nav.navigate.mock.calls).toEqual([
      ['Exercise', { kind: 'thought' }], ['JournalEdit'], ['JournalEdit', { mode: 'voice' }], ['Routine'], ['Sounds'], ['SafetyPlan'], ['Emergency'],
    ]);
  });
  it('maps gratitude, walk and reach-out to the new routes', () => {
    resolveActionLink(nav, { route: 'Exercise', params: { kind: 'gratitude' } });
    resolveActionLink(nav, { route: 'ActionWalk' });
    resolveActionLink(nav, { route: 'ActionReachOut', params: { support: true } });
    resolveActionLink(nav, { route: 'ActionReachOut' });
    expect(nav.navigate.mock.calls).toEqual([['ActionGratitude'], ['ActionWalk'], ['ActionReachOut', { support: true }], ['ActionReachOut']]);
  });
  it('opens a tab, with the weekday when there is one', () => {
    resolveActionLink(nav, { route: 'Tabs', params: { screen: 'KaizenTab' } });
    resolveActionLink(nav, { route: 'Tabs', params: { screen: 'KaizenTab', weekday: 3 } });
    expect(nav.navigate.mock.calls).toEqual([['Tabs', { screen: 'KaizenTab' }], ['Tabs', { screen: 'KaizenTab', params: { weekday: 3 } }]]);
  });
  it('does nothing, safely, for unknown routes and bad input', () => {
    resolveActionLink(nav, { route: 'Nope' });
    resolveActionLink(nav, { route: 'Exercise', params: { kind: 'invented' } });
    resolveActionLink(nav, { route: 'Tabs' });
    resolveActionLink(nav, undefined as never);
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(mapActionLink(null)).toBeNull();
  });
  it('a throwing navigator is swallowed', () => {
    expect(() => resolveActionLink({ navigate: () => { throw new Error('no route'); } }, { route: 'Sounds' })).not.toThrow();
  });
});

describe('session close card', () => {
  const close = (over: object = {}) => ({ prompt: 'What are you taking with you?', riskMode: false, action: card({ surface: 'SESSION_CLOSE' }), support: [], ...over });
  it('shows the server prompt and ONE card; accepting saves it to Kaizen and confirms gently', async () => {
    mockHandler = (p) => (p === '/actions/session-close' ? close() : {});
    await render(wrap(<SessionCloseCard sessionId="s1" />));
    expect(await screen.findByText('What are you taking with you?')).toBeTruthy();
    expect(screen.getAllByTestId('action-card')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Try it' }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/o1/outcome', { method: 'POST', body: { outcome: 'ACCEPTED', surface: 'SESSION_CLOSE', saveToKaizen: true } });
    expect(screen.getByText('Added to your small steps. That is enough for now.')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  it('risk mode shows support cards only', async () => {
    const sup = card({ crisis: true, id: 'EMERGENCY', kind: 'CRISIS', cta: 'Get help now', title: 'Help right now', deepLink: { route: 'Emergency' } });
    mockHandler = (p) => (p === '/actions/session-close' ? close({ riskMode: true, action: card(), support: [sup] }) : {});
    await render(wrap(<SessionCloseCard sessionId="s1" />));
    expect(await screen.findByText('Help right now')).toBeTruthy();
    expect(screen.queryByText('Two slow breaths')).toBeNull();
  });
  it('action:null with no support shows nothing; errors show nothing; Skip hides it', async () => {
    mockHandler = (p) => (p === '/actions/session-close' ? close({ action: null }) : {});
    const r = await render(wrap(<SessionCloseCard sessionId="s1" />));
    await flush();
    expect(screen.queryByText('What are you taking with you?')).toBeNull();
    await r.unmount();
    mockHandler = () => new Error('down');
    await render(wrap(<SessionCloseCard sessionId="s2" />));
    await flush();
    expect(screen.queryByText('What are you taking with you?')).toBeNull();
  });
  it('is skippable', async () => {
    mockHandler = (p) => (p === '/actions/session-close' ? close() : {});
    await render(wrap(<SessionCloseCard sessionId="s3" />));
    await screen.findByText('What are you taking with you?');
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByText('What are you taking with you?')).toBeNull();
  });
});

describe('ActionWalkScreen', () => {
  const choices = { choices: [{ key: 'walk', minutes: 10, label: 'A short walk' }, { key: 'music', minutes: 5, label: 'One favourite song' }] };
  it('posts the chosen idea and shows a gentle confirmation with a flower', async () => {
    mockHandler = (p, o) => (p === '/actions/walk' && o?.method === 'POST' ? { crisis: false, created: true, alreadyDone: false, action: { id: 'a1', title: 'A short walk', status: 'PLANNED' }, flowers: 3 } : choices);
    await render(wrap(<ActionWalkScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'A short walk · 10 min' }));
    await fireEvent.press(screen.getByRole('button', { name: "Add as today's small step" }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/walk', { method: 'POST', body: { choice: 'walk' } });
    expect(screen.getByText('Added to today. Tick it off whenever you do it.')).toBeTruthy();
    expect(screen.getByText('A flower for your garden.')).toBeTruthy();
  });
  it('free text (trimmed) goes with the minutes; needs a choice or text first', async () => {
    mockHandler = (p, o) => (p === '/actions/walk' && o?.method === 'POST' ? { crisis: false, created: true, alreadyDone: false, action: { id: 'a1', title: 'Water the plants', status: 'PLANNED' }, flowers: 0 } : choices);
    await render(wrap(<ActionWalkScreen />));
    await screen.findByText('Pick one');
    await fireEvent.press(screen.getByRole('button', { name: "Add as today's small step" }));
    expect(screen.getByText('Pick one, or write your own.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Or write your own'), '  Water the plants ');
    await fireEvent.press(screen.getByRole('button', { name: '15 min' }));
    await fireEvent.press(screen.getByRole('button', { name: "Add as today's small step" }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/walk', { method: 'POST', body: { text: 'Water the plants', minutes: 15 } });
    expect(screen.queryByText('A flower for your garden.')).toBeNull();
  });
  it('already done is handled kindly', async () => {
    mockHandler = (p, o) => (p === '/actions/walk' && o?.method === 'POST' ? { crisis: false, created: false, alreadyDone: true, action: { id: 'a1', title: 'A short walk', status: 'DONE' }, flowers: 3 } : choices);
    await render(wrap(<ActionWalkScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'A short walk · 10 min' }));
    await fireEvent.press(screen.getByRole('button', { name: "Add as today's small step" }));
    await flush();
    expect(screen.getByText('You already have this one for today. That is fine.')).toBeTruthy();
    expect(screen.queryByText('A flower for your garden.')).toBeNull();
  });
  it('a crisis payload shows the support UI and nothing else', async () => {
    mockHandler = (p, o) => (p === '/actions/walk' && o?.method === 'POST' ? crisis : choices);
    await render(wrap(<ActionWalkScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'A short walk · 10 min' }));
    await fireEvent.press(screen.getByRole('button', { name: "Add as today's small step" }));
    await flush();
    expect(screen.getByText('Helpline X')).toBeTruthy();
    expect(screen.getByText('999')).toBeTruthy();
    expect(screen.queryByText(/Added to today/)).toBeNull();
  });
});

describe('ActionGratitudeScreen', () => {
  it('saves one field and confirms', async () => {
    mockHandler = (p) => (p === '/actions/gratitude' ? { crisis: false, entry: { id: 'j1', entryType: 'GRATITUDE', createdAt: '' } } : {});
    await render(wrap(<ActionGratitudeScreen />));
    expect(screen.getByRole('button', { name: 'Save to my journal' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('One good thing'), '  The tea was warm. ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save to my journal' }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/gratitude', { method: 'POST', body: { text: 'The tea was warm.' } });
    expect(screen.getByText('Saved to your journal.')).toBeTruthy();
  });
  it('handles a crisis payload without saving anything', async () => {
    mockHandler = (p) => (p === '/actions/gratitude' ? crisis : {});
    await render(wrap(<ActionGratitudeScreen />));
    await fireEvent.changeText(screen.getByLabelText('One good thing'), 'text');
    await fireEvent.press(screen.getByRole('button', { name: 'Save to my journal' }));
    await flush();
    expect(screen.getByText('Helpline X')).toBeTruthy();
    expect(screen.queryByText('Saved to your journal.')).toBeNull();
  });
  it('shows a gentle error and keeps the text when saving fails', async () => {
    mockHandler = () => new Error('down');
    await render(wrap(<ActionGratitudeScreen />));
    await fireEvent.changeText(screen.getByLabelText('One good thing'), 'text');
    await fireEvent.press(screen.getByRole('button', { name: 'Save to my journal' }));
    await flush();
    expect(screen.getByText('That did not save. You can try again whenever you like.')).toBeTruthy();
  });
});

describe('ActionReachOutScreen', () => {
  const data = {
    contacts: [{ id: 'c1', name: 'Rina', relation: 'Sister', phone: '+8801700000000', drafts: ['Hi Rina, could we talk?', 'Hi Rina, I had a hard day.'] }],
    templates: ['Hi {name}, could we talk?'], sent: false, hasContacts: true,
  };
  it('fills the draft, lets it be edited, and shares through the system sheet (nothing is sent by the app)', async () => {
    mockHandler = () => data;
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await render(wrap(<ActionReachOutScreen />));
    expect(await screen.findByDisplayValue('Hi Rina, could we talk?')).toBeTruthy();
    expect(screen.getByText(/Nivora never sends anything/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Your message (you can change it)'), 'Hi Rina, are you free tonight?');
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await flush();
    expect(share).toHaveBeenCalledWith({ message: 'Hi Rina, are you free tonight?' });
    expect(mockApi.mock.calls.filter(([, o]) => o && (o as any).method === 'POST')).toHaveLength(0); // no send endpoint exists or is called
    share.mockRestore();
  });
  it('Copy confirms', async () => {
    mockHandler = () => data;
    await render(wrap(<ActionReachOutScreen />));
    await screen.findByDisplayValue('Hi Rina, could we talk?');
    await fireEvent.press(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(screen.getByText('Copied.')).toBeTruthy();
  });
  it('support mode is framed as reaching out to someone you trust and shows the phone number', async () => {
    mockParams = { support: true };
    mockHandler = () => data;
    await render(wrap(<ActionReachOutScreen />));
    expect(await screen.findByText('Reach out to someone you trust')).toBeTruthy();
    expect(screen.getByText('Phone: +8801700000000')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Emergency help' }));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });
  it('with no contacts it points to the safety plan screen', async () => {
    mockHandler = () => ({ contacts: [], templates: ['Hi {name}'], sent: false, hasContacts: false });
    await render(wrap(<ActionReachOutScreen />));
    expect(await screen.findByText('You have not added anyone you trust yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add people I trust' }));
    expect(mockNavigate).toHaveBeenCalledWith('SafetyPlan');
  });
});

describe('action strings', () => {
  it('has every key in every language', () => {
    for (const d of [bn, hi, ne]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
  });
  it('keeps the placeholders of the English text', () => {
    for (const d of [bn, hi, ne]) for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect((d[k].match(/\{\w+\}/g) ?? []).sort()).toEqual((en[k].match(/\{\w+\}/g) ?? []).sort());
    }
  });
});
