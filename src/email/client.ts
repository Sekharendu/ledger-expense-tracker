import { Platform } from 'react-native';
import { supabase } from '../auth/supabase';
import type { Connection, SyncResult } from './types';

const API_URL = (process.env.EXPO_PUBLIC_EMAIL_API_URL ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
export class EmailApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function request<T>(path: string, method = 'GET', timeout = 30_000, headers: Record<string, string> = {}): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new EmailApiError('Sign in to Ledger to continue.', 401);
  if (!API_URL) throw new EmailApiError('Gmail connection is temporarily unavailable. Manual tracking is available.', 503);
  let response: Response;
  try { response = await fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new EmailApiError('Could not reach Ledger. Check your internet connection and try again.', 0); }
  const data = await response.json();
  if (!response.ok) throw new EmailApiError(typeof data.error === 'string' ? data.error : 'The email service could not complete the request.', response.status);
  return data as T;
}
export const beginConnection = () => request<{ attemptToken: string; authorizationUrl: string }>('/api/gmail/start', 'POST');
export const getConnection = () => request<Connection>('/api/connection');
export const getAttempt = (attempt: string) => request<{ status: string; error?: string }>(`/api/gmail/status?attempt=${encodeURIComponent(attempt)}`);
export const disconnectConnection = () => request('/api/connection', 'DELETE');
export const scanInvoices = () => request<SyncResult & { added: number; duplicates: number; refreshed?: number }>('/api/sync', 'POST', 5 * 60_000);
export const deleteAccount = () => request<{ deleted: boolean }>('/api/account', 'DELETE', 60_000, { 'X-Ledger-Confirm-Deletion': 'true' });
