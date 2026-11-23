import type { Expense } from '../expenses';

export type EmailEvidence = {
  provider: 'gmail';
  accountKey: string;
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  sourceUrl: string;
  invoiceNumber?: string;
  invoiceKey?: string;
  suggestedStatus: 'paid' | 'unpaid' | 'review';
  confidence: 'high' | 'medium';
  originalAmount: number;
  attachment?: string;
};

export type EmailExpense = Expense & { email: EmailEvidence };
export type SkippedEmail = { messageId: string; subject: string; reason: string };
export type SyncResult = {
  expenses: EmailExpense[];
  skipped: SkippedEmail[];
  scanned: number;
  hasMore: boolean;
  nextPageToken?: string;
  completedAt: string;
};
export type Connection = {
  connected: boolean;
  email?: string;
  error?: string;
  lastSync?: string;
  status?: string;
  hasMore?: boolean;
  backgroundTracking?: boolean;
  scanSchedule?: string;
};

export function isEmailEvidence(value: unknown): value is EmailEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as EmailEvidence;
  return evidence.provider === 'gmail' &&
    ['accountKey', 'messageId', 'threadId', 'subject', 'sender', 'sourceUrl'].every(key => typeof (evidence as unknown as Record<string, unknown>)[key] === 'string') &&
    /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/[A-Za-z0-9%_-]+$/.test(evidence.sourceUrl) &&
    ['high', 'medium'].includes(evidence.confidence) && ['paid', 'unpaid', 'review'].includes(evidence.suggestedStatus) &&
    Number.isSafeInteger(evidence.originalAmount) && evidence.originalAmount > 0 &&
    (evidence.invoiceKey === undefined || typeof evidence.invoiceKey === 'string') &&
    (evidence.invoiceNumber === undefined || typeof evidence.invoiceNumber === 'string') &&
    (evidence.attachment === undefined || typeof evidence.attachment === 'string');
}
