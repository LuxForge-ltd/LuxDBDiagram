import React, { useState } from 'react';
import { TableDBML } from './table-dbml/table-dbml';
// LuxDBDiagram: the panel can show one Area's file instead of the whole schema.
import { AreaFileSelect, AreaFileView, WHOLE_SCHEMA } from './area-file-view';

export interface DBMLSectionProps {}

export const DBMLSection: React.FC<DBMLSectionProps> = () => {
    const [shownFile, setShownFile] = useState(WHOLE_SCHEMA);

    return (
        <section
            className="flex flex-1 flex-col overflow-hidden px-2"
            data-vaul-no-drag
        >
            <AreaFileSelect value={shownFile} onChange={setShownFile} />
            <div className="flex flex-1 flex-col overflow-hidden">
                {shownFile === WHOLE_SCHEMA ? (
                    <TableDBML />
                ) : (
                    <AreaFileView fileKey={shownFile} />
                )}
            </div>
        </section>
    );
};
