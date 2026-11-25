import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { createRefreshLoop } from '../refresh';

export function useActiveRefresh(refresh: () => Promise<void>, enabled: boolean, interval = 30_000) {
  useEffect(() => {
    if (!enabled) return;
    const loop = createRefreshLoop(refresh, interval);
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return () => loop.stop();
      const visibility = () => loop.setActive(document.visibilityState !== 'hidden');
      const focus = () => { visibility(); void loop.refresh(); };
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('focus', focus);
      visibility();
      return () => { loop.stop(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus); };
    }
    const state = AppState.addEventListener('change', value => loop.setActive(value === 'active'));
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { loop.setActive(AppState.currentState === 'active'); void loop.refresh(); }) : null;
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => loop.setActive(false)) : null;
    loop.setActive(AppState.currentState === 'active' || AppState.currentState === null);
    return () => { loop.stop(); state.remove(); focus?.remove(); blur?.remove(); };
  }, [refresh, enabled, interval]);
}
