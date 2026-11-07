/** Kaizen goal creation, guided flow (listen -> understand -> confirm -> split). Text is server copy, already localized. */
export interface GoalClarify { needsClarification: true; intro: string; questions: string[]; maxAnswers: number }
export interface GoalConfirm { needsConfirmation: true; understood: string; goal: string; answers: string[]; actions: { confirm: string; notQuite: string } }
export interface GoalBody { title: string; timePerDayMin?: number; guided: true; answers?: string[]; confirm?: true }

const flag = (r: unknown, k: string) => !!r && typeof r === 'object' && (r as Record<string, unknown>)[k] === true;
export const needsClarification = (r: unknown): r is GoalClarify => flag(r, 'needsClarification') && Array.isArray((r as GoalClarify).questions);
export const needsConfirmation = (r: unknown): r is GoalConfirm => flag(r, 'needsConfirmation') && typeof (r as GoalConfirm).understood === 'string';
