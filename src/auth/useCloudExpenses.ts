import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAccount } from './AccountProvider';
import { useActiveRefresh } from './useActiveRefresh';
import { isExpense, type Expense } from '../expenses';

type Lifetime = { userId: string; controller: AbortController; active: boolean; revision: number };

export function useCloudExpenses() {
  const { session } = useAccount();
  const userId = session?.user.id;
  const [items, setItems] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(userId);
  // Reset account-owned state before rendering a different user's dashboard.
  if (owner !== userId) {
    setOwner(userId); setItems([]); setLoaded(false); setStorageError(''); setBusy(false);
  }
  const records = useRef<Expense[]>([]);
  const saving = useRef(false);
  const lifetime = useRef<Lifetime | null>(null);
  const refreshing = useRef<{ scope: Lifetime; promise: Promise<void> } | null>(null);
  const current = useCallback((scope: Lifetime) => scope.active && lifetime.current === scope, []);

  useEffect(() => {
    const scope = userId ? { userId, controller: new AbortController(), active: true, revision: 0 } : null;
    lifetime.current = scope;
    records.current = []; saving.current = false; refreshing.current = null;
    return () => { if (scope) { scope.active = false; scope.controller.abort(); } };
  }, [userId]);

  const fetchRecords = useCallback(async (scope: Lifetime) => {
    if (!supabase || !current(scope)) throw new Error('Sign in to open your expenses.');
    const result: Expense[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from('ledger_expenses').select('payload').eq('user_id', scope.userId).order('id').range(start, start + 999).abortSignal(scope.controller.signal);
      if (!current(scope)) throw new Error('Account session changed.');
      if (error) throw new Error('Could not load your account expenses. Check your connection and try again.');
      if (!data.every(row => isExpense(row.payload))) throw new Error('Some expense records could not be opened. Please contact support.');
      result.push(...data.map(row => row.payload as Expense));
      if (data.length < 1000) break;
    }
    return result;
  }, [current]);

  const refresh = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope || scope.userId !== userId || !current(scope) || saving.current) return;
    if (refreshing.current?.scope === scope) return refreshing.current.promise;
    const revision = scope.revision;
    const promise = (async () => {
      try {
        const next = await fetchRecords(scope);
        // A read started before a save must not overwrite that save or its error state.
        if (current(scope) && !saving.current && revision === scope.revision) {
          records.current = next; setItems(next); setLoaded(true); setStorageError('');
        }
      } catch (reason) {
        if (current(scope) && !saving.current && revision === scope.revision) setStorageError(reason instanceof Error ? reason.message : 'Could not load expenses.');
        throw reason;
      } finally { if (refreshing.current?.scope === scope) refreshing.current = null; }
    })();
    refreshing.current = { scope, promise };
    return promise;
  }, [userId, current, fetchRecords]);
  useActiveRefresh(refresh, Boolean(userId));

  const commit = useCallback(async (next: Expense[] | ((current: Expense[]) => Expense[])) => {
    const scope = lifetime.current;
    if (!supabase || !scope || scope.userId !== userId || !current(scope) || !loaded || saving.current) return false;
    saving.current = true; scope.revision++; setBusy(true);
    const assertCurrent = () => { if (!current(scope)) throw new Error('Account session changed.'); };
    try {
      // Finish any passive read first. Its result is discarded once saving starts.
      await refreshing.current?.promise.catch(() => {});
      assertCurrent();
      const before = typeof next === 'function' ? await fetchRecords(scope) : records.current;
      const desired = typeof next === 'function' ? next(before) : next;
      const previous = new Map(before.map(item => [item.id, JSON.stringify(item)]));
      const changes = desired.filter(item => previous.get(item.id) !== JSON.stringify(item));
      const ids = new Set(desired.map(item => item.id));
      const removed = before.filter(item => !ids.has(item.id)).map(item => item.id);
      if (changes.length) {
        const additions = changes.filter(item => !previous.has(item.id));
        if (additions.length) {
          assertCurrent();
          const { error } = await supabase.from('ledger_expenses').insert(additions.map(item => ({ user_id: scope.userId, id: item.id, payload: item }))).abortSignal(scope.controller.signal);
          if (error) throw new Error('Your new expenses could not be saved. Please try again.');
        }
        for (const item of changes.filter(value => previous.has(value.id))) {
          assertCurrent();
          const { error } = await supabase.from('ledger_expenses').update({ payload: item }).eq('user_id', scope.userId).eq('id', item.id).abortSignal(scope.controller.signal);
          if (error) throw new Error('Your expense changes could not be saved. Please try again.');
        }
      }
      for (let start = 0; start < removed.length; start += 100) {
        assertCurrent();
        const { error } = await supabase.from('ledger_expenses').delete().eq('user_id', scope.userId).in('id', removed.slice(start, start + 100)).abortSignal(scope.controller.signal);
        if (error) throw new Error('Some expenses could not be deleted. Please try again.');
      }
      const saved = await fetchRecords(scope);
      assertCurrent(); records.current = saved; setItems(saved); setLoaded(true); setStorageError('');
      return true;
    } catch (reason) { if (current(scope)) setStorageError(reason instanceof Error ? reason.message : 'Could not save expenses.'); return false; }
    finally { if (current(scope)) { saving.current = false; setBusy(false); } }
  }, [userId, loaded, current, fetchRecords]);

  return { items, loaded, storageError, busy, commit, refresh };
}
