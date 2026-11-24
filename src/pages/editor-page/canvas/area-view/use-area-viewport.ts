/**
 * Area viewport and focus handling (LuxDBDiagram).
 *
 * Purpose: keeps each view's pan and zoom when switching between Areas, and brings a
 * requested table (and column) into view with a brief highlight.
 * Scope: React Flow viewport only; no diagram data changes.
 * Operational role: called once by `Canvas`. Navigation features (Dupe markers, Float rows,
 * Area tabs) ask for focus through the Area view context instead of moving the viewport
 * themselves.
 */
import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAreaView } from '@/hooks/use-area-view';
import { ALL_TABLES_KEY } from '@/context/area-view-context/area-view-context';
import { useChartDB } from '@/hooks/use-chartdb';
import { LEFT_HANDLE_ID_PREFIX } from '../table-node/table-node-field';

/** Height of a table node's header, used when no column is targeted. */
const TABLE_HEADER_HEIGHT = 44;
const HIGHLIGHT_DURATION_MS = 2400;
const FOCUS_RETRY_MS = 50;
const FOCUS_MAX_ATTEMPTS = 40;

/**
 * Finds the vertical centre of a column on the canvas, from its rendered connection handle.
 * Collapsed tables do not show every column in order, so the DOM is the reliable source.
 *
 * @returns The column's centre in flow coordinates, or null when it is not rendered.
 */
const fieldCentreY = (
    tableId: string,
    fieldId: string | undefined,
    screenToFlowPosition: (point: { x: number; y: number }) => {
        x: number;
        y: number;
    }
): number | null => {
    if (!fieldId) return null;
    const handle = document.querySelector(
        `.react-flow__node[data-id="${CSS.escape(tableId)}"] [data-handleid="${CSS.escape(`${LEFT_HANDLE_ID_PREFIX}${fieldId}`)}"]`
    );
    if (!handle) return null;
    const rect = handle.getBoundingClientRect();
    return screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    }).y;
};

export const useAreaViewport = () => {
    const {
        getViewport,
        setViewport,
        fitView,
        getInternalNode,
        setCenter,
        screenToFlowPosition,
    } = useReactFlow();
    const { tables, areaViews } = useChartDB();
    const {
        currentAreaViewId,
        saveViewport,
        getViewport: recallViewport,
        focusRequest,
        clearFocusRequest,
        setHighlight,
    } = useAreaView();

    const viewKey = currentAreaViewId ?? ALL_TABLES_KEY;
    const previousKey = useRef(viewKey);
    const pendingFocus = useRef(false);
    pendingFocus.current = !!focusRequest;

    // Switching views: remember where the old view was, then restore or fit the new one.
    useEffect(() => {
        if (previousKey.current === viewKey) return;
        saveViewport(previousKey.current, getViewport());
        previousKey.current = viewKey;

        const remembered = recallViewport(viewKey);
        // Give React Flow a moment to render the new view's nodes before fitting.
        const timer = setTimeout(() => {
            if (pendingFocus.current) return; // the focus request positions the view
            if (remembered) {
                setViewport(remembered, { duration: 200 });
            } else {
                fitView({ duration: 200, padding: 0.1, maxZoom: 0.8 });
            }
        }, 80);
        return () => clearTimeout(timer);
    }, [
        viewKey,
        saveViewport,
        recallViewport,
        getViewport,
        setViewport,
        fitView,
    ]);

    // Focus requests. A table's node has the same id in every view, so wait until the
    // requested view is open and the node sits where that view stores it; then centre it
    // (on the requested column when there is one) and highlight it.
    useEffect(() => {
        if (!focusRequest) return;
        let attempts = 0;
        let timer: ReturnType<typeof setTimeout>;

        const expectedPosition = (): { x: number; y: number } | null => {
            if (focusRequest.areaViewId === null) {
                return (
                    tables.find((table) => table.id === focusRequest.tableId) ??
                    null
                );
            }
            return (
                areaViews
                    .find((view) => view.id === focusRequest.areaViewId)
                    ?.tables.find(
                        (instance) => instance.tableId === focusRequest.tableId
                    ) ?? null
            );
        };

        const tryFocus = () => {
            const expected = expectedPosition();
            if (!expected) {
                // The table is not in that view (for example it was just removed).
                clearFocusRequest();
                return;
            }

            const node = getInternalNode(focusRequest.tableId);
            const width = node?.measured?.width;
            const height = node?.measured?.height;
            const position = node?.internals.positionAbsolute;
            const ready =
                currentAreaViewId === focusRequest.areaViewId &&
                !!node &&
                !!width &&
                !!height &&
                !!position &&
                Math.abs(position.x - expected.x) < 1 &&
                Math.abs(position.y - expected.y) < 1;

            if (ready) {
                const y =
                    fieldCentreY(
                        focusRequest.tableId,
                        focusRequest.fieldId,
                        screenToFlowPosition
                    ) ??
                    position.y + Math.min(height / 2, TABLE_HEADER_HEIGHT * 3);

                setCenter(position.x + width / 2, y, {
                    zoom: Math.max(getViewport().zoom, 0.9),
                    duration: 400,
                });
                setHighlight({
                    tableId: focusRequest.tableId,
                    fieldId: focusRequest.fieldId,
                });
                clearFocusRequest();
                return;
            }

            if (++attempts < FOCUS_MAX_ATTEMPTS) {
                timer = setTimeout(tryFocus, FOCUS_RETRY_MS);
            } else {
                clearFocusRequest();
            }
        };

        timer = setTimeout(tryFocus, FOCUS_RETRY_MS);
        return () => clearTimeout(timer);
    }, [
        focusRequest,
        currentAreaViewId,
        areaViews,
        tables,
        getInternalNode,
        setCenter,
        getViewport,
        screenToFlowPosition,
        setHighlight,
        clearFocusRequest,
    ]);

    // Highlights fade on their own.
    const { highlight } = useAreaView();
    useEffect(() => {
        if (!highlight) return;
        const timer = setTimeout(
            () => setHighlight(null),
            HIGHLIGHT_DURATION_MS
        );
        return () => clearTimeout(timer);
    }, [highlight, setHighlight]);
};
