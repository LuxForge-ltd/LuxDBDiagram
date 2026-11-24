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

/** Height of a table node's header plus one row, used to aim at a column. */
const TABLE_HEADER_HEIGHT = 42;
const FIELD_ROW_HEIGHT = 32;
const HIGHLIGHT_DURATION_MS = 2400;
const FOCUS_RETRY_MS = 50;
const FOCUS_MAX_ATTEMPTS = 40;

export const useAreaViewport = () => {
    const { getViewport, setViewport, fitView, getInternalNode, setCenter } =
        useReactFlow();
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

    // Focus requests: wait until the table's node is rendered and measured, then centre it.
    useEffect(() => {
        if (!focusRequest) return;
        let attempts = 0;
        let timer: ReturnType<typeof setTimeout>;

        const tryFocus = () => {
            const node = getInternalNode(focusRequest.tableId);
            const width = node?.measured?.width;
            const height = node?.measured?.height;

            if (node && width && height) {
                const table = (
                    node.data as {
                        table?: { fields: { id: string }[] };
                    }
                ).table;
                const fieldIndex = focusRequest.fieldId
                    ? (table?.fields.findIndex(
                          (field) => field.id === focusRequest.fieldId
                      ) ?? -1)
                    : -1;
                const position = node.internals.positionAbsolute;
                const y =
                    fieldIndex >= 0
                        ? position.y +
                          TABLE_HEADER_HEIGHT +
                          fieldIndex * FIELD_ROW_HEIGHT +
                          FIELD_ROW_HEIGHT / 2
                        : position.y + height / 2;

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
        getInternalNode,
        setCenter,
        getViewport,
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
