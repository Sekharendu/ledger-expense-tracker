// Area balance: cream workspace 60%, dark chocolate anchors 30%, caramel accents 10%.
export const colors = {
  background: '#FDFBD4',
  surface: '#F3EDCC',
  ink: '#38240D',
  muted: '#713600',
  outline: '#D9C8A7',
  primary: '#C05800',
  primaryText: '#713600',
  primaryPressed: '#713600',
  onPrimary: '#FFFFFF',
  primaryContainer: '#F5E1BD',
  onPrimaryContainer: '#713600',
  onDark: '#FDFBD4',
  mutedOnDark: '#DDD0AD',
  outlineOnDark: '#604322',
  error: '#963E32',
  errorContainer: '#F5E6E1',
} as const;

export const type = {
  display: { fontSize: 44, lineHeight: 54, fontWeight: '500', letterSpacing: -1.2 },
  headline: { fontSize: 30, lineHeight: 38, fontWeight: '500', letterSpacing: -0.6 },
  title: { fontSize: 18, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 22 },
  label: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
} as const;
