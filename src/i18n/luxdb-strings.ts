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
        files: {
            save_files: 'LuxDBDiag files (one per Area)…',
            save_title: 'Save the diagram as files',
            save_description:
                '{{count}} files will be written: one per Area, holding the tables that Area shows ({{files}}). Files with the same names in the folder are replaced; other files are left alone. The files are written by the DBML exporter, so // comments are not kept and inline ref: settings become Ref lines.',
            choose_folder: 'Choose folder…',
            download_files: 'Download files',
            saved_title_one: '{{count}} file saved to {{folder}}',
            saved_title_other: '{{count}} files saved to {{folder}}',
            downloaded_title: 'Files downloaded',
            downloaded_description:
                'This browser cannot write to a folder, so each file was downloaded. Edge and Chrome can save straight into a folder.',
            save_failed: 'The files could not be saved',
            nothing_to_save: 'The diagram has no tables to save',
            view_label: 'Show',
            whole_schema: 'Whole schema (editable)',
            file_tables_one: '{{count}} table',
            file_tables_other: '{{count}} tables',
            file_view_hint:
                'Built from the Area: every table it shows, and the relationships that touch them. Edit the schema in the whole-schema view or on the canvas.',
            areas_file: 'Areas and layout',
            unassigned_file: 'Tables in no Area',
        },
        github: {
            open_repository: 'Open repository…',
            open_repository_title:
                'Open a folder of .dbml files from a GitHub repository. Each ticked file becomes an Area; changes can later be saved back to a working branch with a pull request.',
            checking: 'Checking GitHub…',
            unavailable: 'The GitHub service is not available.',
            not_configured: 'GitHub sign-in is not set up on this server yet.',
            missing: 'Missing settings: {{settings}}',
            sign_in_hint:
                'Sign in with GitHub to open repositories the LuxDBDiag GitHub App is installed on.',
            sign_in: 'Sign in with GitHub',
            signing_in: 'Waiting for the GitHub sign-in window…',
            signed_in_as: 'Signed in to GitHub as {{login}}',
            sign_out: 'Sign out',
            no_repositories:
                'The LuxDBDiag GitHub App is not installed on any repository you can open.',
            repository: 'Repository',
            choose_repository: 'Choose a repository',
            read_only:
                'You can read this repository but not push to it, so changes cannot be saved back.',
            install_more: 'Install the App on more repositories',
            branch: 'Branch',
            folder: 'Folder (blank for the whole repository)',
            open: 'Open folder',
            folder_empty:
                'No .dbml files in that folder (subfolders up to four deep are searched).',
            save: {
                menu: 'Save to repository…',
                title: 'Save to repository',
                description:
                    'Changed files of {{repo}} ({{folder}}) are committed to a working branch, for a pull request into {{base}}. Unchanged files are left exactly as they are.',
                analysis_failed: 'The files could not be worked out: {{error}}',
                nothing_to_save:
                    "Nothing to save: the diagram's files match the repository.",
                include: 'Commit {{file}}',
                new: 'new',
                changed: 'changed',
                unchanged_one: '{{count}} unchanged file is left as it is.',
                unchanged_other:
                    '{{count}} unchanged files are left as they are.',
                removed:
                    'No Area writes {{files}} any more. It is not deleted from the repository.',
                untouched:
                    'Not updated, because they were not imported (such as combined copies): {{files}}. They may now be out of date.',
                diff_new: 'New file',
                diff_github: 'On GitHub ({{branch}})',
                diff_mine: 'From this diagram',
                branch: 'Working branch',
                branch_invalid:
                    'Use a branch name starting {{prefix}}, with no spaces.',
                message: 'Commit message',
                exporter_note:
                    'Changed files are rewritten by the DBML exporter: // comments in them are not kept, and inline ref: settings become Ref lines.',
                committed_one: 'Committed {{count}} file to {{branch}}.',
                committed_other: 'Committed {{count}} files to {{branch}}.',
                already_there:
                    'GitHub already has these files on {{branch}}; nothing was committed.',
                conflict_one:
                    'Not committed: {{files}} changed on GitHub since this diagram read it. Open the repository again from {{branch}}, or from the branch it came from, to pick up that change.',
                conflict_other:
                    'Not committed: {{files}} changed on GitHub since this diagram read them. Open the repository again from {{branch}}, or from the branch it came from, to pick up those changes.',
                branch_moved:
                    'Not committed: {{branch}} moved on GitHub meanwhile. Try again.',
                signed_out: 'Sign in to GitHub to save.',
                view_pull_request: 'View the pull request',
                open_pull_request: 'Open pull request into {{base}}',
                pull_request_title:
                    'Schema changes from LuxDBDiag ({{folder}})',
                close: 'Close',
                commit_one: 'Commit {{count}} file',
                commit_other: 'Commit {{count}} files',
            },
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
