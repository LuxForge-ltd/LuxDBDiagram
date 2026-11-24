/**
 * Area Floats on the canvas (LuxDBDiagram).
 *
 * Purpose: turns the open Area's Float cards into React Flow nodes and edges, applies the
 * Area's Float filter, and stores a Float's position when the user moves it.
 * Scope: presentation only. Rows and lines are derived from canonical relationships every
 * time; only each card's position and expanded state (and the filter) are stored on the Area.
 * Operational role: called once by `Canvas`; empty in the "All tables" view.
 */
import { useCallback, useMemo } from 'react';
import type { NodePositionChange } from '@xyflow/react';
import { useChartDB } from '@/hooks/use-chartdb';
import type { AreaView } from '@/lib/domain/area-view';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import { getTableDimensions, MIN_TABLE_SIZE } from '@/lib/domain/db-table';
import {
    applyFloatFilter,
    estimateFloatHeight,
    estimateIncomingSummaryHeight,
    FLOAT_COLLAPSED_ROWS,
    FLOAT_WIDTH,
    placeFloatItems,
    resolveFloatCards,
} from '@/lib/areas/floats';
import {
    getAreaViewsContainingTable,
    setFloatLayout,
} from '@/lib/areas/area-view-ops';
import type { FloatNodeType } from '../float-node/float-node';
import type { IncomingSummaryNodeType } from '../float-node/incoming-summary-node';
import {
    FLOAT_NODE_PREFIX,
    INCOMING_SUMMARY_LAYOUT_KEY,
    floatMoreHandleId,
    floatNodeId,
    floatRowHandleId,
    incomingSummaryHandleId,
    incomingSummaryNodeId,
} from '../float-node/float-ids';
import type { FloatEdgeType } from '../float-node/float-edge';
import {
    LEFT_HANDLE_ID_PREFIX,
    RIGHT_HANDLE_ID_PREFIX,
} from '../table-node/table-node-field';

