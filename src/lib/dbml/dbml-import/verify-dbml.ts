import { Parser } from '@dbml/core';
import { preprocessDBML, sanitizeDBML } from './dbml-import';
import type { DBMLError } from './dbml-import-error';
import {
    DBMLValidationError,
    parseDBMLError,
    validateArrayTypesForDatabase,
} from './dbml-import-error';
import { extractAreaBlocks } from '@/lib/areas/area-dbml';
import type { DatabaseType } from '@/lib/domain/database-type';

export const verifyDBML = (
    content: string,
    {
        databaseType,
    }: {
        databaseType: DatabaseType;
    }
):
    | {
          hasError: true;
          error: unknown;
          parsedError?: DBMLError;
          errorText: string;
      }
    | {
          hasError: false;
      } => {
    try {
        // LuxDBDiagram: lift out Area blocks first (line numbers are kept), reporting any
        // malformed block, so ordinary DBML validation sees only the schema.
        const extraction = extractAreaBlocks(content);
        const blocking = extraction.issues.find(
            (issue) => issue.severity === 'error'
        );
        if (blocking) {
            throw new DBMLValidationError(
                blocking.message,
                blocking.line ?? 1,
                blocking.column ?? 1
            );
        }
        const schemaContent = extraction.content;

        // Validate array types BEFORE preprocessing (preprocessing removes [])
        validateArrayTypesForDatabase(schemaContent, databaseType);

        const { content: preprocessedContent } = preprocessDBML(schemaContent);
        const sanitizedContent = sanitizeDBML(preprocessedContent);

        const parser = new Parser();
        parser.parse(sanitizedContent, 'dbmlv2');
    } catch (e) {
        const parsedError = parseDBMLError(e);
        if (parsedError) {
            return {
                hasError: true,
                parsedError: parsedError,
                error: e,
                errorText: parsedError.message,
            };
        } else {
            if (e instanceof Error) {
                return {
                    hasError: true,
                    error: e,
                    errorText: e.message,
                };
            }

            return {
                hasError: true,
                error: e,
                errorText: JSON.stringify(e),
            };
        }
    }

    return {
        hasError: false,
    };
};
