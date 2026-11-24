/**
 * Floats (LuxDBDiagram).
 *
 * Purpose: turns relationships that cross an Area's boundary into Float cards. A Float is a
 * compact stand-in for one off-Area table; each of its rows is one relationship between that
 * table and a table shown in the Area.
 * Scope: pure and deterministic. Floats are derived from the canonical relationships every
 * time; nothing here creates, copies or changes a table, column or relationship.
 * Operational role: the canvas draws a Float node per card and a line from each shown
 * column to its Float row.
 *
 * Direction. Each row reads "referencing column -> referenced column": the column holding the
 * foreign key first, the column it points at second (`team_player.updated_by -> users.user_id`).
 * ChartDB stores relationships as source/target with a cardinality at each end; the foreign
 * key sits on the "many" end, or on the target when both ends match (ChartDB's own rule).
 *
 * Cardinality (crow's foot, at both ends), from schema facts only:
 * - Referenced end: at most one when that end is declared "one". At least one when the
 *   foreign-key column is NOT NULL (every row must point somewhere), otherwise zero.
 * - Referencing end: at most one when declared "one" or when the foreign-key column is unique
 *   (unique flag, single-column primary key or single-column unique index); otherwise many.
 *   Its minimum is zero: a schema cannot require a referenced row to have referencing rows.
 * - "One or many" is therefore never derived; DBML cannot declare it.
 */
import type { DBField } from '@/lib/domain/db-field';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import type { DBTable } from '@/lib/domain/db-table';
import type {
    AreaFloatFilter,
    AreaViewTableInstance,
} from '@/lib/domain/area-view';
import { effectiveFloatFilter } from '@/lib/domain/area-view';

/** Crow's foot symbol at one end of a relationship. */
export type CrowFootEnd =
    | 'exactly_one'
    | 'zero_or_one'
    | 'one_or_many'
    | 'zero_or_many';

/** One end of a Float row: a table and column, with the cardinality drawn at that end. */
export interface FloatRowEnd {
    tableId: string;
    fieldId: string;
    tableName: string;
    fieldName: string;
    cardinality: CrowFootEnd;
}

export interface FloatRow {
    relationshipId: string;
    /** The column holding the foreign key. */
    referencing: FloatRowEnd;
    /** The column the foreign key points at. */
    referenced: FloatRowEnd;
    /** The end shown in the Area (a table node on the canvas). */
    local: FloatRowEnd;
    /** The end on the Float's own (off-Area) table. */
    external: FloatRowEnd;
    /** Whether the shown table holds the foreign key (outgoing) or is referenced (incoming). */
    direction: 'outgoing' | 'incoming';
}

export interface FloatCard {
    /** The off-Area table this Float stands in for. */
    tableId: string;
    tableName: string;
    schema?: string | null;
    rows: FloatRow[];
}

/** Rows shown before a Float is expanded. */
export const FLOAT_COLLAPSED_ROWS = 3;

/** Whether a column is unique on its own (so a foreign key on it allows at most one row). */
export const isFieldUnique = (table: DBTable, field: DBField): boolean => {
    if (field.unique) return true;
    const primaryKeyFields = table.fields.filter((f) => f.primaryKey);
    if (field.primaryKey && primaryKeyFields.length === 1) return true;
    return table.indexes.some(
        (index) =>
            index.unique &&
            index.fieldIds.length === 1 &&
            index.fieldIds[0] === field.id
    );
};

/** Which end of a ChartDB relationship holds the foreign key. */
const foreignKeyEnd = (relationship: DBRelationship): 'source' | 'target' =>
    relationship.sourceCardinality === 'many' &&
    relationship.targetCardinality === 'one'
        ? 'source'
        : 'target';

/**
 * Works out the crow's foot at both ends of a relationship.
 *
 * @param input The relationship plus the tables and columns at each end.
 * @returns The symbol for the referencing (foreign key) end and the referenced end.
 */
