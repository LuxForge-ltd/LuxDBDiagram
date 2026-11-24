/**
 * Applying and remembering the accent colour (LuxDBDiagram).
 *
 * Purpose: writes the chosen accent's CSS variables to the document and keeps the choice in this
 * browser's local storage.
 * Scope: a per-browser preference; it is not part of any diagram.
 */
import {
    accentCssVariables,
    DEFAULT_ACCENT,
    isAccentColor,
    type AccentColor,
} from './accent-palettes';

export const ACCENT_STORAGE_KEY = 'luxdb-accent-color';

/**
 * Sets the accent's CSS variables on an element (the document root by default).
 *
 * @param id Accent id.
 * @param root Element that carries the variables.
 */
export const applyAccent = (
    id: AccentColor,
    root: HTMLElement = document.documentElement
): void => {
    for (const [name, value] of Object.entries(accentCssVariables(id))) {
        root.style.setProperty(name, value);
    }
    root.dataset.accent = id;
};

/**
 * Reads the stored accent.
 *
 * @param storage Storage to read (local storage by default).
 * @returns The stored accent, or the default when none is stored, it is unknown, or storage
 * cannot be read.
 */
export const readStoredAccent = (
    storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()
): AccentColor => {
    try {
        const value = storage?.getItem(ACCENT_STORAGE_KEY);
        return isAccentColor(value) ? value : DEFAULT_ACCENT;
    } catch {
        return DEFAULT_ACCENT;
    }
};

/**
 * Stores the accent; failures (for example storage turned off) are ignored.
 *
 * @param id Accent id.
 * @param storage Storage to write (local storage by default).
 */
export const storeAccent = (
    id: AccentColor,
    storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()
): void => {
    try {
        storage?.setItem(ACCENT_STORAGE_KEY, id);
    } catch {
        // The accent still applies for this visit.
    }
};

function safeLocalStorage(): Storage | undefined {
    try {
        return typeof window === 'undefined' ? undefined : window.localStorage;
    } catch {
        return undefined;
    }
}
