/**
 * Accent colours (LuxDBDiagram).
 *
 * Purpose: the colour ranges the user can choose as the app's accent, and the CSS variables that
 * carry the chosen one.
 * Scope: ChartDB styles its accent with Tailwind's `pink-*` classes. `tailwind.config.js` maps that
 * scale to the `--lux-accent-<shade>` variables, so every existing pink class follows the accent
 * chosen here without editing ChartDB's components.
 * Operational role: applied to the document root by `apply-accent.ts`; chosen in Settings.
 */

export const ACCENT_SHADES = [
    50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
] as const;

export type AccentShade = (typeof ACCENT_SHADES)[number];

export type AccentColor =
    | 'purple'
    | 'violet'
    | 'indigo'
    | 'blue'
    | 'teal'
    | 'green'
    | 'amber'
    | 'orange'
    | 'red'
    | 'pink';

export interface AccentOption {
    id: AccentColor;
    /** Key of the option's label in `luxdb.settings.accents`. */
    labelKey: string;
    /** Hex colour for each shade, from Tailwind's palette of the same name. */
    shades: Record<AccentShade, string>;
}

const palette = (hex: string[]): Record<AccentShade, string> =>
    Object.fromEntries(
        ACCENT_SHADES.map((shade, index) => [shade, hex[index]])
    ) as Record<AccentShade, string>;

/** The accents offered, in menu order. Purple is LuxDBDiag's default; pink is ChartDB's. */
export const ACCENT_OPTIONS: AccentOption[] = [
    {
        id: 'purple',
        labelKey: 'purple',
        shades: palette([
            '#faf5ff',
            '#f3e8ff',
            '#e9d5ff',
            '#d8b4fe',
            '#c084fc',
            '#a855f7',
            '#9333ea',
            '#7e22ce',
            '#6b21a8',
            '#581c87',
            '#3b0764',
        ]),
    },
    {
        id: 'violet',
        labelKey: 'violet',
        shades: palette([
            '#f5f3ff',
            '#ede9fe',
            '#ddd6fe',
            '#c4b5fd',
            '#a78bfa',
            '#8b5cf6',
            '#7c3aed',
            '#6d28d9',
            '#5b21b6',
            '#4c1d95',
            '#2e1065',
        ]),
    },
    {
        id: 'indigo',
        labelKey: 'indigo',
        shades: palette([
            '#eef2ff',
            '#e0e7ff',
            '#c7d2fe',
            '#a5b4fc',
            '#818cf8',
            '#6366f1',
            '#4f46e5',
            '#4338ca',
            '#3730a3',
            '#312e81',
            '#1e1b4b',
        ]),
    },
    {
        id: 'blue',
        labelKey: 'blue',
        shades: palette([
            '#eff6ff',
            '#dbeafe',
            '#bfdbfe',
            '#93c5fd',
            '#60a5fa',
            '#3b82f6',
            '#2563eb',
            '#1d4ed8',
            '#1e40af',
            '#1e3a8a',
            '#172554',
        ]),
    },
    {
        id: 'teal',
        labelKey: 'teal',
        shades: palette([
            '#f0fdfa',
            '#ccfbf1',
            '#99f6e4',
            '#5eead4',
            '#2dd4bf',
            '#14b8a6',
            '#0d9488',
            '#0f766e',
            '#115e59',
            '#134e4a',
            '#042f2e',
        ]),
    },
    {
        id: 'green',
        labelKey: 'green',
        shades: palette([
            '#ecfdf5',
            '#d1fae5',
            '#a7f3d0',
            '#6ee7b7',
            '#34d399',
            '#10b981',
            '#059669',
            '#047857',
            '#065f46',
            '#064e3b',
            '#022c22',
        ]),
    },
    {
        id: 'amber',
        labelKey: 'amber',
        shades: palette([
            '#fffbeb',
            '#fef3c7',
            '#fde68a',
            '#fcd34d',
            '#fbbf24',
            '#f59e0b',
            '#d97706',
            '#b45309',
            '#92400e',
            '#78350f',
            '#451a03',
        ]),
    },
    {
        id: 'orange',
        labelKey: 'orange',
        shades: palette([
            '#fff7ed',
            '#ffedd5',
            '#fed7aa',
            '#fdba74',
            '#fb923c',
            '#f97316',
            '#ea580c',
            '#c2410c',
            '#9a3412',
            '#7c2d12',
            '#431407',
        ]),
    },
    {
        id: 'red',
        labelKey: 'red',
        shades: palette([
            '#fef2f2',
            '#fee2e2',
            '#fecaca',
            '#fca5a5',
            '#f87171',
            '#ef4444',
            '#dc2626',
            '#b91c1c',
            '#991b1b',
            '#7f1d1d',
            '#450a0a',
        ]),
    },
    {
        id: 'pink',
        labelKey: 'pink',
        shades: palette([
            '#fdf2f8',
            '#fce7f3',
            '#fbcfe8',
            '#f9a8d4',
            '#f472b6',
            '#ec4899',
            '#db2777',
            '#be185d',
            '#9d174d',
            '#831843',
            '#500724',
        ]),
    },
];

/** The accent used when none has been chosen. */
export const DEFAULT_ACCENT: AccentColor = 'purple';

/**
 * Whether a value names one of the offered accents.
 *
 * @param value Any value, for example one read from storage.
 * @returns True when it is an accent id.
 */
export const isAccentColor = (value: unknown): value is AccentColor =>
    typeof value === 'string' &&
    ACCENT_OPTIONS.some((option) => option.id === value);

/**
 * Finds an accent option, falling back to the default.
 *
 * @param id Accent id.
 * @returns The option for that id, or the default accent's option.
 */
export const getAccentOption = (id: AccentColor): AccentOption =>
    ACCENT_OPTIONS.find((option) => option.id === id) ??
    ACCENT_OPTIONS.find((option) => option.id === DEFAULT_ACCENT)!;

/**
 * Converts `#rrggbb` to the space-separated channels Tailwind's `<alpha-value>` form needs.
 *
 * @param hex Colour as `#rrggbb`.
 * @returns Channels such as `"147 51 234"`.
 */
export const hexToRgbChannels = (hex: string): string => {
    const value = hex.replace('#', '');
    return [0, 2, 4]
        .map((offset) => parseInt(value.slice(offset, offset + 2), 16))
        .join(' ');
};

/**
 * The CSS variables that carry an accent.
 *
 * @param id Accent id.
 * @returns A map from `--lux-accent-<shade>` to its RGB channels.
 */
export const accentCssVariables = (id: AccentColor): Record<string, string> => {
    const option = getAccentOption(id);
    return Object.fromEntries(
        ACCENT_SHADES.map((shade) => [
            `--lux-accent-${shade}`,
            hexToRgbChannels(option.shades[shade]),
        ])
    );
};
