import { describe, expect, it } from 'vitest';
import { BRAND_FULL, BRAND_MEDIUM, BRAND_SHORT, brandTitle } from '../brand';

describe('brand names', () => {
    it('uses the agreed short, medium and full names', () => {
        expect(BRAND_SHORT).toBe('LuxDBDiag');
        expect(BRAND_MEDIUM).toBe('LuxForge DB diagrams');
        expect(BRAND_FULL).toBe('LuxForge Database Diagrams built on ChartDB');
    });

    it('builds page titles with the full name', () => {
        expect(brandTitle()).toBe(BRAND_FULL);
        expect(brandTitle(null)).toBe(BRAND_FULL);
        expect(brandTitle('GAP')).toBe(`GAP | ${BRAND_FULL}`);
    });
});
