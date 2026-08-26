/**
 * Spec 2.1: nothing under engine/ or render/ may import React.
 * If this file ever needs a React import to pass, something has leaked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function filesUnder(dir) {
    return readdirSync(join(SRC, dir), { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.js'))
        .map(e => join(SRC, dir, e.name));
}

describe('framework-free boundary', () => {
    for (const dir of ['engine', 'render']) {
        it(`${dir}/ imports no React`, () => {
            for (const file of filesUnder(dir)) {
                const source = readFileSync(file, 'utf8');
                expect(source, file).not.toMatch(/from\s+['"]react/);
                expect(source, file).not.toMatch(/require\(['"]react/);
            }
        });
    }

    it('engine/ and render/ import no fixtures', () => {
        for (const file of [...filesUnder('engine'), ...filesUnder('render')]) {
            const source = readFileSync(file, 'utf8');
            expect(source, file).not.toMatch(/fixtures/);
        }
    });

    it('the package entry pulls in no fixtures and no React', () => {
        const source = readFileSync(join(SRC, 'index.js'), 'utf8');
        expect(source).not.toMatch(/fixtures/);
        expect(source).not.toMatch(/from\s+['"]react/);
    });

    it('the package entry has no import-time side effects', async () => {
        const entry = await import('../src/index.js');
        expect(typeof entry.buildPages).toBe('function');
        expect(typeof entry.render).toBe('function');
    });
});
