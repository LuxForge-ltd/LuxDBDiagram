/**
 * Area view operations (LuxDBDiagram).
 *
 * Purpose: pure, deterministic functions that create and change Areas.
 * Scope: Area metadata only. Nothing here reads or writes canonical tables, columns or
 * relationships; callers pass canonical data in when a calculation needs it.
 * Operational role: used by the ChartDB provider (state changes), the enhanced DBML importer
 * (building Areas from `Area` blocks) and the canvas (positions, ordering, Dupe lookups).
 */
import type {
    AreaView,
    AreaViewFloatLayout,
    AreaViewTableInstance,
} from '@/lib/domain/area-view';

/**
 * Colours handed to new Areas, in order. Chosen from ChartDB's table palette so they read the
 * same way in light and dark themes, and ordered so neighbouring Areas are easy to tell apart
 * (purple, blue, green, orange first, as in the brief's examples).
 */
export const AREA_PALETTE: readonly string[] = [
    '#b067e9', // purple
    '#8eb7ff', // blue
    '#4dee8a', // green
    '#ff9f74', // orange
    '#ff6363', // red
    '#42e0c0', // aqua
    '#ffe374', // yellow
    '#ff6b8a', // pink
    '#8a61f5', // indigo
    '#9ef07a', // lime
    '#c05dcf', // plum
    '#7175fa', // periwinkle
];

/** Horizontal and vertical gap used when placing tables that have no stored position. */
export const AREA_LAYOUT_GAP = 80;

/**
 * Orders Areas the way the UI shows them: by `order`, then creation time, then id.
 *
 * @param areaViews Areas in any order.
 * @returns A new array in display order.
 */
export const sortAreaViews = (areaViews: readonly AreaView[]): AreaView[] =>
    [...areaViews].sort(
        (a, b) =>
            a.order - b.order ||
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id)
    );

/**
 * Picks the colour for a new Area: the first palette colour no existing Area uses, or, when
 * every colour is taken, the palette entry at the Area's position so colours still cycle
 * predictably.
 *
 * @param existing Areas already in the diagram.
 * @returns A hex colour.
 */
export const pickAreaColor = (existing: readonly AreaView[]): string => {
    const used = new Set(existing.map((area) => area.color.toLowerCase()));
    const unused = AREA_PALETTE.find((color) => !used.has(color.toLowerCase()));
    return unused ?? AREA_PALETTE[existing.length % AREA_PALETTE.length];
};

/**
 * Returns a name not used by any existing Area. When `base` is taken, a number is appended
 * ("Users 2", "Users 3"); with no base, Areas are named "Area 1", "Area 2", and so on.
 *
 * @param existing Areas already in the diagram.
 * @param base Preferred name, if any.
 * @returns A unique Area name (compared case-insensitively).
 */
export const uniqueAreaName = (
    existing: readonly AreaView[],
    base?: string
): string => {
    const taken = new Set(existing.map((area) => area.name.toLowerCase()));
    const trimmed = base?.trim();

    if (trimmed && !taken.has(trimmed.toLowerCase())) {
        return trimmed;
    }

    const stem = trimmed || 'Area';
    let counter = trimmed ? 2 : existing.length + 1;
    while (taken.has(`${stem} ${counter}`.toLowerCase())) {
        counter++;
    }
    return `${stem} ${counter}`;
};

/**
 * Builds a new Area with defaults filled in: a unique name, the next palette colour, an order
 * after the last Area, and no tables.
 *
 * @param existing Areas already in the diagram.
 * @param attributes Values to use instead of the defaults.
 * @param generateId Produces the new Area's id.
 * @returns The new Area (not yet stored anywhere).
 */
export const buildAreaView = (
    existing: readonly AreaView[],
    attributes: Partial<Omit<AreaView, 'id'>>,
    generateId: () => string
): AreaView => {
    const maxOrder = existing.reduce(
        (max, area) => Math.max(max, area.order),
        -1
    );

    return {
        id: generateId(),
        name: uniqueAreaName(existing, attributes.name),
        color: attributes.color ?? pickAreaColor(existing),
        order: attributes.order ?? maxOrder + 1,
        tables: dedupeInstances(attributes.tables ?? []),
        floats: attributes.floats ?? [],
        createdAt: attributes.createdAt ?? Date.now(),
    };
};

