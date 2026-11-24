/**
 * Accent colour context (LuxDBDiagram).
 *
 * Purpose: shares the chosen accent colour and lets Settings change it.
 */
import { createContext } from 'react';
import { emptyFn } from '@/lib/utils';
import { DEFAULT_ACCENT, type AccentColor } from '@/lib/accent/accent-palettes';

export interface AccentContext {
    accent: AccentColor;
    setAccent: (accent: AccentColor) => void;
}

export const AccentContext = createContext<AccentContext>({
    accent: DEFAULT_ACCENT,
    setAccent: emptyFn,
});
