/**
 * Accent colour provider (LuxDBDiagram).
 *
 * Purpose: holds the chosen accent, applies it to the document and remembers it in this browser.
 * Operational role: mounted once at the app root, so every page uses the accent.
 */
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { AccentColor } from '@/lib/accent/accent-palettes';
import {
    applyAccent,
    readStoredAccent,
    storeAccent,
} from '@/lib/accent/apply-accent';
import { AccentContext } from './accent-context';

export const AccentProvider: React.FC<React.PropsWithChildren> = ({
    children,
}) => {
    const [accent, setAccentState] = useState<AccentColor>(() =>
        readStoredAccent()
    );

    useLayoutEffect(() => {
        applyAccent(accent);
    }, [accent]);

    const setAccent = useCallback((next: AccentColor) => {
        storeAccent(next);
        setAccentState(next);
    }, []);

    const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent]);

    return (
        <AccentContext.Provider value={value}>
            {children}
        </AccentContext.Provider>
    );
};
