# LuxDBDiagram architecture

LuxDBDiagram is LuxForge Ltd's fork of [ChartDB](https://github.com/chartdb/chartdb). It extends ChartDB
so that large schemas can be explored as several focused views instead of one enormous diagram.

The guiding rule is **one schema, many views**: the database schema (tables, columns, indexes,
constraints, relationships) has exactly one definition. Everything LuxDBDiagram adds is presentation
metadata layered on top of it.

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

Several `.dbml` files can be imported together. They are merged into one schema before parsing, so
references across files resolve. A table defined identically in two files is kept once with a warning;
two different definitions of the same table stop the import with both locations reported.

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

## Known limitations inherited from ChartDB

- `//` line comments in DBML have no place in ChartDB's model and are not kept on import. Table and
  column `note:` values are kept. Import warns when comments will be lost.
- ChartDB's DBML export leaves out tables with no columns. Export warns when this happens.
- `TableGroup` blocks are still dropped on import, as in ChartDB.

## Delivery

The work is delivered as phases, each on its own branch and pull request into `Dev`. `PHASES.md` records
the plan, the approvals and each phase's branch, version and pull request.
