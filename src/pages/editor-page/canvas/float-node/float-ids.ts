/**
 * Float identifiers (LuxDBDiagram).
 *
 * Purpose: the node and handle ids used for Float cards, shared by the Float node and the
 * code that builds Float lines.
 * Scope: naming only.
 */

/** Prefix of a Float node's id; the rest is the off-Area table's id. */
export const FLOAT_NODE_PREFIX = 'float:';

/** The Float node id for an off-Area table. */
export const floatNodeId = (tableId: string) =>
    `${FLOAT_NODE_PREFIX}${tableId}`;

/** The handle a line uses to reach one row of a Float. */
export const floatRowHandleId = (
    side: 'left' | 'right',
    relationshipId: string
) => `float_row_${side}_${relationshipId}`;

/** Node id of an Area's incoming-references summary card. */
export const incomingSummaryNodeId = (areaViewId: string) =>
    `float-summary:${areaViewId}`;

/** Key under which the summary card's position is stored with the Area's Float layout. */
export const INCOMING_SUMMARY_LAYOUT_KEY = '__incoming__';

/** The handle a line uses to reach one row of the incoming-references summary. */
export const incomingSummaryHandleId = (
    side: 'left' | 'right',
    tableId: string,
    fieldId: string
) => `float_incoming_${side}_${tableId}_${fieldId}`;

/** The handle on a Float's footer, used by lines of rows hidden behind "Show N more". */
export const floatMoreHandleId = (side: 'left' | 'right') =>
    `float_more_${side}`;
