/**
 * Float edge (LuxDBDiagram).
 *
 * Purpose: the canvas line from a shown table's column to its row on a Float card, so a
 * relationship that leaves the Area stays visible and traceable.
 * Scope: display only; the relationship itself is the canonical one.
 * Operational role: the canvas adds one per Float row while an Area is open.
 *
 * Lines are dashed to set them apart from relationships inside the Area. Lines for rows
 * hidden behind a collapsed Float are fainter and end on the Float's footer.
 */
import React from 'react';
import type { Edge, EdgeProps } from '@xyflow/react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import { cn } from '@/lib/utils';

export type FloatEdgeType = Edge<
    {
        relationshipId: string;
        /** The row is hidden behind "Show N more"; the line ends on the footer. */
        collapsed: boolean;
        highlighted?: boolean;
    },
    'float-edge'
>;

export const FloatEdge: React.FC<EdgeProps<FloatEdgeType>> = React.memo(
    ({
        id,
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        data,
        selected,
    }) => {
        const [path] = getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
            borderRadius: 14,
        });
        const emphasised = selected || data?.highlighted;

        return (
            <BaseEdge
                id={id}
                path={path}
                className={cn(
                    'fill-none',
                    emphasised
                        ? '!stroke-pink-600'
                        : '!stroke-slate-400 dark:!stroke-slate-500'
                )}
                style={{
                    strokeWidth: emphasised ? 2 : 1.4,
                    strokeDasharray: data?.collapsed ? '2 4' : '6 4',
                    opacity: data?.collapsed && !emphasised ? 0.55 : 1,
                }}
            />
        );
    }
);

FloatEdge.displayName = 'FloatEdge';
