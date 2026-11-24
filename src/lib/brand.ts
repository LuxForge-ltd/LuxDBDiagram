/**
 * LuxDBDiag names (LuxDBDiagram).
 *
 * Purpose: one place for the product's names, so the header, page titles and metadata agree.
 * Scope: display text and links only.
 * Operational role: read by the brand mark and the page titles; ChartDB's own names stay only
 * where they credit ChartDB.
 */

/** Short name, for tight spaces such as the mobile header. */
export const BRAND_SHORT = 'LuxDBDiag';

/** Medium name, for the desktop header. */
export const BRAND_MEDIUM = 'LuxForge DB diagrams';

/** Full title, for the browser tab and page metadata. */
export const BRAND_FULL = 'LuxForge Database Diagrams built on ChartDB';

/** Where the hosted copy runs. */
export const BRAND_URL = 'https://luxdbdiagram.luxforge.dev';

/** Source repository (AGPL-3.0 source offer). */
export const BRAND_SOURCE_URL = 'https://github.com/LuxForge-ltd/LuxDBDiagram';

/**
 * Builds a page title from an optional page-specific part and the full title.
 *
 * @param page Text that names the page, such as a diagram name.
 * @returns "page | full title", or the full title alone.
 */
export const brandTitle = (page?: string | null): string =>
    page ? `${page} | ${BRAND_FULL}` : BRAND_FULL;
