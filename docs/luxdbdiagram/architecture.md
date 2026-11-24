# LuxDBDiagram architecture

LuxDBDiagram (in the app, LuxDBDiag, "LuxForge Database Diagrams built on ChartDB") is LuxForge Ltd's
fork of [ChartDB](https://github.com/chartdb/chartdb), kept for producing LuxForge's own database
schemas. It extends ChartDB so that large schemas can be explored as several focused views instead of
one enormous diagram.

The guiding rule is **one schema, many views**: the database schema (tables, columns, indexes,
constraints, relationships) has exactly one definition. Everything LuxDBDiagram adds is presentation
metadata layered on top of it. When the diagram is saved as files (one per Area), each file holds a copy
of the definitions of the tables its Area shows; opening the files merges identical copies back into the
one definition.

## Concepts

| Concept | What it is | What it is not |
| --- | --- | --- |
| **Area** | A named, coloured view that shows a chosen set of tables, each at its own position. | A schema, a copy of tables, or ChartDB's on-canvas rectangles (those are now labelled **Groups** in the UI). |
| **Dupe** | The same canonical table shown in more than one Area. Each appearance has its own position and takes its Area's colour. | A second table definition. Editing the table changes it everywhere. |
| **Float** | A compact card standing in for an off-Area table that a visible table has relationships with. One card per off-Area table, one row per relationship. | A table, a duplicate definition or an extra foreign key. |

## ChartDB foundation (reused, not rewritten)

| ChartDB part | Location | Role in LuxDBDiagram |
| --- | --- | --- |
| Domain model (zod schemas) | `src/lib/domain/` | `Diagram` gains `areaViews`; tables and relationships are unchanged. |
| DBML import | `src/lib/dbml/dbml-import/dbml-import.ts` | Area blocks are extracted before ChartDB's existing pre-pass and `@dbml/core` parse. |
| DBML export | `src/lib/dbml/dbml-export/dbml-export.ts` | Standard export is untouched; enhanced export appends Area blocks. |
| DBML editor apply | `src/lib/dbml/apply-dbml/apply-dbml.ts` | Keeps table IDs stable by `schema.name`, so Area membership survives schema edits. |
| Canvas | `src/pages/editor-page/canvas/` | Table nodes, relationship edges and column handles are reused inside an Area. A node's ID stays the table ID, which is unique because a table appears at most once per Area. |
| Storage | `src/context/storage-context/` (Dexie / IndexedDB) | New `area_views` store, added as a new Dexie version. |
| Diagram JSON export/import | `src/lib/export-import-utils.ts`, dialogs | Carries `areaViews` with the rest of the diagram. |
| Colours | `src/lib/colors.ts`, `src/components/color-picker/` | Area colour palette and manual overrides. |

ChartDB's existing rectangle "Areas" (`Area`, `parentAreaId`) keep working unchanged in the **All tables**
view. Only their UI label changes, to **Groups**, so the two features don't share a name. In code the new
concept is called `AreaView` to avoid clashing with ChartDB's `Area` type.

## Data model

```ts
interface AreaView {
    id: string;
    name: string;            // unique within a diagram
    color: string;           // assigned from the Area palette, may be overridden
    order: number;           // tab order; drives Dupe numbering and Float navigation
    tables: { tableId: string; x: number; y: number }[];          // at most one per table
    floats?: { tableId: string; x: number; y: number; expanded?: boolean }[];
    floatFilter?: 'all' | 'outgoing'; // Outgoing when not set
    fileName?: string;       // the schema file the Area stands for (folder import)
    createdAt: number;
}
```

- Instances reference canonical table IDs; they never copy table definitions.
- A table's own `x`/`y` remain its position in the **All tables** view.
- Deleting a canonical table removes its instances from every Area. Deleting an Area never deletes tables.
- Float rows are not stored: they are derived from relationships every time. Only a card's position and
  expanded state are stored.

## Enhanced DBML

Ordinary DBML imports unchanged. Enhanced DBML adds `Area` blocks, which may sit in the schema file or in
a separate file that contains only Area blocks:

```dbml
Area "Users" [color: #8b5cf6] {
    users [x: 120, y: 80]
    user_auth_identities [x: 480, y: 80]
    float matches [x: 900, y: 300, expanded]
}

Area "Matches" {
    matches
    match_teams
    users
}
```

- Every setting is optional; a bare list of table names is a valid Area.
- Table references may be schema-qualified (`public.users`, `"public"."users"`).
- `float <table>` lines only store a Float card's position and expanded state.
- Import reports, with file and line: references to missing tables, a table listed twice in one Area,
  duplicate Area names, malformed blocks and conflicting table definitions across files.
- Export offers **DBML** (standard, no Area blocks) and **LuxDBDiagram DBML** (standard DBML followed by
  Area blocks).

### Multiple files

Several `.dbml` files can be imported together with **Open files…** above the DBML import editor. They
are merged into one schema before parsing, so references across files resolve; each file's part of the
merged text starts with a `// ==== file: <name> ====` line. A table or enum defined identically in two
files is kept once with a warning; two different definitions of the same table stop the import with both
locations reported. Errors in merged text name the original file and line, for example
`Can not find Table 'match_team_players' (finances.dbml, line 78)`. A file that holds only Area blocks
can be loaded alongside the schema files.

### A folder of files (one Area per file)

**Open folder…** opens a folder and lists its `.dbml` files, including those in subfolders. Edge and Chrome
use their folder picker; other browsers use a folder upload.

- **Which files are imported.** Each ticked file is imported. A file that repeats tables from at least two
  smaller files (a whole-schema copy kept beside per-domain files, such as GAP's `schema.dbml` and
  `gap_combined.dbml`) starts unticked.
- **Editing before import.** Clicking a file shows it in the import editor, where it can be edited.
  **Combined import** shows, read-only, exactly what will be imported.
- **Areas from files.** The import is the ticked files combined as above, followed by one generated
  `Area "<file name>" [file: "<path>"]` block per file listing the tables that file defines. A file that
  writes its own Area blocks gets none.
- **Shared and conflicting tables.** A table defined identically in several files is one table shown by
  each of those files' Areas. Different definitions stop the import, naming both files.
- **File names.** An Area keeps its file name (`fileName`, written as the `file:` setting), so the diagram
  remembers which file each Area stands for. The file setting must be a relative path inside the folder.

### A diagram as files (one file per Area)

**Actions → Export as → LuxDBDiag files (one per Area)…** writes the diagram as a folder
(`src/lib/areas/area-files.ts`):

- **Area files.** Each Area is one file: its stored `fileName`, or a safe name made from the Area name.
  The file holds every table the Area shows, every relationship that touches those tables (as `Ref`
  lines) and the enums.
  - Adding a table to an Area adds its definition to that file.
  - A table in two Areas is written, identically, in both.
  - Relationships between files appear identically in each file that holds one of their tables.
- **Unassigned tables.** Tables that no Area shows go to `unassigned.dbml`, so saving never drops a table.
- **The Areas file.** `luxdbdiag.areas.dbml` holds the Area blocks (colours, positions, Floats, Float
  filter), each with its `file:`, so the table files stay plain DBML that any DBML tool reads. When the
  folder is opened, a file named by an Area block's `file:` gets no generated Area.
- **Same text in every file.** Each file is written by ChartDB's exporter on a part of the diagram. Every
  relationship is given a fixed name first, and the exporter's position prefix (`fk_<n>_`) is removed, so
  the same relationship is the same `Ref` line in every file. Without that, the copies would not be
  recognised as repeats and DBML would reject them.
- **Writing.** Edge and Chrome write into a folder the user picks (File System Access API), replacing files
  of the same name and leaving other files alone, after a confirmation that lists the files. Other browsers
  download the files.
- **Viewing.** The DBML panel's **Show** picker shows any Area's file, read-only; the whole schema stays
  ChartDB's editable view.
- **Round trip.** Saving and reopening gives back the same tables, relationships, enums, Areas, file names
  and layout. Tested on a sample schema and on GAP's domain files.
- **Limits.** `//` comments are not kept (ChartDB's model has no place for them). Inline `ref:` settings
  are written as `Ref` lines. Editing a single file and applying it to the diagram is not supported yet:
  edit the whole schema or the canvas.

### Export

**Actions → Export as** offers:

- **DBML**: the schema exactly as ChartDB writes it, with no Area blocks, for any DBML tool.
- **LuxDBDiagram DBML (with Areas)**: the same schema followed by the Area blocks, including table
  positions, colours, Float positions and expanded state, and the Float filter.

Both are written by ChartDB's own exporter for the schema part. Anything the exporter has to leave out
(tables with no columns) is reported when exporting. Diagram JSON export also carries Areas, with table
references remapped like the rest of the diagram.

## Working with Areas (editor)

- **Area tabs** at the top of the canvas switch between **All tables** (ChartDB's own view, unchanged)
  and each Area. A back arrow returns to the previously viewed Area, and **+** creates an Area. The
  open Area is remembered per diagram in the browser, and each view keeps its own pan and zoom.
- The **Areas** panel (sidebar) lists Areas with their table counts. Areas can be opened, renamed
  (double-click), recoloured, reordered (drag handle) and deleted. Deleting an Area never deletes tables.
- With an Area open, the Areas panel also shows the **table library**: every table in the schema,
  searchable, with a tick for tables already in the Area and a count of the Areas each table is in.
  - Drag a table from the library onto the canvas to add it at that spot, or use its **+** button to
    add it below the Area's existing tables. A table already in the Area is never added twice; the
    user is told and the existing one is brought into view.
  - Drag a table node from the canvas onto the library to remove it from the Area. The library is
    outlined while a table is being dragged so the target is clear. Ordinary moves on the canvas
    never remove anything.
- The table menu has **Remove from Area** (inside an Area) and **Add to Area**, which lists every
  Area and **New Area**. With several tables selected, these apply to all of them, so an Area can be
  built from a selection in the "All tables" view.
- Inside an Area:
  - moving a table moves only that Area's copy of it;
  - **Delete** removes the table from the Area only; the table, its columns and relationships stay in
    the schema and in other Areas (use the table's menu to delete the table itself);
  - resizing a table changes its width in every view, because width belongs to the table;
  - the table filter and the "hide views" setting do not apply, because the Area is itself the
    selection of tables;
  - collapsed tables keep the columns that have a line in this Area visible.
- **Dupe markers.** A table shown in more than one Area has small numbered markers in its header,
  one per Area (`users [1] [2] [3]`). Numbers follow Area order, so they are the same in every view;
  the marker for the open Area is filled with its colour. Clicking a number opens that Area, centres
  the table and briefly highlights it. In the "All tables" view, every table that is in at least one
  Area shows its markers, as a way into the Areas.
- **Floats.** Every relationship with one end in the open Area and the other outside it is drawn as a
  dashed line from the shown column to a row on a Float card for the off-Area table. One card per
  off-Area table; one row per relationship.
  - Each row reads `referencing.column [glyph] referenced.column`: the column holding the foreign
    key first. The glyph is a miniature line with a crow's foot at both ends (exactly one, zero or
    one, one or many, zero or many), derived from the schema as described below.
  - A card shows three rows; "Show N more" expands it and "Show less" collapses it. Lines for hidden
    rows still reach the card, fainter, ending on its footer.
  - The card's border and badge use the colour and name of the first Area that shows the table.
  - Clicking a row opens that first Area, centres the table and highlights the column. If no Area
    shows the table, the row offers "Add it to this Area" and "Show it in All tables". Adding the
    table replaces its Float with ordinary relationship lines; removing it brings the Float back.
  - Cards can be moved; their position and expanded state are stored with the Area. Unplaced cards
    sit in columns to the right of the Area's tables, near the tables they connect to, wrapping into
    more columns rather than growing one very tall stack.
- **Float filter.** A widely referenced table (for example `users`, referenced by an `updated_by`
  column on almost every GAP table) would otherwise bring a Float for every table that references it.
  Areas therefore default to **Outgoing**: Floats only for tables the Area's columns point at, with the
  incoming references summarised on one "Referenced from outside this Area" card (one row and one line
  per referenced column, with the number of referencing tables). Nothing is hidden silently. The control
  at the top right of the canvas, or "Show these as Floats" on the summary card, switches an Area to
  **All**: a Float for every relationship that leaves the Area. Enhanced DBML writes only the
  non-default setting, `Area "Matches" [floats: all] { ... }`; `[floats: outgoing]` is accepted on
  import and means the same as no setting.
- Navigation (markers and Float rows) waits until the target Area is on screen
  before centring, because a table's node has the same id in every view.
- Undo and redo cover Area changes (create, delete, rename, recolour, reorder, membership, moves).
- Import shows Area problems (missing or ambiguous tables, repeats, unknown settings) and lost `//`
  comments as warnings before the import is confirmed.

## Rendering an Area

For the selected Area, a pure resolver (`src/lib/areas/`) works out:

1. the tables shown (the Area's instances);
2. relationships with both ends shown, drawn with ChartDB's normal relationship edge;
3. relationships with one end shown, grouped by the off-Area table into Float cards, one row per
   relationship, ordered deterministically;
4. crow's-foot cardinality for both ends of every Float row.

Cardinality comes from the schema: the declared ref type (one / many), the foreign-key column's
nullability, and whether it is unique or a primary key. The referenced end is "exactly one" when the
foreign key is `not null` and "zero or one" otherwise. The referencing end is "zero or one" for one-to-one
relationships and "zero or many" otherwise. "One or many" is drawn only when declared, which DBML cannot
express, so it is never guessed.

## Names and accent colour

The product's names live in `src/lib/brand.ts`: LuxDBDiag (short), LuxForge DB diagrams (the header's
brand mark) and LuxForge Database Diagrams built on ChartDB (page titles).

ChartDB styles its accent with Tailwind's `pink-*` classes, in about 75 places across its components.
`tailwind.config.js` maps that scale to the CSS variables `--lux-accent-50` to `--lux-accent-950`, so
those classes follow the chosen accent without editing ChartDB's components. `globals.css` holds the
default (purple). **Settings → Accent colour** applies another palette from `src/lib/accent/` at run
time and remembers it in the browser's local storage (`luxdb-accent-color`). It is a per-browser
preference, not part of any diagram.

## Known limitations inherited from ChartDB

- `//` line comments in DBML have no place in ChartDB's model and are not kept on import. Table and
  column `note:` values are kept. Import warns when comments will be lost.
- ChartDB's DBML export leaves out tables with no columns. Export warns when this happens.
- `TableGroup` blocks are still dropped on import, as in ChartDB.
- ChartDB imports a composite foreign key (`Ref: a.(x, y) > b.(x, y)`) as its first column pair
  only, so a Float row (and the ordinary relationship line) shows that pair.
- Columns of database views have no connection points in ChartDB, so a relationship on a view
  column has no Float line (the row is still on the Float card).
- "Duplicate" in ChartDB's Open dialog copies only a diagram's tables (not its relationships, notes,
  Groups or Areas). Use diagram JSON export and import to copy a diagram with its Areas.
- LuxDBDiagram's own text is English in every language (other languages fall back to it), and the
  "Groups" label replaces "Areas" for ChartDB's rectangles in the English UI only.
- Renaming a table in the DBML editor gives it a new identity in ChartDB, so it drops out of the Areas
  it was in; add it back from the table library.

## Acceptance criteria coverage

How each of the brief's required tests is covered. Unit tests live in `src/lib/areas/__tests__/`; GAP
tests run only with `LUXDB_GAP_SCHEMA_DIR` set; "browser" means checked by hand in the running editor on
the GAP schema.

| # | Criterion | Covered by |
| --- | --- | --- |
| 1 | Standard DBML imports without extensions | ChartDB's existing DBML import tests (unchanged, all passing); `round-trip.test.ts` |
| 2 | Enhanced DBML with multiple Areas | `area-dbml.test.ts`; GAP test; browser |
| 3 | Several DBML files resolve to one schema | `multi-file-dbml.test.ts`; GAP test (domain files); browser (10 files) |
| 4 | A table appears in several Areas | `area-dbml.test.ts`; GAP test; browser |
| 5 | A table cannot appear twice in one Area | `area-view-ops.test.ts`, `area-dbml.test.ts`, `area-layout.test.ts`; browser (library, menu) |
| 6 | Area colours applied correctly | `resolve-area-view.test.ts`, `area-view-ops.test.ts`; browser |
| 7 | Dragging a table into an Area adds it | browser (library drag onto the canvas) |
| 8 | Removing an instance keeps the table | `area-view-ops.test.ts`, `resolve-area-view.test.ts`; browser (Delete key, drag back, menu) |
| 9 | Same-Area relationships render normally | `resolve-area-view.test.ts`; browser |
| 10 | Cross-Area relationships render as Floats | `floats.test.ts`; GAP test; browser |
| 11 | Float rows show source, target and two-ended glyphs | `floats.test.ts` (cardinality); browser (glyphs) |
| 12 | Lines connect real columns to the right Float rows | browser (row handles per relationship) |
| 13 | A 20-relationship Float shows three rows and expands | `floats.test.ts`; browser |
| 14 | Clicking a Float row reaches the destination column | browser (`transactions.match_id` → `matches.match_id`) |
| 15 | Dupe numbers navigate correctly | `resolve-area-view.test.ts` (numbering); browser |
| 16 | Canonical changes show in every Area | `resolve-area-view.test.ts`; `round-trip.test.ts` |
| 17 | Area changes update Floats automatically | `floats.test.ts`; browser (adding `teams` replaced its Float) |
| 18 | Layouts and colours survive reopening | browser (reload); `round-trip.test.ts` (JSON and DBML) |
| 19 | Standard DBML export is ordinary DBML | `round-trip.test.ts` |
| 20 | Enhanced export and reimport keep the metadata | `round-trip.test.ts`; GAP round-trip test |
| — | Malformed files and missing tables | `area-dbml.test.ts`, `round-trip.test.ts`, `multi-file-dbml.test.ts` |

## Delivery

The work is delivered as phases, each on its own branch and pull request into `Dev`. `PHASES.md` records
the plan, the approvals and each phase's branch, version and pull request. The hosted copy and how it
is built, deployed and published are described in [deployment.md](deployment.md).
