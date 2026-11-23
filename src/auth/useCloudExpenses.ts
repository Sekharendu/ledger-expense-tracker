import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { useAccount } from './AccountProvider';
import { isExpense, type Expense } from '../expenses';

export function useCloudExpenses() {
  const { session } = useAccount();
  const userId = session?.user.id;
  const [items, setItems] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const records = useRef<Expense[]>([]);
  const saving = useRef(false);

  const fetchRecords = useCallback(async () => {
    if (!supabase || !userId) throw new Error('Sign in to open your expenses.');
    const result: Expense[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from('ledger_expenses').select('payload').eq('user_id', userId).order('id').range(start, start + 999);
      if (error) throw new Error('Could not load your account expenses. Check your connection and try again.');
      if (!data.every(row => isExpense(row.payload))) throw new Error('Some expense records could not be opened. Please contact support.');
      result.push(...data.map(row => row.payload as Expense));
      if (data.length < 1000) break;
    }
    return result;
  }, [userId]);
  const refresh = useCallback(async () => {
    const next = await fetchRecords();
    records.current = next; setItems(next); setLoaded(true); setStorageError('');
  }, [fetchRecords]);
  useEffect(() => {
    let active = true;
    void fetchRecords().then(next => { if (active) { records.current = next; setItems(next); setLoaded(true); setStorageError(''); } }).catch(reason => { if (active) setStorageError(reason instanceof Error ? reason.message : 'Could not load expenses.'); });
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh().catch(() => {}); });
    const timer = setInterval(() => { if (!saving.current) void refresh().catch(() => {}); }, 60_000);
    return () => { active = false; listener.remove(); clearInterval(timer); };
  }, [fetchRecords, refresh]);

  const commit = useCallback(async (next: Expense[] | ((current: Expense[]) => Expense[])) => {
    if (!supabase || !userId || !loaded || saving.current) return false;
    saving.current = true; setBusy(true);
    try {
      const before = records.current;
      const desired = typeof next === 'function' ? next(await fetchRecords()) : next;
      const previous = new Map(before.map(item => [item.id, JSON.stringify(item)]));
      const changes = desired.filter(item => previous.get(item.id) !== JSON.stringify(item));
      const ids = new Set(desired.map(item => item.id));
      const removed = before.filter(item => !ids.has(item.id)).map(item => item.id);
      if (changes.length) {
        const additions = changes.filter(item => !previous.has(item.id));
        if (additions.length) {
          const { error } = await supabase.from('ledger_expenses').insert(additions.map(item => ({ user_id: userId, id: item.id, payload: item })));
          if (error) throw new Error('Your new expenses could not be saved. Please try again.');
        }
        for (const item of changes.filter(value => previous.has(value.id))) {
          const { error } = await supabase.from('ledger_expenses').update({ payload: item }).eq('user_id', userId).eq('id', item.id);
          if (error) throw new Error('Your expense changes could not be saved. Please try again.');
        }
      }
      if (removed.length) {
        for (let start = 0; start < removed.length; start += 100) {
          const { error } = await supabase.from('ledger_expenses').delete().eq('user_id', userId).in('id', removed.slice(start, start + 100));
          if (error) throw new Error('Some expenses could not be deleted. Please try again.');
        }
      }
      await refresh(); return true;
    } catch (reason) { setStorageError(reason instanceof Error ? reason.message : 'Could not save expenses.'); return false; }
    finally { saving.current = false; setBusy(false); }
  }, [userId, loaded, fetchRecords, refresh]);

  return { items, loaded, storageError, busy, commit, refresh };
}
