/**
 * Area drag and drop on the canvas (LuxDBDiagram).
 *
 * Purpose: lets the user drop a table from the table library onto an open Area to add it at
 * that spot, and drag a table node out of the canvas onto the table library to remove it
 * from the Area.
 * Scope: Area membership only. Moving a table around the canvas always just moves it;
 * removal happens only when the drag ends over the table library.
 * Operational role: `Canvas` spreads these handlers onto its container and React Flow.
 */
import type React from 'react';
import { useCallback } from 'react';
import type { Node } from '@xyflow/react';
import { useReactFlow } from '@xyflow/react';
import { useAreaView } from '@/hooks/use-area-view';
import { AREA_TABLE_DRAG_TYPE, useAreaMembership } from './use-area-membership';

/** Marks the element that takes tables back out of an Area when dropped on. */
export const AREA_LIBRARY_DROPZONE_ATTRIBUTE = 'data-area-library-dropzone';

/** Offsets a dropped table so the pointer lands on its header, not its corner. */
const DROP_OFFSET = { x: 100, y: 16 };

/** Whether a pointer position is over the table library's drop zone. */
const isOverLibrary = (clientX: number, clientY: number): boolean => {
    const element = document.elementFromPoint(clientX, clientY);
    return !!element?.closest(`[${AREA_LIBRARY_DROPZONE_ATTRIBUTE}]`);
};

/** Reads the pointer position from a mouse or touch event. */
const pointerOf = (
    event: MouseEvent | TouchEvent | React.MouseEvent
): { x: number; y: number } | null => {
    if ('clientX' in event) return { x: event.clientX, y: event.clientY };
    const touch = event.changedTouches?.[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

export const useAreaDragAndDrop = ({
    isAreaMode,
    readonly,
}: {
    isAreaMode: boolean;
    readonly?: boolean;
}) => {
    const { screenToFlowPosition } = useReactFlow();
    const { currentAreaViewId, setDraggingTableIds } = useAreaView();
    const { addTablesToArea, removeTablesFromArea } = useAreaMembership();
    const enabled = isAreaMode && !readonly && !!currentAreaViewId;

    const onDragOver = useCallback(
        (event: React.DragEvent) => {
            if (!enabled) return;
            if (!event.dataTransfer.types.includes(AREA_TABLE_DRAG_TYPE))
                return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        },
        [enabled]
    );

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            if (!enabled || !currentAreaViewId) return;
            const tableId = event.dataTransfer.getData(AREA_TABLE_DRAG_TYPE);
            if (!tableId) return;
            event.preventDefault();

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            addTablesToArea(currentAreaViewId, [tableId], {
                x: position.x - DROP_OFFSET.x,
                y: position.y - DROP_OFFSET.y,
            });
        },
        [enabled, currentAreaViewId, screenToFlowPosition, addTablesToArea]
    );

    /** Table ids being dragged: the grabbed node plus any others selected with it. */
    const draggedTableIds = (node: Node, nodes: Node[]) =>
        [node, ...nodes]
            .filter((n) => n.type === 'table')
            .map((n) => n.id)
            .filter((id, index, all) => all.indexOf(id) === index);

    const onNodeDragStart = useCallback(
        (_event: React.MouseEvent, node: Node, nodes: Node[]) => {
            if (!enabled) return;
            setDraggingTableIds(draggedTableIds(node, nodes));
        },
        [enabled, setDraggingTableIds]
    );

    const onNodeDragStop = useCallback(
        (event: React.MouseEvent, node: Node, nodes: Node[]) => {
            setDraggingTableIds([]);
            if (!enabled || !currentAreaViewId) return;

            const pointer = pointerOf(event);
            if (pointer && isOverLibrary(pointer.x, pointer.y)) {
                removeTablesFromArea(
                    currentAreaViewId,
                    draggedTableIds(node, nodes)
                );
            }
        },
        [enabled, currentAreaViewId, setDraggingTableIds, removeTablesFromArea]
    );

    return { onDragOver, onDrop, onNodeDragStart, onNodeDragStop };
};
