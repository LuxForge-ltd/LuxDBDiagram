/**
 * Incoming references summary (LuxDBDiagram).
 *
 * Purpose: when an Area shows outgoing Floats only, this card keeps the hidden incoming
 * references visible: one row per shown column that is referenced from outside the Area,
 * with how many tables reference it and a line to that column. Nothing is dropped silently.
 * Scope: display only; the relationships are the canonical ones.
 * Operational role: the canvas adds it while an Area's Float filter is "outgoing" and some
 * references come in from outside.
 */
import React, { useCallback } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { ArrowDownLeft, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IncomingSummaryRow } from '@/lib/areas/floats';
import { FLOAT_WIDTH } from '@/lib/areas/floats';
import { useChartDB } from '@/hooks/use-chartdb';
import { incomingSummaryHandleId } from './float-ids';

export type IncomingSummaryNodeType = Node<
    {
        rows: IncomingSummaryRow[];
        areaViewId: string;
    },
    'float-summary'
>;

/** Lists referencing tables for a tooltip, shortening long lists. */
const listTables = (names: string[], more: (count: number) => string) =>
    names.length > 12
        ? `${names.slice(0, 12).join(', ')} ${more(names.length - 12)}`
        : names.join(', ');

export const IncomingSummaryNode: React.FC<NodeProps<IncomingSummaryNodeType>> =
    React.memo(({ data }) => {
        const { t } = useTranslation();
        const { updateAreaViews } = useChartDB();
        const total = data.rows.reduce(
            (sum, row) => sum + row.relationshipIds.length,
            0
        );

        const showAll = useCallback(
            (event: React.MouseEvent) => {
                event.stopPropagation();
                updateAreaViews([
                    { id: data.areaViewId, attributes: { floatFilter: 'all' } },
                ]);
            },
            [updateAreaViews, data.areaViewId]
        );

        return (
            <div
                className="rounded-md border-2 border-dashed border-slate-400 bg-background/95 shadow-sm backdrop-blur-sm dark:border-slate-500"
                style={{ width: FLOAT_WIDTH }}
                data-testid="float-incoming-summary"
            >
                <div className="flex h-[34px] items-center gap-1.5 border-b border-dashed border-slate-400 px-2 dark:border-slate-500">
                    <ArrowDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-xs font-bold">
                        {t('luxdb.floats.incoming_title')}
                    </span>
                    <span className="flex-1" />
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t('luxdb.floats.reference_count', { count: total })}
                    </span>
                </div>
                <div className="py-0.5">
                    {data.rows.map((row) => (
                        <div
                            key={`${row.local.tableId}:${row.local.fieldId}`}
                            className="relative flex h-[26px] items-center gap-1.5 px-2 text-[11px]"
                            title={listTables(row.tableNames, (count) =>
                                t('luxdb.floats.and_more', { count })
                            )}
                        >
                            {(['left', 'right'] as const).map((side) => (
                                <Handle
                                    key={side}
                                    type="target"
                                    position={
                                        side === 'left'
                                            ? Position.Left
                                            : Position.Right
                                    }
                                    id={incomingSummaryHandleId(
                                        side,
                                        row.local.tableId,
                                        row.local.fieldId
                                    )}
                                    isConnectable={false}
                                    className="!pointer-events-none !invisible"
                                />
                            ))}
                            <span className="min-w-0 truncate font-semibold">
                                {`${row.local.tableName}.${row.local.fieldName}`}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                                {t('luxdb.floats.referenced_by', {
                                    count: row.tableNames.length,
                                })}
                            </span>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={showAll}
                    className="nodrag flex h-[26px] w-full items-center justify-center gap-1 border-t border-dashed border-slate-400 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground dark:border-slate-500"
                >
                    <Eye className="size-3.5" />
                    {t('luxdb.floats.show_incoming')}
                </button>
            </div>
        );
    });

IncomingSummaryNode.displayName = 'IncomingSummaryNode';
