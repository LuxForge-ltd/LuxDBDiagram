/**
 * Float node (LuxDBDiagram).
 *
 * Purpose: a compact card standing in for one off-Area table. Each row is one relationship
 * between that table and a table shown in the Area, written as
 * "referencing.column [crow's foot] referenced.column", with its own connection points so
 * the canvas line from the shown column ends on the right row.
 * Scope: display and navigation; it never edits the schema.
 * Operational role: the canvas adds one per Float card while an Area is open.
 *
 * Rows beyond the first three are collapsed behind "Show N more". Lines for collapsed rows
 * still reach the card, ending on its footer, so no relationship disappears from view.
 */
import React, { useCallback, useState } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FloatCard, FloatRow } from '@/lib/areas/floats';
import { FLOAT_COLLAPSED_ROWS, FLOAT_WIDTH } from '@/lib/areas/floats';
import { setFloatLayout } from '@/lib/areas/area-view-ops';
import { useChartDB } from '@/hooks/use-chartdb';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/dropdown-menu/dropdown-menu';
import { CrowFootGlyph } from './crow-foot-glyph';
import { useFloatNavigation } from './use-float-navigation';
import { useAreaMembership } from '../area-view/use-area-membership';
import { floatMoreHandleId, floatRowHandleId } from './float-ids';

export type FloatNodeType = Node<
    {
        card: FloatCard;
        areaViewId: string;
        expanded: boolean;
        /** Colour of the first Area showing the table, else the table's own colour. */
        homeColor: string;
        homeAreaName?: string;
    },
    'float'
>;

/** Invisible connection points on both sides of a row; never used to draw new links. */
const RowHandles: React.FC<{ idOf: (side: 'left' | 'right') => string }> = ({
    idOf,
}) => (
    <>
        <Handle
            type="target"
            position={Position.Left}
            id={idOf('left')}
            isConnectable={false}
            className="!pointer-events-none !invisible !left-0"
        />
        <Handle
            type="target"
            position={Position.Right}
            id={idOf('right')}
            isConnectable={false}
            className="!pointer-events-none !invisible !right-0"
        />
    </>
);

interface FloatRowViewProps {
    row: FloatRow;
    areaViewId: string;
}

