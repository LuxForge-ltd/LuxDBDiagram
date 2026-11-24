/**
 * Brand mark (LuxDBDiagram).
 *
 * Purpose: the LuxDBDiag word mark shown where ChartDB showed its logo image.
 * Scope: display only; the accent part follows the chosen accent colour.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { BRAND_FULL, BRAND_MEDIUM, BRAND_SHORT } from '@/lib/brand';

export interface BrandMarkProps {
    /** "medium" shows "LuxForge DB diagrams"; "short" shows "LuxDBDiag". */
    size?: 'short' | 'medium';
    className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
    size = 'medium',
    className,
}) => (
    <span
        className={cn(
            'whitespace-nowrap font-primary text-sm font-semibold leading-none tracking-tight text-foreground',
            className
        )}
        title={BRAND_FULL}
        aria-label={size === 'short' ? BRAND_SHORT : BRAND_MEDIUM}
    >
        {size === 'short' ? (
            <>
                <span className="text-pink-600">Lux</span>DBDiag
            </>
        ) : (
            <>
                <span className="text-pink-600">LuxForge</span> DB diagrams
            </>
        )}
    </span>
);