export const deriveCrowFeet = ({
    relationship,
    referencingTable,
    referencingField,
}: {
    relationship: DBRelationship;
    referencingTable: DBTable;
    referencingField: DBField;
}): { referencing: CrowFootEnd; referenced: CrowFootEnd } => {
    const fkIsSource = foreignKeyEnd(relationship) === 'source';
    const referencingDeclared = fkIsSource
        ? relationship.sourceCardinality
        : relationship.targetCardinality;
    const referencedDeclared = fkIsSource
        ? relationship.targetCardinality
        : relationship.sourceCardinality;

    const referencingAtMostOne =
        referencingDeclared === 'one' ||
        (referencedDeclared === 'one' &&
            isFieldUnique(referencingTable, referencingField));
    const referenced: CrowFootEnd =
        referencedDeclared === 'one'
            ? referencingField.nullable
                ? 'zero_or_one'
                : 'exactly_one'
            : 'zero_or_many';

    return {
        referencing: referencingAtMostOne ? 'zero_or_one' : 'zero_or_many',
        referenced,
    };
};

/** Builds a row end, or null when the table or column no longer exists. */
const rowEnd = (
    tablesById: Map<string, DBTable>,
    tableId: string,
    fieldId: string,
    cardinality: CrowFootEnd
): (FloatRowEnd & { table: DBTable; field: DBField }) | null => {
    const table = tablesById.get(tableId);
    const field = table?.fields.find((f) => f.id === fieldId);
    if (!table || !field) return null;
    return {
        tableId,
        fieldId,
        tableName: table.name,
        fieldName: field.name,
        cardinality,
        table,
        field,
    };
};

/** Drops the lookup-only properties from a row end. */
const publicEnd = ({
    tableId,
    fieldId,
    tableName,
    fieldName,
    cardinality,
}: FloatRowEnd): FloatRowEnd => ({
    tableId,
    fieldId,
    tableName,
    fieldName,
    cardinality,
});

/**
 * Groups an Area's cross-boundary relationships into Float cards.
 *
 * Cards are ordered by table name (then schema, then id); rows by the shown table's place
 * in the Area, then by its column order, then by relationship id. The same input always
 * gives the same cards in the same order.
 *
 * @param input Relationships with exactly one end in the Area, the canonical tables, and
 *        the Area's instances (for ordering).
 * @returns One card per off-Area table.
 */
export const resolveFloatCards = ({
    crossRelationships,
    tables,
    instances,
}: {
    crossRelationships: readonly DBRelationship[];
    tables: readonly DBTable[];
    instances: readonly AreaViewTableInstance[];
}): FloatCard[] => {
    const tablesById = new Map(tables.map((table) => [table.id, table]));
    const shown = new Set(instances.map((instance) => instance.tableId));
    const instanceOrder = new Map(
        instances.map((instance, index) => [instance.tableId, index])
    );
    const cards = new Map<string, FloatCard>();

    for (const relationship of crossRelationships) {
        const fkIsSource = foreignKeyEnd(relationship) === 'source';
        const referencingIds = fkIsSource
            ? [relationship.sourceTableId, relationship.sourceFieldId]
            : [relationship.targetTableId, relationship.targetFieldId];
        const referencedIds = fkIsSource
            ? [relationship.targetTableId, relationship.targetFieldId]
            : [relationship.sourceTableId, relationship.sourceFieldId];

        const referencingProbe = rowEnd(
            tablesById,
            referencingIds[0],
            referencingIds[1],
            'zero_or_many'
        );
        const referencedProbe = rowEnd(
            tablesById,
            referencedIds[0],
            referencedIds[1],
            'zero_or_one'
        );
        if (!referencingProbe || !referencedProbe) continue;

        const feet = deriveCrowFeet({
            relationship,
            referencingTable: referencingProbe.table,
            referencingField: referencingProbe.field,
        });
        const referencing = publicEnd({
            ...referencingProbe,
            cardinality: feet.referencing,
        });
        const referenced = publicEnd({
            ...referencedProbe,
            cardinality: feet.referenced,
        });

        const localIsReferencing = shown.has(referencing.tableId);
        if (localIsReferencing === shown.has(referenced.tableId)) continue; // not a cross row

        const local = localIsReferencing ? referencing : referenced;
        const external = localIsReferencing ? referenced : referencing;
        const externalTable = tablesById.get(external.tableId)!;

        const card = cards.get(external.tableId) ?? {
            tableId: external.tableId,
            tableName: externalTable.name,
            schema: externalTable.schema,
            rows: [],
        };
        card.rows.push({
            relationshipId: relationship.id,
            referencing,
            referenced,
            local,
            external,
            direction: localIsReferencing ? 'outgoing' : 'incoming',
        });
        cards.set(external.tableId, card);
    }

    const fieldIndex = (end: FloatRowEnd) =>
        tablesById
            .get(end.tableId)
            ?.fields.findIndex((field) => field.id === end.fieldId) ?? 0;

    return [...cards.values()]
        .map((card) => ({
            ...card,
            rows: [...card.rows].sort(
                (a, b) =>
                    (instanceOrder.get(a.local.tableId) ?? 0) -
                        (instanceOrder.get(b.local.tableId) ?? 0) ||
                    fieldIndex(a.local) - fieldIndex(b.local) ||
                    a.relationshipId.localeCompare(b.relationshipId)
            ),
        }))
        .sort(
            (a, b) =>
                a.tableName.localeCompare(b.tableName) ||
                (a.schema ?? '').localeCompare(b.schema ?? '') ||
                a.tableId.localeCompare(b.tableId)
        );
};

