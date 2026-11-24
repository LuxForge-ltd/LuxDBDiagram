/**
 * Area view context (LuxDBDiagram).
 *
 * Purpose: holds the editor's Area navigation state: which Area is open, where the user came
 * from (for "Back"), each Area's remembered viewport, and pending "go to this table/column"
 * requests.
 * Scope: UI state only. Area data itself lives in the ChartDB context and storage.
 * Operational role: read by the canvas (what to draw, where to look), the Area tabs and the
 * Areas side panel.
 */
import { createContext } from 'react';
import type { Viewport } from '@xyflow/react';
import { emptyFn } from '@/lib/utils';

/** Key used for the "All tables" view in viewport memory. */
export const ALL_TABLES_KEY = '__all_tables__';

/** A request to bring a table (and optionally one column) into view and highlight it. */
export interface AreaFocusRequest {
    /** Increments on every request, so repeating the same target still triggers. */
    requestId: number;
    tableId: string;
    fieldId?: string;
}

/** A short-lived highlight on a table or column, after navigation. */
export interface AreaHighlight {
    tableId: string;
    fieldId?: string;
    /** Increments so the same target can pulse again. */
    highlightId: number;
}

export interface AreaViewContext {
    /** The open Area, or null for the "All tables" view. */
    currentAreaViewId: string | null;
    /**
     * Opens an Area (or "All tables" with null). The previous view is pushed onto the back
     * history unless it is the same view.
     */
    selectAreaView: (
        areaViewId: string | null,
        options?: { focus?: Omit<AreaFocusRequest, 'requestId'> }
    ) => void;
    /** Areas visited before the current one, most recent last. */
    backHistory: (string | null)[];
    /** Returns to the previously viewed Area. */
    goBack: () => void;

    /** Remembers and recalls each view's viewport (pan and zoom). */
    saveViewport: (key: string, viewport: Viewport) => void;
    getViewport: (key: string) => Viewport | undefined;

    focusRequest: AreaFocusRequest | null;
    requestFocus: (target: Omit<AreaFocusRequest, 'requestId'>) => void;
    clearFocusRequest: () => void;

    highlight: AreaHighlight | null;
    setHighlight: (target: Omit<AreaHighlight, 'highlightId'> | null) => void;

    /** Tables being dragged on the canvas, so the table library can offer to take them back. */
    draggingTableIds: string[];
    setDraggingTableIds: (tableIds: string[]) => void;
}

export const areaViewContext = createContext<AreaViewContext>({
    currentAreaViewId: null,
    selectAreaView: emptyFn,
    backHistory: [],
    goBack: emptyFn,
    saveViewport: emptyFn,
    getViewport: () => undefined,
    focusRequest: null,
    requestFocus: emptyFn,
    clearFocusRequest: emptyFn,
    highlight: null,
    setHighlight: emptyFn,
    draggingTableIds: [],
    setDraggingTableIds: emptyFn,
});
