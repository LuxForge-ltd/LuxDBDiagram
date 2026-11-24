/**
 * Area view provider (LuxDBDiagram).
 *
 * Purpose: implements Area navigation state for the editor.
 * Scope: UI state only; Areas themselves come from the ChartDB context.
 * Operational role: wraps the editor so the canvas, Area tabs and Areas panel share one
 * notion of "the open Area". The open Area is remembered per diagram in browser storage,
 * which is a convenience only: if storage is unavailable the editor opens on "All tables".
 */
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { Viewport } from '@xyflow/react';
import type {
    AreaFocusRequest,
    AreaHighlight,
    AreaViewContext,
} from './area-view-context';
import { areaViewContext } from './area-view-context';
import { useChartDB } from '@/hooks/use-chartdb';

const STORAGE_PREFIX = 'luxdb.currentArea.';
const MAX_BACK_HISTORY = 20;

/** Reads the remembered Area for a diagram; returns null when unavailable. */
const readRememberedArea = (diagramId: string): string | null => {
    try {
        return window.localStorage.getItem(STORAGE_PREFIX + diagramId);
    } catch {
        return null;
    }
};

/** Remembers the open Area for a diagram; failures are ignored (convenience only). */
const rememberArea = (diagramId: string, areaViewId: string | null) => {
    try {
        if (areaViewId) {
            window.localStorage.setItem(STORAGE_PREFIX + diagramId, areaViewId);
        } else {
            window.localStorage.removeItem(STORAGE_PREFIX + diagramId);
        }
    } catch {
        // Private windows and blocked storage simply don't remember the Area.
    }
};

export const AreaViewProvider: React.FC<React.PropsWithChildren> = ({
    children,
}) => {
    const { diagramId, areaViews } = useChartDB();
    const [currentAreaViewId, setCurrentAreaViewId] = useState<string | null>(
        null
    );
    const [backHistory, setBackHistory] = useState<(string | null)[]>([]);
    const [focusRequest, setFocusRequest] = useState<AreaFocusRequest | null>(
        null
    );
    const [highlight, setHighlightState] = useState<AreaHighlight | null>(null);
    const [draggingTableIds, setDraggingTableIds] = useState<string[]>([]);
    const viewports = useRef(new Map<string, Viewport>());
    const counter = useRef(0);
    const loadedDiagramId = useRef<string | null>(null);
    // Mirrors of the state, read by the navigation callbacks so they stay pure and stable.
    const currentRef = useRef<string | null>(null);
    const historyRef = useRef<(string | null)[]>([]);

    const setCurrent = useCallback((areaViewId: string | null) => {
        currentRef.current = areaViewId;
        setCurrentAreaViewId(areaViewId);
    }, []);

    const setHistory = useCallback((history: (string | null)[]) => {
        historyRef.current = history;
        setBackHistory(history);
    }, []);

    // A different diagram starts with a clean navigation state and its remembered Area.
    useEffect(() => {
        if (!diagramId || loadedDiagramId.current === diagramId) return;
        loadedDiagramId.current = diagramId;
        viewports.current = new Map();
        setHistory([]);
        setFocusRequest(null);
        setHighlightState(null);
        setCurrent(readRememberedArea(diagramId));
    }, [diagramId, setCurrent, setHistory]);

    // If the open Area disappears (deleted, or not in this diagram), fall back to "All tables",
    // and forget history entries for Areas that no longer exist.
    useEffect(() => {
        const exists = (id: string | null) =>
            id === null || areaViews.some((view) => view.id === id);

        if (!exists(currentRef.current)) {
            setCurrent(null);
        }
        const valid = historyRef.current.filter(exists);
        if (valid.length !== historyRef.current.length) {
            setHistory(valid);
        }
    }, [areaViews, setCurrent, setHistory]);

    useEffect(() => {
        if (diagramId && loadedDiagramId.current === diagramId) {
            rememberArea(diagramId, currentAreaViewId);
        }
    }, [diagramId, currentAreaViewId]);

    const requestFocus: AreaViewContext['requestFocus'] = useCallback(
        (target) => {
            counter.current += 1;
            setFocusRequest({
                ...target,
                // Unless told otherwise, focus in the view that is open now.
                areaViewId:
                    target.areaViewId === undefined
                        ? currentRef.current
                        : target.areaViewId,
                requestId: counter.current,
            });
        },
        []
    );

    const selectAreaView: AreaViewContext['selectAreaView'] = useCallback(
        (areaViewId, options) => {
            const previous = currentRef.current;
            if (previous !== areaViewId) {
                setHistory(
                    [...historyRef.current, previous].slice(-MAX_BACK_HISTORY)
                );
                setCurrent(areaViewId);
            }
            if (options?.focus) {
                requestFocus({ ...options.focus, areaViewId });
            }
        },
        [requestFocus, setCurrent, setHistory]
    );

    const goBack: AreaViewContext['goBack'] = useCallback(() => {
        const history = historyRef.current;
        if (history.length === 0) return;
        setHistory(history.slice(0, -1));
        setCurrent(history[history.length - 1]);
    }, [setCurrent, setHistory]);

    const saveViewport: AreaViewContext['saveViewport'] = useCallback(
        (key, viewport) => {
            viewports.current.set(key, viewport);
        },
        []
    );

    const getViewport: AreaViewContext['getViewport'] = useCallback(
        (key) => viewports.current.get(key),
        []
    );

    const clearFocusRequest = useCallback(() => setFocusRequest(null), []);

    const setHighlight: AreaViewContext['setHighlight'] = useCallback(
        (target) => {
            counter.current += 1;
            setHighlightState(
                target ? { ...target, highlightId: counter.current } : null
            );
        },
        []
    );

    const value = useMemo<AreaViewContext>(
        () => ({
            currentAreaViewId,
            selectAreaView,
            backHistory,
            goBack,
            saveViewport,
            getViewport,
            focusRequest,
            requestFocus,
            clearFocusRequest,
            highlight,
            setHighlight,
            draggingTableIds,
            setDraggingTableIds,
        }),
        [
            currentAreaViewId,
            selectAreaView,
            backHistory,
            goBack,
            saveViewport,
            getViewport,
            focusRequest,
            requestFocus,
            clearFocusRequest,
            highlight,
            setHighlight,
            draggingTableIds,
        ]
    );

    return (
        <areaViewContext.Provider value={value}>
            {children}
        </areaViewContext.Provider>
    );
};
