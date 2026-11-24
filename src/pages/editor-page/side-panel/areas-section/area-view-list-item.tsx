/**
 * Area list item (LuxDBDiagram).
 *
 * Purpose: one Area in the Areas panel: open it, rename it, change its colour, reorder it
 * (drag handle) and delete it.
 * Scope: Area metadata only. Deleting an Area never deletes tables.
 * Operational role: rendered by `AreaViewsSection`.
 */
import React, { useCallback, useState } from 'react';
import {
    Check,
    EllipsisVertical,
    GripVertical,
    Pencil,
    Trash2,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { useClickAway } from 'react-use';
import type { AreaView } from '@/lib/domain/area-view';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { useAlert } from '@/context/alert-context/alert-context';
import { Input } from '@/components/input/input';
import { ColorPicker } from '@/components/color-picker/color-picker';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/dropdown-menu/dropdown-menu';
import { ListItemHeaderButton } from '@/pages/editor-page/side-panel/list-item-header-button/list-item-header-button';
import { cn } from '@/lib/utils';
import { uniqueAreaName } from '@/lib/areas/area-view-ops';

export interface AreaViewListItemProps {
    areaView: AreaView;
    tableCount: number;
}

export const AreaViewListItem: React.FC<AreaViewListItemProps> = ({
    areaView,
    tableCount,
}) => {
    const { t } = useTranslation();
    const { areaViews, updateAreaViews, removeAreaViews, readonly } =
        useChartDB();
    const { currentAreaViewId, selectAreaView } = useAreaView();
    const { showAlert } = useAlert();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(areaView.name);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const active = currentAreaViewId === areaView.id;

    const { attributes, listeners, setNodeRef, transform, transition } =
        useSortable({ id: areaView.id, disabled: readonly });

    const saveName = useCallback(() => {
        if (!editing) return;
        setEditing(false);
        const trimmed = name.trim();
        if (!trimmed || trimmed === areaView.name) {
            setName(areaView.name);
            return;
        }
        // Area names stay unique: a clash gets a number appended.
        const others = areaViews.filter((view) => view.id !== areaView.id);
        const unique = uniqueAreaName(others, trimmed);
        setName(unique);
        updateAreaViews([{ id: areaView.id, attributes: { name: unique } }]);
    }, [editing, name, areaView, areaViews, updateAreaViews]);

    useClickAway(inputRef, saveName);

    const handleDelete = useCallback(() => {
        showAlert({
            title: t('luxdb.areas.delete_confirm_title', {
                name: areaView.name,
            }),
            description: t('luxdb.areas.delete_confirm_description'),
            actionLabel: t('luxdb.areas.actions.delete'),
            closeLabel: t('luxdb.common.cancel'),
            onAction: () => removeAreaViews([areaView.id]),
        });
    }, [showAlert, t, areaView, removeAreaViews]);

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
                borderLeftWidth: '6px',
                borderLeftColor: areaView.color,
            }}
            {...attributes}
            className={cn(
                'w-full rounded-md border border-border',
                active ? 'bg-accent/60' : 'hover:bg-accent/5'
            )}
            data-testid={`area-list-item-${areaView.name}`}
        >
            <div className="group flex h-11 items-center gap-1 overflow-hidden p-2">
                {!readonly ? (
                    <div
                        className="flex cursor-move items-center justify-center"
                        {...listeners}
                    >
                        <GripVertical className="size-4 text-muted-foreground" />
                    </div>
                ) : null}

                {editing ? (
                    <Input
                        ref={inputRef}
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') saveName();
                            if (e.key === 'Escape') {
                                setName(areaView.name);
                                setEditing(false);
                            }
                        }}
                        className="h-7 flex-1 focus-visible:ring-0"
                    />
                ) : (
                    <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left"
                        onClick={() => selectAreaView(areaView.id)}
                        onDoubleClick={() => !readonly && setEditing(true)}
                    >
                        <span className="truncate text-sm font-medium">
                            {areaView.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t('luxdb.areas.table_count', {
                                count: tableCount,
                            })}
                        </span>
                    </button>
                )}

                <div className="flex shrink-0 items-center gap-1">
                    {editing ? (
                        <ListItemHeaderButton onClick={saveName}>
                            <Check />
                        </ListItemHeaderButton>
                    ) : null}
                    {!readonly ? (
                        <>
                            <ColorPicker
                                color={areaView.color}
                                onChange={(color) =>
                                    updateAreaViews([
                                        {
                                            id: areaView.id,
                                            attributes: { color },
                                        },
                                    ])
                                }
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger>
                                    <ListItemHeaderButton>
                                        <EllipsisVertical />
                                    </ListItemHeaderButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-fit min-w-40">
                                    <DropdownMenuLabel>
                                        {t('luxdb.areas.actions.title')}
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="flex justify-between gap-4"
                                        onClick={() => setEditing(true)}
                                    >
                                        {t('luxdb.areas.actions.rename')}
                                        <Pencil className="size-3.5" />
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="flex justify-between gap-4 !text-red-700"
                                        onClick={handleDelete}
                                    >
                                        {t('luxdb.areas.actions.delete')}
                                        <Trash2 className="size-3.5 text-red-700" />
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
};
