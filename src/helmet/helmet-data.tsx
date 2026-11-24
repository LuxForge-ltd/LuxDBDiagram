import React from 'react';
import { Helmet } from 'react-helmet-async';
import { BRAND_FULL, BRAND_URL } from '@/lib/brand';

// LuxDBDiagram: page metadata names LuxDBDiag; ChartDB is credited in the full title.
const DESCRIPTION =
    "LuxForge's database diagram editor for producing LuxForge schemas: one DBML schema shown as Areas, with Dupes, Floats and schema files. Built on ChartDB.";

export const HelmetData: React.FC = () => (
    <Helmet>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={BRAND_FULL} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={BRAND_URL} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={BRAND_FULL} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <title>{BRAND_FULL}</title>
    </Helmet>
);
