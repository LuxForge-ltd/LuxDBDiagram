/**
 * Area views (LuxDBDiagram).
 *
 * Purpose: describes an Area, a named and coloured view over the one canonical schema.
 * Scope: presentation metadata only. An Area lists which canonical tables it shows, where
 * each one sits on that Area's canvas, and where its Float cards sit. It never holds table,
 * column or relationship definitions.
 * Operational role: stored per diagram (Dexie `area_views`), carried in diagram JSON and in
 * enhanced DBML `Area` blocks.
 *
 * The type is called `AreaView` because ChartDB already has an unrelated `Area` type: the
 * coloured rectangles drawn on its single canvas, labelled "Groups" in the LuxDBDiagram UI.
 */
import { z } from 'zod';

/** One appearance of a canonical table on an Area's canvas. */
export interface AreaViewTableInstance {
    /** ID of the canonical `DBTable`. */
    tableId: string;
    x: number;
    y: number;
}

/** Stored layout of a Float card (the card's rows are always derived from relationships). */
export interface AreaViewFloatLayout {
    /** ID of the off-Area canonical table the Float stands in for. */
    tableId: string;
    x: number;
    y: number;
    /** Whether the card shows all of its relationship rows. */
    expanded?: boolean | null;
}

export interface AreaView {
    id: string;
    /** Unique within a diagram. */
    name: string;
    color: string;
    /** Tab order. Drives Dupe numbering and which Area navigation opens first. */
    order: number;
    /** At most one instance per canonical table. */
    tables: AreaViewTableInstance[];
    floats?: AreaViewFloatLayout[] | null;
    /**
     * Which Floats the Area shows. "outgoing" (the default, used when this is not set) shows
     * Floats only for tables the Area's columns point at; the references coming in from
     * outside are summarised on one card instead, so a widely referenced table (such as
     * `users`) does not bring dozens of Floats with it. "all" shows a Float for every
     * relationship that leaves the Area.
     */
    floatFilter?: AreaFloatFilter | null;
    createdAt: number;
}

export type AreaFloatFilter = 'all' | 'outgoing';

/** The Float filter of an Area that has none stored. */
export const DEFAULT_AREA_FLOAT_FILTER: AreaFloatFilter = 'outgoing';

/**
 * The Float filter an Area actually uses.
 *
 * @param filter The Area's stored filter, if any.
 * @returns The stored filter, or the default when none is stored.
 */
export const effectiveFloatFilter = (
    filter: AreaFloatFilter | null | undefined
): AreaFloatFilter => filter ?? DEFAULT_AREA_FLOAT_FILTER;

export const areaViewTableInstanceSchema: z.ZodType<AreaViewTableInstance> =
    z.object({
        tableId: z.string(),
        x: z.number(),
        y: z.number(),
    });

export const areaViewFloatLayoutSchema: z.ZodType<AreaViewFloatLayout> =
    z.object({
        tableId: z.string(),
        x: z.number(),
        y: z.number(),
        expanded: z.boolean().or(z.null()).optional(),
    });

export const areaViewSchema: z.ZodType<AreaView> = z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    order: z.number(),
    tables: z.array(areaViewTableInstanceSchema),
    floats: z.array(areaViewFloatLayoutSchema).or(z.null()).optional(),
    floatFilter: z.enum(['all', 'outgoing']).or(z.null()).optional(),
    createdAt: z.number(),
});
