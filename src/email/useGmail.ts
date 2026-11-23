import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { beginConnection, disconnectConnection, getAttempt, getConnection, scanInvoices } from './client';
import type { Connection, SyncResult } from './types';

export function useGmail(onImport: () => Promise<void>) {
  const [connection, setConnection] = useState<Connection>({ connected: false });
  const [attempt, setAttempt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<(SyncResult & { added: number; duplicates: number }) | null>(null);
  const running = useRef(false);
  useEffect(() => { let active = true; void getConnection().then(value => { if (active) setConnection(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not check Gmail connection.'); }); return () => { active = false; }; }, []);

  const sync = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { const result = await scanInvoices(); setReport(result); await onImport(); setConnection(await getConnection()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The scan could not finish. Try again.'); }
    finally { running.current = false; setBusy(false); }
  }, [onImport]);

  useEffect(() => {
    if (!attempt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const expires = Date.now() + 10 * 60_000;
    const poll = async () => {
      try {
        const status = await getAttempt(attempt);
        if (cancelled) return;
        if (status.status === 'complete') { setAttempt(null); setConnection(await getConnection()); await sync(); return; }
        if (['error', 'cancelled'].includes(status.status)) { setAttempt(null); setError(status.error ?? 'Gmail was not connected. Manual tracking remains available.'); return; }
        if (Date.now() > expires) { setAttempt(null); setError('Google permission request timed out. Try connecting Gmail again.'); return; }
        timer = setTimeout(poll, 2000);
      } catch (reason) { if (!cancelled) { setAttempt(null); setError(reason instanceof Error ? reason.message : 'Could not check Gmail connection.'); } }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [attempt, sync]);

  const connect = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    const popup = Platform.OS === 'web' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    try {
      if (Platform.OS === 'web' && !popup) throw new Error('Allow pop-ups for Ledger, then connect Gmail again.');
      const result = await beginConnection();
      if (new URL(result.authorizationUrl).origin !== 'https://accounts.google.com') throw new Error('Could not open Google permissions. Please try again.');
      if (popup) popup.location.href = result.authorizationUrl;
      else await Linking.openURL(result.authorizationUrl);
      setAttempt(result.attemptToken);
    } catch (reason) { popup?.close(); setError(reason instanceof Error ? reason.message : 'Could not connect Gmail.'); }
    finally { running.current = false; setBusy(false); }
  }, []);

  const disconnect = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await disconnectConnection(); setAttempt(null); setReport(null); setConnection(await getConnection()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not disconnect Gmail.'); setConnection(await getConnection().catch(() => ({ connected: false }))); }
    finally { running.current = false; setBusy(false); }
  }, []);
  return { connection, waiting: Boolean(attempt), busy, error, report, hasMore: Boolean(connection.hasMore), hasSession: Boolean(attempt || connection.connected || connection.status === 'revoke_pending' || connection.status === 'reconnect_required'), connect, sync, disconnect };
}
