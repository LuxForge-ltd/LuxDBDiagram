/**
 * Settings menu (LuxDBDiagram).
 *
 * Purpose: the top bar's Settings menu, starting with the accent colour.
 * Scope: per-browser preferences; nothing here changes a diagram.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    MenubarContent,
    MenubarLabel,
    MenubarMenu,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarSeparator,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarTrigger,
} from '@/components/menubar/menubar';
import { useAccent } from '@/hooks/use-accent';
import { ACCENT_OPTIONS, isAccentColor } from '@/lib/accent/accent-palettes';

export const SettingsMenu: React.FC = () => {
    const { t } = useTranslation();
    const { accent, setAccent } = useAccent();

    return (
        <MenubarMenu>
            <MenubarTrigger>{t('luxdb.settings.settings')}</MenubarTrigger>
            <MenubarContent>
                <MenubarSub>
                    <MenubarSubTrigger>
                        <span
                            className="mr-2 inline-block size-3 rounded-full bg-pink-600"
                            aria-hidden
                        />
                        {t('luxdb.settings.accent_colour')}
                    </MenubarSubTrigger>
                    <MenubarSubContent>
                        <MenubarLabel className="text-xs font-normal text-muted-foreground">
                            {t('luxdb.settings.accent_hint')}
                        </MenubarLabel>
                        <MenubarSeparator />
                        <MenubarRadioGroup
                            value={accent}
                            onValueChange={(value) => {
                                if (isAccentColor(value)) {
                                    setAccent(value);
                                }
                            }}
                        >
                            {ACCENT_OPTIONS.map((option) => (
                                <MenubarRadioItem
                                    key={option.id}
                                    value={option.id}
                                    data-testid={`accent-${option.id}`}
                                >
                                    <span
                                        className="mr-2 inline-block size-3 rounded-full"
                                        style={{
                                            backgroundColor: option.shades[600],
                                        }}
                                        aria-hidden
                                    />
                                    {t(
                                        `luxdb.settings.accents.${option.labelKey}`
                                    )}
                                </MenubarRadioItem>
                            ))}
                        </MenubarRadioGroup>
                    </MenubarSubContent>
                </MenubarSub>
            </MenubarContent>
        </MenubarMenu>
    );
};
