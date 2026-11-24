import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    ACCENT_OPTIONS,
    ACCENT_SHADES,
    DEFAULT_ACCENT,
    accentCssVariables,
    getAccentOption,
    hexToRgbChannels,
    isAccentColor,
} from '../accent-palettes';
import {
    ACCENT_STORAGE_KEY,
    applyAccent,
    readStoredAccent,
    storeAccent,
} from '../apply-accent';

describe('accent palettes', () => {
    it('offers purple by default, keeps ChartDB pink, and has unique ids', () => {
        expect(DEFAULT_ACCENT).toBe('purple');
        const ids = ACCENT_OPTIONS.map((option) => option.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('pink');
        expect(ids.length).toBeGreaterThanOrEqual(8);
    });

    it('gives every accent a valid colour for every shade', () => {
        for (const option of ACCENT_OPTIONS) {
            for (const shade of ACCENT_SHADES) {
                expect(option.shades[shade]).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });

    it('converts hex to Tailwind channel form', () => {
        expect(hexToRgbChannels('#9333ea')).toBe('147 51 234');
        expect(hexToRgbChannels('#000000')).toBe('0 0 0');
    });

    it('recognises accent ids and falls back to the default option', () => {
        expect(isAccentColor('teal')).toBe(true);
        expect(isAccentColor('magenta')).toBe(false);
        expect(isAccentColor(undefined)).toBe(false);
        expect(
            getAccentOption('nope' as unknown as typeof DEFAULT_ACCENT).id
        ).toBe(DEFAULT_ACCENT);
    });

    it('matches the purple defaults written in globals.css', () => {
        const css = readFileSync(
            resolve(__dirname, '../../../globals.css'),
            'utf8'
        );
        for (const [name, value] of Object.entries(
            accentCssVariables('purple')
        )) {
            expect(css).toContain(`${name}: ${value};`);
        }
    });
});

describe('applying and storing the accent', () => {
    it('writes every shade variable to the element', () => {
        const element = document.createElement('div');
        applyAccent('teal', element);
        expect(element.style.getPropertyValue('--lux-accent-600')).toBe(
            hexToRgbChannels(getAccentOption('teal').shades[600])
        );
        expect(element.dataset.accent).toBe('teal');
        for (const shade of ACCENT_SHADES) {
            expect(
                element.style.getPropertyValue(`--lux-accent-${shade}`)
            ).not.toBe('');
        }
    });

    it('reads a stored accent and ignores unknown or unreadable values', () => {
        const store = new Map<string, string>();
        const storage = { getItem: (key: string) => store.get(key) ?? null };
        expect(readStoredAccent(storage)).toBe(DEFAULT_ACCENT);
        store.set(ACCENT_STORAGE_KEY, 'blue');
        expect(readStoredAccent(storage)).toBe('blue');
        store.set(ACCENT_STORAGE_KEY, 'magenta');
        expect(readStoredAccent(storage)).toBe(DEFAULT_ACCENT);
        const broken = {
            getItem: () => {
                throw new Error('blocked');
            },
        };
        expect(readStoredAccent(broken)).toBe(DEFAULT_ACCENT);
    });

    it('stores the accent and survives storage that refuses writes', () => {
        const store = new Map<string, string>();
        storeAccent('amber', {
            setItem: (key: string, value: string) => store.set(key, value),
        });
        expect(store.get(ACCENT_STORAGE_KEY)).toBe('amber');
        expect(() =>
            storeAccent('amber', {
                setItem: () => {
                    throw new Error('quota');
                },
            })
        ).not.toThrow();
    });
});