const FloatRowView: React.FC<FloatRowViewProps> = ({ row, areaViewId }) => {
    const { t } = useTranslation();
    const { goToColumn, showInAllTables } = useFloatNavigation();
    const { addTablesToArea } = useAreaMembership();
    const { readonly } = useChartDB();
    const [menuOpen, setMenuOpen] = useState(false);

    const left = `${row.referencing.tableName}.${row.referencing.fieldName}`;
    const right = `${row.referenced.tableName}.${row.referenced.fieldName}`;
    const externalIsLeft = row.direction === 'incoming';

    const navigate = useCallback(() => {
        if (!goToColumn(row.external.tableId, row.external.fieldId)) {
            setMenuOpen(true);
        }
    }, [goToColumn, row.external]);

    const content = (
        <div
            role="button"
            tabIndex={0}
            onClick={(event) => {
                event.stopPropagation();
                navigate();
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') navigate();
            }}
            title={t('luxdb.floats.row_title', {
                from: left,
                to: right,
                table: row.external.tableName,
            })}
            className="nodrag relative flex h-[26px] cursor-pointer items-center gap-1.5 px-2 text-[11px] hover:bg-accent"
            data-testid={`float-row-${row.relationshipId}`}
        >
            <RowHandles
                idOf={(side) => floatRowHandleId(side, row.relationshipId)}
            />
            <span
                className={cn(
                    'min-w-0 flex-1 truncate text-right',
                    externalIsLeft ? 'font-semibold' : 'text-muted-foreground'
                )}
            >
                {left}
            </span>
            <CrowFootGlyph
                left={row.referencing.cardinality}
                right={row.referenced.cardinality}
            />
            <span
                className={cn(
                    'min-w-0 flex-1 truncate',
                    externalIsLeft ? 'text-muted-foreground' : 'font-semibold'
                )}
            >
                {right}
            </span>
        </div>
    );

    return (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
                {/* The menu opens only when the table is in no Area (see navigate). */}
                <div onPointerDown={(event) => event.preventDefault()}>
                    {content}
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {t('luxdb.floats.not_in_area', {
                        table: row.external.tableName,
                    })}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!readonly ? (
                    <DropdownMenuItem
                        onClick={() =>
                            addTablesToArea(areaViewId, [row.external.tableId])
                        }
                    >
                        {t('luxdb.floats.add_here')}
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                    onClick={() =>
                        showInAllTables(
                            row.external.tableId,
                            row.external.fieldId
                        )
                    }
                >
                    {t('luxdb.floats.show_in_all_tables')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export const FloatNode: React.FC<NodeProps<FloatNodeType>> = React.memo(
    ({ data, selected, positionAbsoluteX, positionAbsoluteY }) => {
        const { t } = useTranslation();
        const { mutateAreaView } = useChartDB();
        const { card, areaViewId, expanded, homeColor, homeAreaName } = data;
        const hiddenCount = Math.max(
            0,
            card.rows.length - FLOAT_COLLAPSED_ROWS
        );
        const visibleRows = expanded
            ? card.rows
            : card.rows.slice(0, FLOAT_COLLAPSED_ROWS);

        const toggleExpanded = useCallback(
            (event: React.MouseEvent) => {
                event.stopPropagation();
                // Expanding is a view setting: stored with the Float, not an undo step.
                mutateAreaView(
                    areaViewId,
                    (view) =>
                        setFloatLayout(view, {
                            tableId: card.tableId,
                            x: positionAbsoluteX,
                            y: positionAbsoluteY,
                            expanded: !expanded,
                        }),
                    { updateHistory: false }
                );
            },
            [
                mutateAreaView,
                areaViewId,
                card.tableId,
                positionAbsoluteX,
                positionAbsoluteY,
                expanded,
            ]
        );

        return (
            <div
                className={cn(
                    'rounded-md border-2 border-dashed bg-background/95 shadow-sm backdrop-blur-sm',
                    selected ? 'border-pink-600' : ''
                )}
                style={{
                    width: FLOAT_WIDTH,
                    ...(selected ? {} : { borderColor: homeColor }),
                }}
                data-testid={`float-${card.tableName}`}
            >
                <div
                    className="flex h-[34px] items-center gap-1.5 border-b border-dashed px-2"
                    style={{ borderColor: homeColor }}
                >
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-xs font-bold">
                        {card.tableName}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t('luxdb.floats.reference_count', {
                            count: card.rows.length,
                        })}
                    </span>
                    <span className="flex-1" />
                    <span
                        className="flex max-w-28 shrink-0 items-center gap-1 truncate text-[10px] text-muted-foreground"
                        title={
                            homeAreaName
                                ? t('luxdb.floats.home_area', {
                                      area: homeAreaName,
                                  })
                                : t('luxdb.floats.no_area')
                        }
                    >
                        <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: homeColor }}
                        />
                        <span className="truncate">
                            {homeAreaName ?? t('luxdb.floats.no_area_short')}
                        </span>
                    </span>
                </div>

                <div className="py-0.5">
                    {visibleRows.map((row) => (
                        <FloatRowView
                            key={row.relationshipId}
                            row={row}
                            areaViewId={areaViewId}
                        />
                    ))}
                </div>

                {hiddenCount > 0 ? (
                    <button
                        type="button"
                        onClick={toggleExpanded}
                        className="nodrag relative flex h-[26px] w-full items-center justify-center gap-1 border-t border-dashed text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        style={{ borderColor: homeColor }}
                    >
                        <RowHandles idOf={(side) => floatMoreHandleId(side)} />
                        {expanded ? (
                            <>
                                <ChevronUp className="size-3.5" />
                                {t('luxdb.floats.show_less')}
                            </>
                        ) : (
                            <>
                                <ChevronDown className="size-3.5" />
                                {t('luxdb.floats.show_more', {
                                    count: hiddenCount,
                                })}
                            </>
                        )}
                    </button>
                ) : null}
            </div>
        );
    }
);

FloatNode.displayName = 'FloatNode';
