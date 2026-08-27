/**
 * fields.js says what can be edited about an item, and how a typed value gets
 * onto it.
 *
 * It is plain data and pure functions, so the fiddly half - which fields a
 * table has, what an empty box means, what happens when someone types "abc"
 * into a font size - is specified without a browser. panel.js draws these and
 * decides nothing, the same division select.js has with geometry.js.
 *
 * The paths ("style.fontSize") are the layout file's own shape from spec 3.3.
 * Nothing here invents a field the engine does not read.
 */


/**
 * Spec 10 left the font list open, and closes it here: web-safe families only.
 *
 * The engine measures text with canvas measureText against this exact string
 * (spec 4.3), so a family the browser does not have is measured as a fallback
 * and paginates to a different page count than it prints. Web-safe stacks
 * remove loading, embedding, and that whole class of bug at once.
 */
export const FONT_STACKS = [
    { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
    { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
    { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { label: 'Trebuchet', value: '"Trebuchet MS", Helvetica, sans-serif' },
    { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Times', value: '"Times New Roman", Times, serif' },
    { label: 'Courier', value: '"Courier New", Courier, monospace' }
];

const WEIGHTS = [
    { label: 'Regular', value: 'normal' },
    { label: 'Bold', value: 'bold' }
];

const STYLES = [
    { label: 'Upright', value: 'normal' },
    { label: 'Italic', value: 'italic' }
];

const ALIGNMENTS = [
    { label: 'Left', value: 'left' },
    { label: 'Centre', value: 'center' },
    { label: 'Right', value: 'right' }
];


const num = (key, label, extra = {}) =>
    ({ key, label, type: 'number', ...extra });


/**
 * What a table column carries (spec 3.3). The same descriptor shape again, read
 * and written against the column object rather than the item - which is all
 * readField and writeField need, since they walk a path on whatever they get.
 */
export const COLUMN_FIELDS = [
    { key: 'field', label: 'Field', type: 'text' },
    { key: 'label', label: 'Label', type: 'text' },
    { key: 'width', label: 'Width', type: 'number', min: 1 },
    { key: 'align', label: 'Align', type: 'choice', options: ALIGNMENTS }
];


/**
 * The editable properties of an item, grouped the way the panel shows them.
 *
 * A table has no height row: its height is the header plus its rows (spec 3.3),
 * so a box to type one into would be a promise the layout file cannot keep -
 * the same reason geometry.js gives it no south handle.
 *
 * @param {object} item a layout item
 * @returns {object[]} `{ title, fields }` sections
 */
export function fieldsFor(item) {
    if (!item) return [];

    const box = {
        title: 'Position and size',
        fields: [
            num('x', 'X'),
            num('y', 'Y'),
            num('w', 'Width', { min: 1 }),
            ...(item.type === 'table' ? [] : [num('h', 'Height', { min: 1 })])
        ]
    };

    if (item.type === 'table') {
        return [
            box,
            {
                title: 'Rows',
                fields: [
                    num('rowHeight', 'Row height', { min: 1 }),
                    num('headerHeight', 'Header height', { min: 1 }),
                    { key: 'showHeader', label: 'Show header', type: 'toggle' }
                ]
            },
            {
                title: 'Appearance',
                fields: [
                    num('style.fontSize', 'Font size', { min: 1 }),
                    { key: 'style.color', label: 'Text', type: 'color' },
                    { key: 'style.borderColor', label: 'Borders', type: 'color' }
                ]
            }
        ];
    }

    return [
        {
            title: 'Content',
            fields: [{
                key: 'value', label: 'Value', type: 'textarea',
                hint: 'Placeholders in braces: {customer.name}, {page}, {sum(amount)}'
            }]
        },
        box,
        {
            title: 'Type',
            fields: [
                { key: 'style.fontFamily', label: 'Font', type: 'choice', options: FONT_STACKS },
                num('style.fontSize', 'Size', { min: 1 }),
                { key: 'style.fontWeight', label: 'Weight', type: 'choice', options: WEIGHTS },
                { key: 'style.fontStyle', label: 'Style', type: 'choice', options: STYLES },
                { key: 'style.align', label: 'Align', type: 'choice', options: ALIGNMENTS },
                { key: 'style.color', label: 'Colour', type: 'color' }
            ]
        }
    ];
}


/**
 * Page sizes worth having by name. Spec 6.2: pixels throughout, and these are
 * the two figures it gives - A4 and Letter at screen resolution, which is what
 * browser print produces.
 */
export const PAGE_PRESETS = [
    { label: 'A4', width: 794, height: 1123 },
    { label: 'Letter', width: 816, height: 1056 }
];


/**
 * The report's own properties - what the rail shows when no item is selected.
 *
 * Deliberately the same descriptor shape as an item's, so panel.js draws both
 * with one set of controls. readField and writeField walk a path on whatever
 * object they are handed, and a layout is just another object.
 *
 * @param {object|null} layout
 * @returns {object[]} `{ title, fields }` sections
 */
export function reportFields(layout) {
    if (!layout) return [];

    return [
        {
            title: 'Report',
            fields: [
                { key: 'name', label: 'Name', type: 'text' },
                {
                    key: 'dataset', label: 'Dataset', type: 'text', nullable: true,
                    hint: 'The key in the data object that drives the rows'
                },
                {
                    key: 'groupBy', label: 'Group by', type: 'text', nullable: true,
                    hint: 'A field name, or blank for no grouping'
                }
            ]
        },
        {
            title: 'Page',
            fields: [
                num('page.width', 'Width', { min: 1 }),
                num('page.height', 'Height', { min: 1 })
            ]
        },
        {
            title: 'Margins',
            fields: [
                num('page.margin.top', 'Top', { min: 0 }),
                num('page.margin.right', 'Right', { min: 0 }),
                num('page.margin.bottom', 'Bottom', { min: 0 }),
                num('page.margin.left', 'Left', { min: 0 })
            ]
        }
    ];
}


export function allReportFields(layout) {
    return reportFields(layout).flatMap(section => section.fields);
}


/** every field of every section, flat */
export function allFields(item) {
    return fieldsFor(item).flatMap(section => section.fields);
}


function pathOf(key) {
    return key.split('.');
}


/**
 * The value to show in a field's control.
 * @param {object} item
 * @param {object} field
 * @returns {*} undefined when the item does not carry it
 */
export function readField(item, field) {
    let node = item;

    for (const step of pathOf(field.key)) {
        if (node == null) return undefined;
        node = node[step];
    }

    return node;
}


/**
 * Puts a typed value onto an item, and says whether anything changed.
 *
 * Refusing a value rather than storing a bad one is deliberate: these controls
 * are bound live, so an empty box is a half-typed number, not a request for
 * NaN. The field keeps its last good value and the canvas stops flickering
 * between drawn and blank while someone retypes a width.
 *
 * @param {object} item mutated in place; it is the layout the host will be given
 * @param {object} field
 * @param {*} raw whatever the control produced
 * @returns {boolean} true when the item changed
 */
export function writeField(item, field, raw) {
    const value = coerce(field, raw);
    if (value === undefined) return false;

    const path = pathOf(field.key);
    const last = path.pop();

    let node = item;
    for (const step of path) {
        if (node[step] == null || typeof node[step] !== 'object') node[step] = {};
        node = node[step];
    }

    if (node[last] === value) return false;

    node[last] = value;
    return true;
}


/**
 * @returns {*} undefined for a value the field will not accept
 */
function coerce(field, raw) {
    if (field.type === 'toggle') return Boolean(raw);

    if (field.type === 'number') {
        if (raw === '' || raw === null || raw === undefined) return undefined;

        const value = Number(raw);
        if (!Number.isFinite(value)) return undefined;

        return field.min != null ? Math.max(value, field.min) : value;
    }

    if (raw === null || raw === undefined) return undefined;

    /**
     * `groupBy` and `dataset` are "a field name, or nothing" (spec 3.1), and
     * nothing is null - an empty string would be a dataset named "", which the
     * engine would then go looking for.
     */
    if (field.nullable && raw === '') return null;

    return String(raw);
}