/** Width of a Float card on the canvas. */
export const FLOAT_WIDTH = 340;
const FLOAT_HEADER_HEIGHT = 34;
const FLOAT_ROW_HEIGHT = 26;
const FLOAT_FOOTER_HEIGHT = 26;
const FLOAT_GAP = 24;
const FLOAT_MARGIN = 160;

/** Estimated height of a Float card, for automatic placement. */
export const estimateFloatHeight = (rowCount: number, expanded: boolean) =>
    FLOAT_HEADER_HEIGHT +
    Math.min(rowCount, expanded ? rowCount : FLOAT_COLLAPSED_ROWS) *
        FLOAT_ROW_HEIGHT +
    (rowCount > FLOAT_COLLAPSED_ROWS ? FLOAT_FOOTER_HEIGHT : 0);

/** Gap between Float columns when cards wrap into more than one column. */
const FLOAT_COLUMN_GAP = 60;
/** Minimum height of a Float column before cards wrap into the next one. */
const FLOAT_MIN_COLUMN_HEIGHT = 900;

/** Something placed in the Float columns: a card id, its rows' shown tables and its height. */
export interface FloatPlacementItem {
    id: string;
    name: string;
    localTableIds: string[];
    height: number;
}

/**
 * Places Float cards (and the incoming-references summary) that have no stored position.
 *
 * Cards go in columns to the right of the Area's tables, each as near as possible to the
 * average height of the shown tables it connects to, stacked so they never overlap. When a
 * column grows taller than the Area (or 900 units), placement wraps into a new column, so a
 * widely referenced table produces a compact block rather than one very tall stack.
 * Items with a stored position keep it.
 *
 * @param input The items, the Area's instances, table sizes, and stored positions by id.
 * @returns A position for every item, by id.
 */
export const placeFloatItems = ({
    items,
    instances,
    tableSize,
    stored,
}: {
    items: readonly FloatPlacementItem[];
    instances: readonly AreaViewTableInstance[];
    tableSize: (tableId: string) => { width: number; height: number };
    stored: ReadonlyMap<string, { x: number; y: number }>;
}): Map<string, { x: number; y: number }> => {
    const positions = new Map<string, { x: number; y: number }>();
    const instanceById = new Map(instances.map((i) => [i.tableId, i]));
    const right = instances.reduce(
        (max, i) => Math.max(max, i.x + tableSize(i.tableId).width),
        0
    );
    const top = instances.reduce((min, i) => Math.min(min, i.y), Infinity);
    const bottom = instances.reduce(
        (max, i) => Math.max(max, i.y + tableSize(i.tableId).height),
        -Infinity
    );
    const areaTop = Number.isFinite(top) ? top : 0;
    const columnHeight = Math.max(
        FLOAT_MIN_COLUMN_HEIGHT,
        Number.isFinite(bottom) ? bottom - areaTop : 0
    );

    const pending: { item: FloatPlacementItem; idealY: number }[] = [];
    for (const item of items) {
        const saved = stored.get(item.id);
        if (saved) {
            positions.set(item.id, { x: saved.x, y: saved.y });
            continue;
        }
        const ys = item.localTableIds
            .map((tableId) => instanceById.get(tableId)?.y)
            .filter((y): y is number => typeof y === 'number');
        const idealY = ys.length
            ? ys.reduce((sum, y) => sum + y, 0) / ys.length
            : areaTop;
        pending.push({ item, idealY });
    }

    pending.sort(
        (a, b) => a.idealY - b.idealY || a.item.name.localeCompare(b.item.name)
    );

    let columnX = right + FLOAT_MARGIN;
    let nextFreeY = -Infinity;
    for (const { item, idealY } of pending) {
        let y = Math.max(idealY, nextFreeY);
        if (
            y + item.height > areaTop + columnHeight &&
            nextFreeY !== -Infinity
        ) {
            columnX += FLOAT_WIDTH + FLOAT_COLUMN_GAP;
            y = Math.max(idealY, areaTop);
            nextFreeY = -Infinity;
        }
        positions.set(item.id, { x: columnX, y });
        nextFreeY = y + item.height + FLOAT_GAP;
    }

    return positions;
};