/**
 * Removes repeated table ids from an instance list, keeping the first appearance, so the
 * "one instance per table per Area" rule always holds.
 *
 * @param instances Instances that may repeat a table.
 * @returns Instances with each table at most once, in original order.
 */
export const dedupeInstances = (
    instances: readonly AreaViewTableInstance[]
): AreaViewTableInstance[] => {
    const seen = new Set<string>();
    return instances.filter((instance) => {
        if (seen.has(instance.tableId)) {
            return false;
        }
        seen.add(instance.tableId);
        return true;
    });
};

/**
 * Adds table instances to an Area. Tables already in the Area are skipped, never duplicated.
 *
 * @param areaView The Area to add to.
 * @param instances Tables to add, with their positions on this Area's canvas.
 * @returns The updated Area plus which table ids were added and which were already present.
 */
export const addTableInstances = (
    areaView: AreaView,
    instances: readonly AreaViewTableInstance[]
): { areaView: AreaView; added: string[]; skipped: string[] } => {
    const present = new Set(areaView.tables.map((t) => t.tableId));
    const added: string[] = [];
    const skipped: string[] = [];
    const toAdd: AreaViewTableInstance[] = [];

    for (const instance of instances) {
        if (present.has(instance.tableId)) {
            skipped.push(instance.tableId);
            continue;
        }
        present.add(instance.tableId);
        added.push(instance.tableId);
        toAdd.push({ ...instance });
    }

    return {
        areaView: added.length
            ? { ...areaView, tables: [...areaView.tables, ...toAdd] }
            : areaView,
        added,
        skipped,
    };
};

/**
 * Removes table instances from an Area. Only this Area's visual instances go; the canonical
 * tables, their columns, relationships and other Areas are untouched.
 *
 * @param areaView The Area to remove from.
 * @param tableIds Canonical ids of the tables to remove.
 * @returns The updated Area.
 */
export const removeTableInstances = (
    areaView: AreaView,
    tableIds: readonly string[]
): AreaView => {
    const toRemove = new Set(tableIds);
    return {
        ...areaView,
        tables: areaView.tables.filter((t) => !toRemove.has(t.tableId)),
    };
};

/**
 * Moves table instances within one Area. Other Areas, and the tables' positions in the
 * "All tables" view, are unaffected.
 *
 * @param areaView The Area whose instances moved.
 * @param positions New positions, by canonical table id.
 * @returns The updated Area.
 */
export const setInstancePositions = (
    areaView: AreaView,
    positions: readonly AreaViewTableInstance[]
): AreaView => {
    const byId = new Map(positions.map((p) => [p.tableId, p]));
    return {
        ...areaView,
        tables: areaView.tables.map((instance) => {
            const moved = byId.get(instance.tableId);
            return moved ? { ...instance, x: moved.x, y: moved.y } : instance;
        }),
    };
};

/**
 * Stores a Float card's position or expanded state, creating the layout entry if needed.
 *
 * @param areaView The Area containing the Float.
 * @param layout The off-Area table id plus the values to store.
 * @returns The updated Area.
 */
export const setFloatLayout = (
    areaView: AreaView,
    layout: Pick<AreaViewFloatLayout, 'tableId'> &
        Partial<AreaViewFloatLayout> & { x?: number; y?: number }
): AreaView => {
    const floats = areaView.floats ?? [];
    const existing = floats.find((f) => f.tableId === layout.tableId);

    if (existing) {
        return {
            ...areaView,
            floats: floats.map((f) =>
                f.tableId === layout.tableId ? { ...f, ...layout } : f
            ),
        };
    }

    return {
        ...areaView,
        floats: [
            ...floats,
            {
                tableId: layout.tableId,
                x: layout.x ?? 0,
                y: layout.y ?? 0,
                expanded: layout.expanded ?? null,
            },
        ],
    };
};

/**
 * Lists the instances whose canonical table still exists. Instances of a deleted table are
 * kept in storage (so undoing the deletion brings them back) but are never shown, counted
 * or exported.
 *
 * @param areaView The Area.
 * @param tableIds Ids of the canonical tables that exist now.
 * @returns The live instances, in stored order.
 */
