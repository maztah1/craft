/**
 * FaultInjector
 *
 * Introduces known, deterministic structural faults into generated file content
 * to verify that SyntaxValidator correctly detects each category of error.
 *
 * All mutations are immutable — the original GeneratedFile is never modified.
 *
 * Feature: generated-code-syntax-validation-property-test
 */

import type { GeneratedFile } from '@craft/types';

export type FaultType =
    | 'unclosed_brace'       // Remove the last `}` from a TS file
    | 'broken_string'        // Insert a raw newline after the first single-quote
    | 'invalid_json_key'     // Remove quotes from the first JSON key
    | 'truncated_json'       // Truncate JSON content to 50% of its length
    | 'duplicate_export'     // Append a duplicate `export const config = {};`
    | 'missing_semicolon_ts'; // Remove trailing semicolons from import statements

export class FaultInjector {
    /**
     * Inject a fault into a GeneratedFile and return a new object.
     * The original file is never mutated.
     */
    inject(file: GeneratedFile, fault: FaultType): GeneratedFile {
        let content = file.content;

        switch (fault) {
            case 'unclosed_brace': {
                const idx = content.lastIndexOf('}');
                if (idx >= 0) {
                    content = content.substring(0, idx) + content.substring(idx + 1);
                }
                break;
            }
            case 'broken_string': {
                const idx = content.indexOf("'");
                if (idx >= 0) {
                    content = content.substring(0, idx + 1) + '\n' + content.substring(idx + 1);
                }
                break;
            }
            case 'invalid_json_key': {
                content = content.replace(/"(\w+)":/, '$1:');
                break;
            }
            case 'truncated_json': {
                content = content.substring(0, Math.floor(content.length / 2));
                break;
            }
            case 'duplicate_export': {
                content = content + '\nexport const config = {};';
                break;
            }
            case 'missing_semicolon_ts': {
                content = content.replace(/^(import .+);$/gm, '$1');
                break;
            }
        }

        return { path: file.path, content, type: file.type };
    }
}

export const faultInjector = new FaultInjector();
