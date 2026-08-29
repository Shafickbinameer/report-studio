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

const ORIENTATIONS = [
    { label: 'Horizontal', value: 'horizontal' },
    { label: 'Vertical', value: 'vertical' }
];

/**
 * The four CSS border styles that read as a rule. `double` needs 3px before a
 * browser can draw two lines and a gap, which the thickness field allows for.
 */
const LINE_STYLES = [
    { label: 'Solid', value: 'solid' },
    { label: 'Dashed', value: 'dashed' },
    { label: 'Dotted', value: 'dotted' },
    { label: 'Double', value: 'double' }
];

/**
 * The same, plus off. A table's grid is often better away entirely - a column
 * of figures usually reads more easily without one - which is not a thing a
 * line can be, so the two lists are not shared.
 */
const RULE_STYLES = [...LINE_STYLES, { label: 'None', value: 'none' }];


const num = (key, label, extra = {}) =>
    ({ key, label, type: 'number', ...extra });


/**
 * The widest rule a table can be drawn with and still measure what it declares.
 * The same figure items.js clamps to - see maxRuleWidth there for why half the
 * shallowest row is where it stops.
 *
 * @param {object} item a table
 * @returns {number} pixels
 */
function maxRuleWidth(item) {
    const rowHeight = item.rowHeight ?? 0;
    const headerHeight = item.showHeader ? (item.headerHeight ?? rowHeight) : rowHeight;

    const shallowest = Math.min(rowHeight || Infinity, headerHeight || Infinity);

    return Number.isFinite(shallowest) ? Math.max(1, Math.floor(shallowest / 2)) : 1;
}


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

    if (item.type === 'box') {
        return [
            box,
            {
                title: 'Border',
                fields: [
                    {
                        key: 'style.borderStyle', label: 'Style', type: 'choice',
                        options: RULE_STYLES
                    },
                    num('style.borderWidth', 'Width', { min: 1 }),
                    { key: 'style.borderColor', label: 'Colour', type: 'color' },
                    num('style.radius', 'Corner', { min: 0 })
                ]
            },
            {
                title: 'Fill',
                fields: [
                    {
                        key: 'style.background', label: 'Background', type: 'color',
                        hint: 'Leave a box unfilled to frame what is behind it'
                    }
                ]
            }
        ];
    }

    if (item.type === 'line') {
        return [
            box,
            {
                title: 'Line',
                fields: [
                    {
                        key: 'orientation', label: 'Runs', type: 'choice',
                        options: ORIENTATIONS
                    },
                    num('style.thickness', 'Thickness', { min: 1 }),
                    {
                        key: 'style.lineStyle', label: 'Style', type: 'choice',
                        options: LINE_STYLES
                    },
                    { key: 'style.color', label: 'Colour', type: 'color' }
                ]
            }
        ];
    }

    if (item.type === 'table') {
        return [
            box,
            {
                title: 'Rows',
                fields: [num('rowHeight', 'Row height', { min: 1 })]
            },
            {
                /**
                 * The header is the part of a table anyone styles first, and
                 * its height was buried among the rows' - which is also the one
                 * figure that is not a row's, since the engine paginates a
                 * table as headerHeight + rows x rowHeight.
                 */
                title: 'Header',
                fields: [
                    { key: 'showHeader', label: 'Show header', type: 'toggle' },
                    num('headerHeight', 'Height', { min: 1 }),
                    { key: 'style.headerBackground', label: 'Fill', type: 'color' },
                    {
                        key: 'style.headerColor', label: 'Text', type: 'color',
                        hint: "Leave these alone to keep the stylesheet's own header"
                    }
                ]
            },
            {
                title: 'Appearance',
                fields: [
                    {
                        key: 'style.fontFamily', label: 'Font', type: 'choice',
                        options: FONT_STACKS
                    },
                    num('style.fontSize', 'Font size', { min: 1 }),
                    { key: 'style.color', label: 'Text', type: 'color' },
                    {
                        key: 'wrap', label: 'Wrap cells', type: 'toggle',
                        hint: 'A cell wider than its column runs onto another ' +
                            'line and the row grows; turn this off to keep ' +
                            'every row one line, cut off with an ellipsis'
                    },
                    {
                        key: 'style.borderStyle', label: 'Borders', type: 'choice',
                        options: RULE_STYLES
                    },
                    num('style.borderWidth', 'Border width', {
                        min: 1,
                        /**
                         * A rule taller than half a row makes the cell grow, and
                         * a table that outgrows headerHeight + rows x rowHeight
                         * is a table pagination has measured wrongly. The rail
                         * will not offer the figure that does it.
                         */
                        max: maxRuleWidth(item)
                    }),
                    { key: 'style.borderColor', label: 'Border colour', type: 'color' }
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
    { label: 'A2', width: 1587, height: 2245 },
    { label: 'A3', width: 1123, height: 1587 },
    { label: 'A4', width: 794, height: 1123 },
    { label: 'A5', width: 559, height: 794 },
    { label: 'A6', width: 397, height: 559 },
    { label: 'Letter', width: 816, height: 1056 },
    { label: 'Legal', width: 816, height: 1344 },
    { label: 'Tabloid', width: 1056, height: 1632 }
];

/** what the dropdown says for a page that is not one of them */
export const CUSTOM_PAPER = 'custom';


/**
 * Which sheet a page is, by its size.
 *
 * Either way round, because a landscape A4 is still A4 - and a dropdown that
 * said "Custom" the moment somebody turned the page would be one nobody could
 * use to turn it back.
 *
 * Derived rather than stored: the size is the fact, the name is a reading of
 * it. A layout hand-edited to 794 x 1123 reads as A4 without anyone having had
 * to also write the word down, and the two can never disagree.
 *
 * The one thing that cannot be derived is somebody having *asked* for the
 * boxes on a page that is currently a named size, so that alone is remembered.
 * Only the absence of a name is ever written down - never a name - so the file
 * has nothing in it that can contradict the size beside it.
 *
 * @param {object} page the layout's page
 * @returns {string} a preset label, or CUSTOM_PAPER
 */
export function paperOf(page) {
    if (page?.paper === CUSTOM_PAPER) return CUSTOM_PAPER;

    const w = page?.width;
    const h = page?.height;

    const found = PAGE_PRESETS.find(sheet =>
        (sheet.width === w && sheet.height === h)
        || (sheet.height === w && sheet.width === h));

    return found ? found.label : CUSTOM_PAPER;
}


/** which way up it is, which only means anything once it has a size */
function orientationOf(page) {
    return (page?.width ?? 0) > (page?.height ?? 0) ? 'landscape' : 'portrait';
}


/**
 * Puts a named sheet on the layout, keeping the way up it already had.
 *
 * @param {object} layout mutated in place
 * @param {string} label
 * @returns {boolean} whether anything changed
 */
function setPaper(layout, label) {
    const sheet = PAGE_PRESETS.find(one => one.label === label);

    /**
     * Custom is not a size, it is the absence of one - so choosing it leaves the
     * page exactly as it is and only reveals the two boxes. Throwing the
     * dimensions away at the moment somebody asked to edit them would be a
     * strange way to help.
     *
     * It has to stick, though. Without the flag, a page that happens to be A4
     * would read as A4 again the instant the rail was rebuilt, and the boxes
     * would vanish before anyone could type in them.
     */
    if (!sheet) {
        if (layout.page.paper === CUSTOM_PAPER) return false;

        layout.page.paper = CUSTOM_PAPER;
        return true;
    }

    const landscape = orientationOf(layout.page) === 'landscape';

    const width = landscape ? sheet.height : sheet.width;
    const height = landscape ? sheet.width : sheet.height;

    const wasCustom = layout.page.paper === CUSTOM_PAPER;

    /** a named sheet is a name again; the flag is only ever the lack of one */
    delete layout.page.paper;

    if (layout.page.width === width && layout.page.height === height) {
        return wasCustom;
    }

    layout.page.width = width;
    layout.page.height = height;
    return true;
}


/** turns the page, whatever size it is */
function setOrientation(layout, value) {
    const wanted = value === 'landscape';

    if (wanted === (orientationOf(layout.page) === 'landscape')) return false;

    const { width, height } = layout.page;

    layout.page.width = height;
    layout.page.height = width;
    return true;
}


/**
 * The Page section: which sheet, which way up, and - only when the sheet is
 * Custom - the two numbers themselves.
 *
 * The boxes are hidden rather than disabled for a named sheet, because a
 * disabled 794 invites somebody to try to change it and then wonder why they
 * cannot. The number is in the dropdown's own label instead, so nothing is
 * hidden that anyone needed to read.
 *
 * @param {object} layout
 * @returns {object[]}
 */
function pageFields(layout) {
    const custom = paperOf(layout.page) === CUSTOM_PAPER;

    const paper = {
        key: 'paper',
        label: 'Paper',
        type: 'choice',
        /** the controls below it differ per sheet, so the rail is rebuilt */
        rebuilds: true,
        options: [
            ...PAGE_PRESETS.map(sheet => ({
                value: sheet.label,
                label: `${sheet.label}  ${sheet.width} x ${sheet.height}`
            })),
            { value: CUSTOM_PAPER, label: 'Custom' }
        ],
        read: (target) => paperOf(target.page),
        write: (target, value) => setPaper(target, value)
    };

    const orientation = {
        key: 'orientation',
        label: 'Orientation',
        type: 'choice',
        rebuilds: true,
        options: [
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' }
        ],
        read: (target) => orientationOf(target.page),
        write: (target, value) => setOrientation(target, value)
    };

    return custom
        ? [paper, num('page.width', 'Width', { min: 1 }),
            num('page.height', 'Height', { min: 1 })]
        : [paper, orientation];
}


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
            fields: pageFields(layout)
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
    /**
     * A field that is a reading of the object rather than a place on it - the
     * paper size is the width and the height, said as a name. It has no path to
     * walk, so it says how to be read instead.
     */
    if (field.read) return field.read(item);

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

    /** the other half of a derived field: it says how to be written, too */
    if (field.write) return field.write(item, value);

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

        const floored = field.min != null ? Math.max(value, field.min) : value;

        return field.max != null ? Math.min(floored, field.max) : floored;
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