export const getLiveInstances = (
    areaView: AreaView,
    tableIds: ReadonlySet<string>
): AreaViewTableInstance[] =>
    areaView.tables.filter((instance) => tableIds.has(instance.tableId));

/**
 * Lists the Areas that show a table, in display order. Position in this list is the table's
 * Dupe number (first is [1]).
 *
 * @param areaViews All Areas.
 * @param tableId Canonical table id.
 * @returns Areas containing the table, in display order.
 */
export const getAreaViewsContainingTable = (
    areaViews: readonly AreaView[],
    tableId: string
): AreaView[] =>
    sortAreaViews(areaViews).filter((area) =>
        area.tables.some((instance) => instance.tableId === tableId)
    );

/** One numbered Dupe marker on a table: an Area that shows the table. */
export interface InstanceMarker {
    areaViewId: string;
    /** 1-based, following Area order, so the numbering is the same in every view. */
    number: number;
    name: string;
    color: string;
    /** Whether this marker is the Area currently open. */
    current: boolean;
}

/**
 * Works out the numbered markers for a table that appears in Areas.
 *
 * Markers are shown inside an Area when the table appears in at least two Areas (it is a
 * Dupe), and in the "All tables" view when it appears in at least one, so the user can jump
 * into an Area from there.
 *
 * @param areaViews All Areas.
 * @param tableId Canonical table id.
 * @param currentAreaViewId The open Area, or null for "All tables".
 * @returns The markers in number order, or an empty list when none should show.
 */
export const getInstanceMarkers = (
    areaViews: readonly AreaView[],
    tableId: string,
    currentAreaViewId: string | null
): InstanceMarker[] => {
    const containing = getAreaViewsContainingTable(areaViews, tableId);
    const minimum = currentAreaViewId ? 2 : 1;
    if (containing.length < minimum) return [];

    return containing.map((area, index) => ({
        areaViewId: area.id,
        number: index + 1,
        name: area.name,
        color: area.color,
        current: area.id === currentAreaViewId,
    }));
};

/**
 * Computes new `order` values after the user reorders Areas.
 *
 * @param areaViews All Areas.
 * @param orderedIds Area ids in their new order. Areas not listed keep their relative order
 *        after the listed ones.
 * @returns The order changes to apply, one per Area whose order changed.
 */
export const reorderAreaViews = (
    areaViews: readonly AreaView[],
    orderedIds: readonly string[]
): { id: string; order: number }[] => {
    const listed = orderedIds
        .map((id) => areaViews.find((area) => area.id === id))
        .filter((area): area is AreaView => !!area);
    const rest = sortAreaViews(areaViews).filter(
        (area) => !orderedIds.includes(area.id)
    );

    return [...listed, ...rest]
        .map((area, index) => ({ id: area.id, order: index, area }))
        .filter(({ area, order }) => area.order !== order)
        .map(({ id, order }) => ({ id, order }));
};

/**
 * Rewrites the table ids inside Areas after a diagram is cloned with new ids (diagram JSON
 * import/export, duplicating a diagram). Instances whose table has no new id are dropped.
 *
 * @param areaViews Areas from the original diagram.
 * @param getNewId Maps an old id (Area or table) to its new id, or null when it has none.
 * @param generateId Fallback id generator for Areas missing from the id map.
 * @returns The Areas with remapped ids.
 */
export const remapAreaViewIds = (
    areaViews: readonly AreaView[],
    getNewId: (id: string) => string | null,
    generateId: () => string
): AreaView[] =>
    areaViews.map((area) => ({
        ...area,
        id: getNewId(area.id) ?? generateId(),
        tables: area.tables
            .map((instance) => {
                const tableId = getNewId(instance.tableId);
                return tableId ? { ...instance, tableId } : null;
            })
            .filter(
                (instance): instance is AreaViewTableInstance => !!instance
            ),
        floats: (area.floats ?? [])
            .map((float) => {
                const tableId = getNewId(float.tableId);
                return tableId ? { ...float, tableId } : null;
            })
            .filter((float): float is AreaViewFloatLayout => !!float),
    }));
