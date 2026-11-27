import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useAccount } from '../auth/AccountProvider';
import { useActiveRefresh } from '../auth/useActiveRefresh';
import { beginConnection, disconnectConnection, getAttempt, getConnection, scanInvoices } from './client';
import type { Connection, SyncResult } from './types';

type Lifetime = { userId: string; active: boolean; busy: boolean; version: number };
type Attempt = { token: string; expires: number };

// The Gmail section unmounts whenever Settings closes. Keep the last known status per user so
// reopening Settings shows it straight away instead of "not connected" until the server answers.
const lastKnown = new Map<string, Connection>();

export function useGmail(onImport: () => Promise<void>) {
  const { session } = useAccount();
  const userId = session?.user.id;
  const [connection, setConnectionState] = useState<Connection>(() => (userId && lastKnown.get(userId)) || { connected: false });
  const [known, setKnown] = useState(() => Boolean(userId && lastKnown.has(userId)));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [report, setReport] = useState<(SyncResult & { added: number; duplicates: number; refreshed?: number }) | null>(null);
  const [owner, setOwner] = useState(userId);
  if (owner !== userId) {
    setOwner(userId); setConnectionState((userId && lastKnown.get(userId)) || { connected: false }); setKnown(Boolean(userId && lastKnown.has(userId))); setAttempt(null); setBusy(false); setError(''); setStatusError(''); setReport(null);
  }
  const lifetime = useRef<Lifetime | null>(null);
  const metadata = useRef<{ scope: Lifetime; promise: Promise<void> } | null>(null);
  const current = useCallback((scope: Lifetime) => scope.active && lifetime.current === scope, []);
  const setConnection = useCallback((value: Connection) => {
    if (userId) lastKnown.set(userId, value);
    setConnectionState(value); setKnown(true);
  }, [userId]);

  useEffect(() => {
    const scope = userId ? { userId, active: true, busy: false, version: 0 } : null;
    lifetime.current = scope; metadata.current = null;
    return () => { if (scope) scope.active = false; };
  }, [userId]);

  const refreshConnection = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope || scope.userId !== userId || !current(scope) || scope.busy) return;
    if (metadata.current?.scope === scope) return metadata.current.promise;
    const version = scope.version;
    const promise = (async () => {
      try {
        const value = await getConnection();
        if (current(scope) && scope.version === version) { setConnection(value); setStatusError(''); }
      } catch (reason) {
        if (current(scope) && scope.version === version) { setKnown(true); setStatusError(reason instanceof Error ? reason.message : 'Could not check Gmail connection.'); }
      } finally { if (metadata.current?.scope === scope) metadata.current = null; }
    })();
    metadata.current = { scope, promise };
    return promise;
  }, [userId, current, setConnection]);
  useActiveRefresh(refreshConnection, Boolean(userId));

  const sync = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope || scope.userId !== userId || !current(scope) || scope.busy) return;
    scope.busy = true; scope.version++; setBusy(true); setError('');
    try {
      await metadata.current?.promise;
      if (!current(scope)) return;
      const result = await scanInvoices();
      if (!current(scope)) return;
      setReport(result);
      await onImport();
      if (!current(scope)) return;
      const value = await getConnection();
      if (current(scope)) { setConnection(value); setStatusError(''); }
    } catch (reason) { if (current(scope)) setError(reason instanceof Error ? reason.message : 'The scan could not finish. Try again.'); }
    finally { if (current(scope)) { scope.busy = false; setBusy(false); } }
  }, [userId, current, onImport, setConnection]);

  const pollAttempt = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope || scope.userId !== userId || !current(scope) || scope.busy || !attempt) return;
    const version = scope.version;
    try {
      if (Date.now() > attempt.expires) { setAttempt(null); setError('Google permission request timed out. Try connecting Gmail again.'); return; }
      const status = await getAttempt(attempt.token);
      if (!current(scope) || scope.version !== version) return;
      if (status.status === 'complete') {
        setAttempt(null);
        // The server owns automatic imports. OAuth polling only reads saved state.
        await refreshConnection();
        if (current(scope) && scope.version === version) await onImport();
      } else if (['error', 'cancelled'].includes(status.status)) {
        setAttempt(null); setError(status.error ?? 'Gmail was not connected. Manual tracking remains available.');
      }
    } catch (reason) { if (current(scope) && scope.version === version) { setAttempt(null); setError(reason instanceof Error ? reason.message : 'Could not check Gmail connection.'); } }
  }, [userId, current, attempt, refreshConnection, onImport]);
  useActiveRefresh(pollAttempt, Boolean(userId && attempt), 2000);

  const connect = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope || scope.userId !== userId || !current(scope) || scope.busy) return;
    scope.busy = true; scope.version++; setBusy(true); setError('');
    const popup = Platform.OS === 'web' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    try {
      if (Platform.OS === 'web' && !popup) throw new Error('Allow pop-ups for Ledger, then connect Gmail again.');
      await metadata.current?.promise;
      if (!current(scope)) { popup?.close(); return; }
      const result = await beginConnection();
      if (!current(scope)) { popup?.close(); return; }
      if (new URL(result.authorizationUrl).origin !== 'https://accounts.google.com') throw new Error('Could not open Google permissions. Please try again.');
      if (popup) popup.location.href = result.authorizationUrl;
      else await Linking.openURL(result.authorizationUrl);
      if (current(scope)) setAttempt({ token: result.attemptToken, expires: Date.now() + 10 * 60_000 });
    } catch (reason) { popup?.close(); if (current(scope)) setError(reason instanceof Error ? reason.message : 'Could not connect Gmail.'); }
    finally { if (current(scope)) { scope.busy = false; setBusy(false); } }
  }, [userId, current]);

  const disconnect = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope || scope.userId !== userId || !current(scope) || scope.busy) return;
    scope.busy = true; scope.version++; setBusy(true); setError(''); setAttempt(null);
    try {
      await metadata.current?.promise;
      if (!current(scope)) return;
      await disconnectConnection();
      if (!current(scope)) return;
      setReport(null);
      const value = await getConnection();
      if (current(scope)) { setConnection(value); setStatusError(''); }
    } catch (reason) {
      if (!current(scope)) return;
      setError(reason instanceof Error ? reason.message : 'Could not disconnect Gmail.');
      try { const value = await getConnection(); if (current(scope)) setConnection(value); }
      catch { if (current(scope)) setStatusError('Could not check Gmail connection. Try again.'); }
    } finally { if (current(scope)) { scope.busy = false; setBusy(false); } }
  }, [userId, current, setConnection]);
  return { connection, checking: !known, waiting: Boolean(attempt), busy, error: error || statusError, report, hasMore: Boolean(connection.hasMore), hasSession: Boolean(attempt || connection.connected || connection.status === 'revoke_pending' || connection.status === 'reconnect_required'), connect, sync, disconnect };
}