/**
 * Places Float cards; see `placeFloatItems`.
 *
 * @param input The cards, the Area's instances, table sizes, and stored Float layout.
 * @returns A position for every card, by off-Area table id.
 */
export const placeFloatCards = ({
    cards,
    instances,
    tableSize,
    stored,
}: {
    cards: readonly FloatCard[];
    instances: readonly AreaViewTableInstance[];
    tableSize: (tableId: string) => { width: number; height: number };
    stored: ReadonlyMap<
        string,
        { x: number; y: number; expanded?: boolean | null }
    >;
}): Map<string, { x: number; y: number }> =>
    placeFloatItems({
        items: cards.map((card) => ({
            id: card.tableId,
            name: card.tableName,
            localTableIds: card.rows.map((row) => row.local.tableId),
            height: estimateFloatHeight(
                card.rows.length,
                !!stored.get(card.tableId)?.expanded
            ),
        })),
        instances,
        tableSize,
        stored,
    });

/** References coming into one shown column from tables outside the Area. */
export interface IncomingSummaryRow {
    /** The shown (referenced) column. */
    local: FloatRowEnd;
    relationshipIds: string[];
    /** Names of the off-Area tables that reference it, sorted. */
    tableNames: string[];
}

/**
 * Applies an Area's Float filter.
 *
 * With "all", every card is kept. With "outgoing" (the default), rows where the shown table
 * is the one referenced (incoming) are taken off the cards and summarised per shown column, so
 * they are still visible as a count and a line rather than as one card per referencing table.
 * Cards left with no rows are dropped.
 *
 * @param cards Cards from `resolveFloatCards`.
 * @param filter The Area's stored Float filter (missing means the default, "outgoing").
 * @returns The cards to draw and the summary of hidden incoming references (empty for "all").
 */
export const applyFloatFilter = (
    cards: readonly FloatCard[],
    filter: AreaFloatFilter | null | undefined
): { cards: FloatCard[]; incoming: IncomingSummaryRow[] } => {
    if (effectiveFloatFilter(filter) === 'all') {
        return { cards: [...cards], incoming: [] };
    }

    const incoming = new Map<string, IncomingSummaryRow>();
    const kept: FloatCard[] = [];

    for (const card of cards) {
        const outgoing = card.rows.filter(
            (row) => row.direction === 'outgoing'
        );
        for (const row of card.rows) {
            if (row.direction !== 'incoming') continue;
            const key = `${row.local.tableId}:${row.local.fieldId}`;
            const summary = incoming.get(key) ?? {
                local: row.local,
                relationshipIds: [],
                tableNames: [],
            };
            summary.relationshipIds.push(row.relationshipId);
            if (!summary.tableNames.includes(row.external.tableName)) {
                summary.tableNames.push(row.external.tableName);
            }
            incoming.set(key, summary);
        }
        if (outgoing.length > 0) {
            kept.push({ ...card, rows: outgoing });
        }
    }

    return {
        cards: kept,
        incoming: [...incoming.values()]
            .map((row) => ({
                ...row,
                relationshipIds: [...row.relationshipIds].sort(),
                tableNames: [...row.tableNames].sort(),
            }))
            .sort(
                (a, b) =>
                    a.local.tableName.localeCompare(b.local.tableName) ||
                    a.local.fieldName.localeCompare(b.local.fieldName)
            ),
    };
};

/** Height of the incoming-references summary card, for placement. */
export const estimateIncomingSummaryHeight = (rowCount: number) =>
    FLOAT_HEADER_HEIGHT + rowCount * FLOAT_ROW_HEIGHT + FLOAT_FOOTER_HEIGHT;
