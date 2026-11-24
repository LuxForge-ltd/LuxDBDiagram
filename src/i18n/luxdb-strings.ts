/**
 * LuxDBDiagram UI strings (English).
 *
 * Purpose: text for the features LuxDBDiagram adds (Areas, Dupes, Floats, enhanced DBML).
 * Scope: English only. ChartDB's locale files are typed against its English file, so these
 * strings live in their own bundle, merged into the English resources at start-up. Other
 * languages fall back to English for them through i18next's `fallbackLng`.
 * Operational role: registered by `src/i18n/i18n.ts`; used as `t('luxdb.…')`.
 */
export const luxdbStrings = {
    luxdb: {
        common: {
            cancel: 'Cancel',
        },
        sidebar: {
            areas: 'Areas',
        },
        areas: {
            all_tables: 'All tables',
            new_area: 'New Area',
            back: 'Back to {{name}}',
            open_panel: 'Open the Areas panel',
            table_count_one: '{{count}} table',
            table_count_other: '{{count}} tables',
            empty_title: 'No Areas yet',
            empty_description:
                'An Area shows a chosen set of tables on its own canvas. A table can appear in several Areas; the schema itself never changes.',
            empty_area_title: 'This Area has no tables yet',
            empty_area_description:
                'Drag tables in from the table library in the Areas panel. Adding a table to an Area never copies or changes it.',
            delete_confirm_title: 'Delete the Area "{{name}}"?',
            delete_confirm_description:
                'Only the Area is deleted. Its tables stay in the schema and in any other Areas.',
            actions: {
                title: 'Area actions',
                rename: 'Rename',
                delete: 'Delete Area',
            },
        },
    },
};
