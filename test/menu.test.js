/**
 * The right-click pill: what it offers, and where it lands.
 *
 * Both are pure functions, so neither needs a document. The wiring that opens
 * it, aims it at what is under the pointer and closes it again is specified in
 * editing.test.js, where there is a designer to right-click on.
 */

import { describe, it, expect } from 'vitest';
import {
    menuActions, drawMenu, menuPosition, MENU_EDGE_GAP
} from '../src/designer/menu.js';


const actionsOf = (list) => list.filter(one => !one.separator).map(one => one.action);


describe('menuActions', () => {
    it('offers the selection actions when something is selected', () => {
        expect(actionsOf(menuActions({ count: 1, canPaste: true })))
            .toEqual(['duplicate-item', 'copy-items', 'paste-items', 'delete-item']);
    });

    /**
     * A right click that opens an empty pill reads as a broken menu; one that
     * opens a greyed Paste says the clipboard is empty, which is the answer.
     */
    it('offers paste alone on bare page, disabled when nothing was copied', () => {
        const [only, ...rest] = menuActions({ count: 0, canPaste: false });

        expect(rest).toEqual([]);
        expect(only.action).toBe('paste-items');
        expect(only.disabled).toBe(true);
    });

    it('enables paste once there is something to paste', () => {
        const [only] = menuActions({ count: 0, canPaste: true });

        expect(only.disabled).toBe(false);
    });

    it('says how many it would act on', () => {
        const labels = Object.fromEntries(
            menuActions({ count: 3 })
                .filter(one => one.action)
                .map(one => [one.action, one.label]));

        expect(labels['duplicate-item']).toBe('Duplicate 3 items');
        expect(labels['delete-item']).toBe('Delete 3 items');

        /** the clipboard has its own count, so paste never claims the selection's */
        expect(labels['paste-items']).toBe('Paste');
    });

    it('does not number a single item', () => {
        const [duplicate] = menuActions({ count: 1 });

        expect(duplicate.label).toBe('Duplicate');
    });

    it('rules delete off from the rest', () => {
        const list = menuActions({ count: 1 });
        const at = list.findIndex(one => one.separator);

        expect(at).toBeGreaterThan(0);
        expect(list[at + 1].action).toBe('delete-item');
        expect(list.at(-1).tone).toBe('danger');
    });

    it('survives being asked for nothing in particular', () => {
        expect(actionsOf(menuActions())).toEqual(['paste-items']);
    });
});


describe('menuActions, with something to format', () => {
    it('puts Format first, ruled off from the rest', () => {
        const list = menuActions({ count: 1, format: { label: 'Format…' } });

        expect(list[0]).toMatchObject({ action: 'edit-format', label: 'Format…', glyph: 'format' });
        expect(list[1].separator).toBe(true);
        expect(actionsOf(list)).toEqual(
            ['edit-format', 'duplicate-item', 'copy-items', 'paste-items', 'delete-item']);
    });

    it('carries the column it formats', () => {
        const [format] = menuActions({ count: 1, format: { label: 'Format "Price" column…', index: 2 } });

        expect(format.index).toBe(2);
    });

    it('offers no Format with nothing selected', () => {
        expect(actionsOf(menuActions({ count: 0, format: { label: 'Format…' } })))
            .toEqual(['paste-items']);
    });
});


describe('drawMenu', () => {
    it('names every action on its row, with its keys', () => {
        const html = drawMenu(menuActions({ count: 1, canPaste: true }));

        for (const [label, keys] of [['Duplicate', 'Ctrl+D'], ['Copy', 'Ctrl+C'],
            ['Paste', 'Ctrl+V'], ['Delete', 'Del']]) {
            expect(html).toContain(`<span class="dz-menu-label">${label}</span>`);
            expect(html).toContain(`<kbd class="dz-menu-keys">${keys}</kbd>`);
        }
    });

    it("carries a Format entry's column to the action", () => {
        const html = drawMenu(menuActions({ count: 1, format: { label: 'F', index: 2 } }));

        expect(html).toMatch(/data-action="edit-format"\s+data-index="2"/);
    });

    it('draws a menu of buttons, each named for a screen reader', () => {
        const html = drawMenu(menuActions({ count: 1, canPaste: true }));

        expect(html).toContain('role="menu"');
        expect((html.match(/role="menuitem"/g) || [])).toHaveLength(4);
        expect((html.match(/aria-label="/g) || []).length).toBeGreaterThanOrEqual(4);
    });

    it('puts the shortcut in the tooltip, where it can be found', () => {
        const html = drawMenu(menuActions({ count: 1 }));

        expect(html).toContain('title="Duplicate (ctrl+D, or alt-drag)"');
        expect(html).toContain('title="Copy (ctrl+C)"');
        expect(html).toContain('title="Delete (del)"');
    });

    it('disables what cannot be done rather than hiding it', () => {
        const html = drawMenu(menuActions({ count: 1, canPaste: false }));

        expect(html).toMatch(/data-action="paste-items"[\s\S]*?disabled/);
    });

    it('marks the destructive one, so it can be drawn apart', () => {
        const html = drawMenu(menuActions({ count: 1 }));

        expect(html).toContain('is-danger');
        expect(html).toContain('dz-menu-sep');
    });

    it('escapes what it is given, since markup is markup', () => {
        const html = drawMenu([
            { action: 'x"><script>', glyph: 'copy', label: '<b>', hint: '&' }
        ]);

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;b&gt;');
    });
});


describe('menuPosition', () => {
    const bounds = { width: 800, height: 600 };
    const size = { width: 160, height: 40 };

    it('sits where the pointer is when there is room', () => {
        expect(menuPosition({ x: 100, y: 100 }, size, bounds))
            .toEqual({ left: 100, top: 100 });
    });

    it('slides back inside the right edge rather than hanging off it', () => {
        const { left } = menuPosition({ x: 780, y: 100 }, size, bounds);

        expect(left).toBe(800 - 160 - MENU_EDGE_GAP);
    });

    it('slides back inside the bottom edge too', () => {
        const { top } = menuPosition({ x: 100, y: 595 }, size, bounds);

        expect(top).toBe(600 - 40 - MENU_EDGE_GAP);
    });

    it('keeps a gap at the top and left', () => {
        expect(menuPosition({ x: -50, y: 0 }, size, bounds))
            .toEqual({ left: MENU_EDGE_GAP, top: MENU_EDGE_GAP });
    });

    /**
     * A pill wider than the area it is drawn into has no good place, but it
     * must still have a defined one - and the near edge is the one that keeps
     * its first button reachable.
     */
    it('favours the near edge when it cannot fit at all', () => {
        const at = menuPosition({ x: 300, y: 300 }, { width: 900, height: 40 },
            bounds);

        expect(at.left).toBe(MENU_EDGE_GAP);
    });
});
