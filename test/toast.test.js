/**
 * The corner the designer says things from.
 *
 * What a toast holds and when a dismissal still covers it are pure functions,
 * specified here without a document. Where it is put, and that it no longer
 * pushes the page down the canvas, is specified in editing.test.js.
 */

import { describe, it, expect } from 'vitest';
import { drawProblems, sameIssues } from '../src/designer/toast.js';


describe('sameIssues', () => {
    it('covers the same findings, in the same order', () => {
        expect(sameIssues(['a', 'b'], ['a', 'b'])).toBe(true);
    });

    it('does not cover a finding that has arrived since', () => {
        expect(sameIssues(['a', 'b'], ['a'])).toBe(false);
    });

    it('does not cover a finding that has gone', () => {
        expect(sameIssues(['a'], ['a', 'b'])).toBe(false);
    });

    /** validate.js reports fields in a fixed order, so order is content */
    it('does not cover the same findings in a different order', () => {
        expect(sameIssues(['a', 'b'], ['b', 'a'])).toBe(false);
    });

    it('treats nothing dismissed as covering nothing', () => {
        expect(sameIssues(['a'], null)).toBe(false);
        expect(sameIssues(['a'], undefined)).toBe(false);
    });

    it('survives being handed something that is not a list', () => {
        expect(sameIssues('a', 'a')).toBe(false);
        expect(sameIssues(null, null)).toBe(false);
    });
});


describe('drawProblems', () => {
    it('names every finding', () => {
        const html = drawProblems(['page.width is required', 'bands must be a list']);

        expect(html).toContain('page.width is required');
        expect(html).toContain('bands must be a list');
        expect((html.match(/<li>/g) || [])).toHaveLength(2);
    });

    it('announces itself, since it arrives without being asked for', () => {
        expect(drawProblems(['x'])).toContain('role="alert"');
    });

    it('can be closed', () => {
        const html = drawProblems(['x']);

        expect(html).toContain('data-action="dismiss-problems"');
        expect(html).toMatch(/aria-label="Dismiss/);
    });

    it('says how many it is closing when there are several', () => {
        expect(drawProblems(['a', 'b', 'c'])).toContain('aria-label="Dismiss 3 problems"');
        expect(drawProblems(['a'])).toContain('aria-label="Dismiss"');
    });

    /** a finding quotes field names out of a hand-written layout file */
    it('escapes what the validator handed it', () => {
        const html = drawProblems(['<script>alert(1)</script>']);

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('keeps the class the designer has always found it by', () => {
        expect(drawProblems(['x'])).toContain('dz-problems');
    });
});