export const useAreaFloats = ({
    areaView,
    crossRelationships,
}: {
    areaView: AreaView | null;
    crossRelationships: DBRelationship[];
}) => {
    const { tables, areaViews, mutateAreaView } = useChartDB();

    const allCards = useMemo(
        () =>
            areaView
                ? resolveFloatCards({
                      crossRelationships,
                      tables,
                      instances: areaView.tables,
                  })
                : [],
        [areaView, crossRelationships, tables]
    );

    const { cards, incoming } = useMemo(
        () => applyFloatFilter(allCards, areaView?.floatFilter),
        [allCards, areaView?.floatFilter]
    );

    const isExpanded = useCallback(
        (tableId: string) =>
            !!areaView?.floats?.find((float) => float.tableId === tableId)
                ?.expanded,
        [areaView]
    );

    const tableSize = useCallback(
        (tableId: string) => {
            const table = tables.find((t) => t.id === tableId);
            return table
                ? getTableDimensions(table)
                : { width: MIN_TABLE_SIZE, height: 120 };
        },
        [tables]
    );

    const summaryId = areaView ? incomingSummaryNodeId(areaView.id) : '';

    const positions = useMemo(() => {
        if (!areaView) return new Map<string, { x: number; y: number }>();
        const stored = new Map(
            (areaView.floats ?? []).map((float) => [
                float.tableId === INCOMING_SUMMARY_LAYOUT_KEY
                    ? summaryId
                    : float.tableId,
                float,
            ])
        );
        return placeFloatItems({
            items: [
                ...cards.map((card) => ({
                    id: card.tableId,
                    name: card.tableName,
                    localTableIds: card.rows.map((row) => row.local.tableId),
                    height: estimateFloatHeight(
                        card.rows.length,
                        isExpanded(card.tableId)
                    ),
                })),
                ...(incoming.length > 0
                    ? [
                          {
                              id: summaryId,
                              name: '~incoming',
                              localTableIds: incoming.map(
                                  (row) => row.local.tableId
                              ),
                              height: estimateIncomingSummaryHeight(
                                  incoming.length
                              ),
                          },
                      ]
                    : []),
            ],
            instances: areaView.tables,
            tableSize,
            stored,
        });
    }, [areaView, cards, incoming, isExpanded, tableSize, summaryId]);

    const floatNodes: (FloatNodeType | IncomingSummaryNodeType)[] =
        useMemo(() => {
            if (!areaView) return [];
            const nodes: (FloatNodeType | IncomingSummaryNodeType)[] =
                cards.map((card) => {
                    const home = getAreaViewsContainingTable(
                        areaViews,
                        card.tableId
                    )[0];
                    const table = tables.find((t) => t.id === card.tableId);
                    return {
                        id: floatNodeId(card.tableId),
                        type: 'float',
                        position: positions.get(card.tableId) ?? {
                            x: 0,
                            y: 0,
                        },
                        width: FLOAT_WIDTH,
                        deletable: false,
                        connectable: false,
                        data: {
                            card,
                            areaViewId: areaView.id,
                            expanded: isExpanded(card.tableId),
                            homeColor: home?.color ?? table?.color ?? '#94a3b8',
                            homeAreaName: home?.name,
                        },
                    };
                });
            if (incoming.length > 0) {
                nodes.push({
                    id: summaryId,
                    type: 'float-summary',
                    position: positions.get(summaryId) ?? { x: 0, y: 0 },
                    width: FLOAT_WIDTH,
                    deletable: false,
                    connectable: false,
                    data: { rows: incoming, areaViewId: areaView.id },
                });
            }
            return nodes;
        }, [
            areaView,
            cards,
            incoming,
            areaViews,
            tables,
            positions,
            isExpanded,
            summaryId,
        ]);

    const floatEdges: FloatEdgeType[] = useMemo(() => {
        if (!areaView) return [];
        const instances = new Map(
            areaView.tables.map((instance) => [instance.tableId, instance])
        );
        /** The sides of the table and the card that face each other. */
        const sides = (localTableId: string, cardX: number) => {
            const instance = instances.get(localTableId);
            const tableWidth =
                tables.find((t) => t.id === localTableId)?.width ??
                MIN_TABLE_SIZE;
            const cardIsRight =
                cardX + FLOAT_WIDTH / 2 >= (instance?.x ?? 0) + tableWidth / 2;
            return {
                tablePrefix: cardIsRight
                    ? RIGHT_HANDLE_ID_PREFIX
                    : LEFT_HANDLE_ID_PREFIX,
                cardSide: cardIsRight ? ('left' as const) : ('right' as const),
            };
        };

        const cardEdges = cards.flatMap((card) => {
            const cardX = positions.get(card.tableId)?.x ?? 0;
            const expanded = isExpanded(card.tableId);
            return card.rows.map((row, index): FloatEdgeType => {
                const { tablePrefix, cardSide } = sides(
                    row.local.tableId,
                    cardX
                );
                const collapsed = !expanded && index >= FLOAT_COLLAPSED_ROWS;
                return {
                    id: `float:${row.relationshipId}`,
                    type: 'float-edge',
                    source: row.local.tableId,
                    sourceHandle: `${tablePrefix}${row.local.fieldId}`,
                    target: floatNodeId(card.tableId),
                    targetHandle: collapsed
                        ? floatMoreHandleId(cardSide)
                        : floatRowHandleId(cardSide, row.relationshipId),
                    deletable: false,
                    data: { relationshipId: row.relationshipId, collapsed },
                };
            });
        });

        const summaryX = positions.get(summaryId)?.x ?? 0;
        const summaryEdges = incoming.map((row): FloatEdgeType => {
            const { tablePrefix, cardSide } = sides(
                row.local.tableId,
                summaryX
            );
            return {
                id: `float-incoming:${row.local.tableId}:${row.local.fieldId}`,
                type: 'float-edge',
                source: row.local.tableId,
                sourceHandle: `${tablePrefix}${row.local.fieldId}`,
                target: summaryId,
                targetHandle: incomingSummaryHandleId(
                    cardSide,
                    row.local.tableId,
                    row.local.fieldId
                ),
                deletable: false,
                data: {
                    relationshipId: row.relationshipIds.join(','),
                    collapsed: true,
                },
            };
        });

        return [...cardEdges, ...summaryEdges];
    }, [areaView, cards, incoming, positions, tables, isExpanded, summaryId]);

    /** Stores the positions of Floats the user moved (one undo step per move). */
    const applyFloatPositionChanges = useCallback(
        (changes: NodePositionChange[]) => {
            if (!areaView) return;
            const moved = changes.filter(
                (change) =>
                    change.position &&
                    (change.id.startsWith(FLOAT_NODE_PREFIX) ||
                        change.id === summaryId)
            );
            if (moved.length === 0) return;

            mutateAreaView(areaView.id, (view) =>
                moved.reduce((current, change) => {
                    const tableId =
                        change.id === summaryId
                            ? INCOMING_SUMMARY_LAYOUT_KEY
                            : change.id.slice(FLOAT_NODE_PREFIX.length);
                    const existing = current.floats?.find(
                        (float) => float.tableId === tableId
                    );
                    return setFloatLayout(current, {
                        tableId,
                        x: change.position!.x,
                        y: change.position!.y,
                        expanded: existing?.expanded ?? null,
                    });
                }, view)
            );
        },
        [areaView, mutateAreaView, summaryId]
    );

    return {
        floatNodes,
        floatEdges,
        applyFloatPositionChanges,
        floatCounts: {
            shown: cards.length,
            total: allCards.length,
            incomingReferences: allCards.reduce(
                (sum, card) =>
                    sum +
                    card.rows.filter((row) => row.direction === 'incoming')
                        .length,
                0
            ),
        },
    };
};
