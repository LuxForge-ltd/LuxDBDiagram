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
        membership: {
            remove_from_area: 'Remove from Area',
            add_to_area: 'Add to Area',
            new_area_with_tables: 'New Area',
            already_in_area_title: 'Already in {{area}}',
            already_in_area_description:
                '{{tables}} already appears in this Area. A table appears at most once per Area.',
        },
        import: {
            open_files: 'Open files…',
            open_files_title:
                'Open one or more .dbml files. Several files are merged into one schema, so references between them resolve.',
            files_merged_title_one: '{{count}} file loaded',
            files_merged_title_other: '{{count}} files merged into one schema',
            files_merged_description:
                'References between the files are resolved when the schema is imported.',
            files_conflict_title: 'The files define a table differently',
            open_folder: 'Open folder…',
            open_folder_title:
                'Open a folder of .dbml files. Each ticked file becomes an Area showing the tables it defines; pick a file to view or edit it here before importing.',
            folder_empty_title: 'No .dbml files in that folder',
            folder_empty_description:
                'Choose a folder that holds .dbml files (subfolders are searched too).',
            folder_read_failed: 'The folder could not be read',
            folder_combined: 'Combined import',
            folder_combined_hint:
                'What will be imported: the ticked files, then one Area per file. Read-only; edit a file instead.',
            folder_close: 'Close folder',
            folder_tables_one: '{{count}} table',
            folder_tables_other: '{{count}} tables',
            folder_looks_combined:
                'Looks like a combined copy of other files, so it starts unticked',
            folder_defines_areas: 'Writes its own Area blocks',
            folder_areas_one: '{{count}} Area',
            folder_areas_other: '{{count}} Areas',
            folder_shared_one:
                '{{count}} table is in more than one file; each of those files shows it.',
            folder_shared_other:
                '{{count}} tables are in more than one file; each of those files shows them.',
            folder_include: 'Include {{file}}',
        },
        export: {
            enhanced_dbml: 'LuxDBDiagram DBML (with Areas)',
            warnings_title: 'Exported, with omissions',
            failed_title: 'Could not export DBML',
        },
        floats: {
            reference_count_one: '{{count}} ref',
            reference_count_other: '{{count}} refs',
            show_more: 'Show {{count}} more',
            show_less: 'Show less',
            home_area: 'First shown in {{area}}',
            no_area: 'Not in any Area',
            no_area_short: 'No Area',
            row_title: '{{from}} → {{to}}. Click to go to {{table}}.',
            not_in_area: '"{{table}}" is not in any Area yet.',
            add_here: 'Add it to this Area',
            show_in_all_tables: 'Show it in All tables',
            incoming_title: 'Referenced from outside this Area',
            referenced_by_one: '← {{count}} table',
            referenced_by_other: '← {{count}} tables',
            and_more: 'and {{count}} more',
            show_incoming: 'Show these as Floats',
            count_one: '{{count}} Float',
            count_other: '{{count}} Floats',
            controls_title:
                'Floats stand in for tables outside this Area that its tables are related to',
            filter_all: 'All',
            filter_all_title:
                'Show a Float for every relationship that leaves this Area',
            filter_outgoing: 'Outgoing',
            filter_outgoing_title_one:
                'Show Floats only for tables this Area refers to; the {{count}} reference coming in is summarised on one card',
            filter_outgoing_title_other:
                'Show Floats only for tables this Area refers to; the {{count}} references coming in are summarised on one card',
        },
        dupes: {
            go_to: 'Show it in {{area}} [{{number}}]',
            current: 'Shown here, in {{area}}',
        },
        library: {
            title: 'Table library',
            search: 'Search tables…',
            in_area: 'In this Area',
            in_area_count_one: '{{count}} of {{total}} in this Area',
            in_area_count_other: '{{count}} of {{total}} in this Area',
            area_count_one: 'In {{count}} Area',
            area_count_other: 'In {{count}} Areas',
            add: 'Add to {{area}}',
            no_results: 'No tables match your search.',
            drop_to_remove_one:
                'Drop here to remove this table from {{area}} (it stays in the schema)',
            drop_to_remove_other:
                'Drop here to remove {{count}} tables from {{area}} (they stay in the schema)',
        },
        settings: {
            settings: 'Settings',
            accent_colour: 'Accent colour',
            accent_hint: 'Saved in this browser',
            accents: {
                purple: 'Purple',
                violet: 'Violet',
                indigo: 'Indigo',
                blue: 'Blue',
                teal: 'Teal',
                green: 'Green',
                amber: 'Amber',
                orange: 'Orange',
                red: 'Red',
                pink: 'Pink (ChartDB)',
            },
        },
    },
};
