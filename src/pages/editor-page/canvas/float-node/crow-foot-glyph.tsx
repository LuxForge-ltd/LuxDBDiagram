/**
 * Crow's foot glyph (LuxDBDiagram).
 *
 * Purpose: a miniature relationship line with a crow's foot symbol at both ends, drawn inside
 * each Float row so the cardinality of the relationship is readable without following the
 * line across the canvas.
 * Scope: drawing only; the symbols come from `deriveCrowFeet`.
 * Operational role: used by Float rows.
 *
 * At each end, the symbol nearest the table is the maximum (a bar for one, a crow's foot for
 * many) and the one further along the line is the minimum (a bar for one, a circle for zero).
 */
import React from 'react';
import type { CrowFootEnd } from '@/lib/areas/floats';

const WIDTH = 46;
const HEIGHT = 14;
const MID = HEIGHT / 2;

const describe: Record<CrowFootEnd, string> = {
    exactly_one: 'exactly one',
    zero_or_one: 'zero or one',
    one_or_many: 'one or many',
    zero_or_many: 'zero or many',
};

/**
 * Draws one end's symbol. `edge` is the x of the end of the line (where the table is) and
 * `inward` is +1 when the line runs to the right of it, -1 when it runs to the left.
 */
const EndSymbol: React.FC<{
    kind: CrowFootEnd;
    edge: number;
    inward: 1 | -1;
}> = ({ kind, edge, inward }) => {
    const at = (offset: number) => edge + inward * offset;
    const many = kind === 'one_or_many' || kind === 'zero_or_many';
    const zero = kind === 'zero_or_one' || kind === 'zero_or_many';

    return (
        <g>
            {many ? (
                // Crow's foot: three prongs opening towards the table.
                <>
                    <line x1={at(0)} y1={2} x2={at(6)} y2={MID} />
                    <line x1={at(0)} y1={MID} x2={at(6)} y2={MID} />
                    <line x1={at(0)} y1={HEIGHT - 2} x2={at(6)} y2={MID} />
                </>
            ) : (
                <line x1={at(3)} y1={2.5} x2={at(3)} y2={HEIGHT - 2.5} />
            )}
            {zero ? (
                <circle
                    cx={at(10.5)}
                    cy={MID}
                    r={2.6}
                    className="fill-background"
                />
            ) : (
                <line x1={at(9)} y1={2.5} x2={at(9)} y2={HEIGHT - 2.5} />
            )}
        </g>
    );
};

export interface CrowFootGlyphProps {
    /** Symbol at the left end (next to the left-hand column). */
    left: CrowFootEnd;
    /** Symbol at the right end (next to the right-hand column). */
    right: CrowFootEnd;
}

export const CrowFootGlyph: React.FC<CrowFootGlyphProps> = ({
    left,
    right,
}) => {
    const label = `${describe[left]} to ${describe[right]}`;
    return (
        <svg
            width={WIDTH}
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={label}
            className="shrink-0 stroke-current text-muted-foreground"
            strokeWidth={1.2}
            fill="none"
            data-left={left}
            data-right={right}
        >
            <title>{label}</title>
            <line x1={0} y1={MID} x2={WIDTH} y2={MID} />
            <EndSymbol kind={left} edge={0.5} inward={1} />
            <EndSymbol kind={right} edge={WIDTH - 0.5} inward={-1} />
        </svg>
    );
};
