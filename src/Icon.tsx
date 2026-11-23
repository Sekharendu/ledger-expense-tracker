import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName = 'overview' | 'inbox' | 'clock' | 'settings' | 'plus' | 'left' | 'right' | 'arrow' | 'close' | 'check' | 'device' | 'receipt';

// A single 24-unit grid and stroke weight, authored for Ledger's navigation.
export function Icon({ name, size = 22, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {name === 'overview' && <><Rect x={3} y={3} width={7} height={8} rx={1.5}/><Rect x={14} y={3} width={7} height={5} rx={1.5}/><Rect x={3} y={15} width={7} height={6} rx={1.5}/><Rect x={14} y={12} width={7} height={9} rx={1.5}/></>}
    {name === 'inbox' && <><Path d="M4 5h16l2 10v5H2v-5L4 5Z"/><Path d="M2 15h6l2 3h4l2-3h6"/></>}
    {name === 'clock' && <><Circle cx={12} cy={12} r={9}/><Path d="M12 7v5l3 2"/></>}
    {name === 'settings' && <><Path d="M4 6h16M4 12h16M4 18h16"/><Circle cx={9} cy={6} r={2} fill={color}/><Circle cx={16} cy={12} r={2} fill={color}/><Circle cx={8} cy={18} r={2} fill={color}/></>}
    {name === 'plus' && <Path d="M12 5v14M5 12h14"/>}
    {name === 'left' && <Path d="m14 6-6 6 6 6"/>}
    {name === 'right' && <Path d="m10 6 6 6-6 6"/>}
    {name === 'arrow' && <Path d="M5 12h14m-5-5 5 5-5 5"/>}
    {name === 'close' && <Path d="m6 6 12 12M18 6 6 18"/>}
    {name === 'check' && <Path d="m5 12 4 4L19 6"/>}
    {name === 'device' && <><Rect x={6} y={2} width={12} height={20} rx={3}/><Path d="M10 18h4"/></>}
    {name === 'receipt' && <><Path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><Path d="M9 8h6M9 12h6"/></>}
  </Svg>;
}
