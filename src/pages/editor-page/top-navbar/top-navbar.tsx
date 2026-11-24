import React, { useCallback } from 'react';
import { BrandMark } from '@/components/brand-mark/brand-mark';
import { DiagramName } from './diagram-name';
import { LastSaved } from './last-saved';
import { LanguageNav } from './language-nav/language-nav';
import { Menu } from './menu/menu';

export interface TopNavbarProps {}

export const TopNavbar: React.FC<TopNavbarProps> = () => {
    const renderStars = useCallback(() => {
        return (
            <iframe
                src={`https://ghbtns.com/github-btn.html?user=LuxForge-ltd&repo=LuxDBDiagram&type=star&size=large&text=false`}
                width="40"
                height="30"
                title="LuxDBDiagram source on GitHub"
            ></iframe>
        );
    }, []);

    return (
        <nav className="flex flex-col justify-between border-b px-3 md:h-12 md:flex-row md:items-center md:px-4">
            <div className="flex flex-1 flex-col justify-between gap-x-1 md:flex-row md:justify-normal">
                <div className="flex items-center justify-between pt-[8px] font-primary md:py-[10px]">
                    <a href="/" className="cursor-pointer" rel="noreferrer">
                        <BrandMark />
                    </a>
                </div>
                <Menu />
            </div>
            <DiagramName />
            <div className="hidden flex-1 items-center justify-end gap-2 sm:flex">
                <LastSaved />
                {renderStars()}
                <LanguageNav />
            </div>
        </nav>
    );
};
