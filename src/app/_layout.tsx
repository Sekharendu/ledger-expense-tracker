import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountProvider } from '../auth/AccountProvider';

export default function Layout() {
  return <SafeAreaProvider><AccountProvider><Slot /></AccountProvider></SafeAreaProvider>;
}
