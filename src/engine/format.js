/**
 * format.js turns a value into the text a report prints, and into the number
 * format a spreadsheet shows it with - one description of a format, read the
 * same way by both, so the page and the workbook cannot disagree.
 *
 * A format is a plain object, carried by a text item or a table column:
 *
 *   { type: 'currency', decimals: 2, grouping: 'indian', symbol: '₹' }
 *
 *   type            'text' (as it comes - the default), 'number', 'currency',
 *                   'percent', 'date' or 'datetime'
 *   decimals        places after the point, 0 to 6
 *   grouping        'international' 100,000 | 'indian' 1,00,000 | 'none' 100000
 *   negative        'minus' -1,234 | 'brackets' (1,234) | 'trailing' 1,234-
 *   zero            'zero' 0.00 | 'dash' - | 'blank' (nothing)
 *   symbol          a currency's symbol, such as '₹' or '$'
 *   symbolPosition  'before' ₹1,234 | 'after' 1,234 ₹
 *   pattern         a date's layout, from the tokens in DATE_TOKENS
 *
 * The report has defaults of its own, as `layout.format` - the same keys with
 * no `type` - and an item's format says only what differs. Neutral unless the
 * report says otherwise: international grouping, no symbol, ISO dates.
 *
 * A value that is not of the format's type is printed as it comes: a name in a
 * number column is still a name.
 *
 * Nothing here touches the document or the clock, and the time zone plays no
 * part: a date is printed from its own year, month and day, so `2026-06-17` is
 * the 17th wherever the report is built.
 */


/** what a format says when neither it nor the report says otherwise */
export const DEFAULT_FORMAT = Object.freeze({
    type: 'text',
    decimals: 2,
    grouping: 'international',
    negative: 'minus',
    zero: 'zero',
    symbol: '',
    symbolPosition: 'before',
    pattern: 'yyyy-MM-dd'
});

/** the report defaults the designer offers in one click */
export const INDIAN_DEFAULTS = Object.freeze({
    grouping: 'indian',
    symbol: '₹',
    symbolPosition: 'before',
    pattern: 'dd/MM/yyyy'
});

export const FORMAT_TYPES = ['text', 'number', 'currency', 'percent', 'date', 'datetime'];
export const GROUPINGS = ['international', 'indian', 'none'];
export const NEGATIVES = ['minus', 'brackets', 'trailing'];
export const ZEROS = ['zero', 'dash', 'blank'];
export const SYMBOL_POSITIONS = ['before', 'after'];

/**
 * The currency symbols the designer offers, most used here first. Any other
 * text works as a symbol too - the designer takes it as a custom one.
 */
export const CURRENCY_SYMBOLS = [
    { value: '', label: 'None' },
    { value: '₹', label: '₹  Indian rupee' },
    { value: 'Rs.', label: 'Rs.  Rupee' },
    { value: '$', label: '$  Dollar' },
    { value: '€', label: '€  Euro' },
    { value: '£', label: '£  Pound' },
    { value: '¥', label: '¥  Yen / Yuan' },
    { value: 'AED', label: 'AED  UAE dirham' },
    { value: 'SAR', label: 'SAR  Saudi riyal' },
    { value: 'S$', label: 'S$  Singapore dollar' }
];

/** the date layouts the designer offers; any other pattern of DATE_TOKENS works too */
export const DATE_PATTERNS = [
    'dd/MM/yyyy', 'dd-MMM-yyyy', 'd MMMM yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'
];

export const DATETIME_PATTERNS = [
    'dd/MM/yyyy HH:mm', 'dd/MM/yyyy hh:mm a', 'dd-MMM-yyyy HH:mm', 'yyyy-MM-dd HH:mm'
];

export const MAX_DECIMALS = 6;

const NUMBER_TYPES = ['number', 'currency', 'percent'];
const DATE_TYPES = ['date', 'datetime'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

/**
 * The tokens a date pattern is made of, longest first so `MMMM` is not read as
 * two `MM`s. Anything else in a pattern is printed as it stands.
 */
const DATE_TOKENS = /yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|ss|a/g;

/** a plain number written as text - "1200", "-3.5" - which a CSV or a form will hand over */
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/** `2026-06-17`, optionally with a time - what JSON carries a date as */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;


/**
 * A format with the report's defaults filled in under it, every key present -
 * or null when there is nothing to format, so the caller prints as it always
 * has.
 *
 * @param {object|null|undefined} format an item's or a column's
 * @param {object|null|undefined} [defaults] the report's `layout.format`
 * @returns {object|null}
 */
export function effectiveFormat(format, defaults) {
    if (format == null || typeof format !== 'object') return null;
    if (!FORMAT_TYPES.includes(format.type) || format.type === 'text') return null;

    const inherited = defaults && typeof defaults === 'object' ? defaults : {};
    const merged = { ...DEFAULT_FORMAT, ...withoutType(inherited), ...format };

    merged.decimals = clampDecimals(merged.decimals);
    if (!GROUPINGS.includes(merged.grouping)) merged.grouping = DEFAULT_FORMAT.grouping;
    if (!NEGATIVES.includes(merged.negative)) merged.negative = DEFAULT_FORMAT.negative;
    if (!ZEROS.includes(merged.zero)) merged.zero = DEFAULT_FORMAT.zero;
    if (!SYMBOL_POSITIONS.includes(merged.symbolPosition)) {
        merged.symbolPosition = DEFAULT_FORMAT.symbolPosition;
    }
    if (typeof merged.symbol !== 'string') merged.symbol = '';
    if (typeof merged.pattern !== 'string' || merged.pattern === '') {
        merged.pattern = merged.type === 'datetime' ? 'yyyy-MM-dd HH:mm' : DEFAULT_FORMAT.pattern;
    }

    return merged;
}


/**
 * The format a {percentage()} prints in: the item's own when it is a percent
 * format, so its places and negatives are the ones chosen; otherwise a plain
 * percentage to two places - a share is never money or a date, whatever the
 * item around it is formatted as.
 * @param {object|null|undefined} format the item's, settled
 * @returns {object}
 */
export function percentFormat(format) {
    return format?.type === 'percent' ? format : { type: 'percent', decimals: 2 };
}


/**
 * The text a value prints as.
 *
 * @param {*} value from the data
 * @param {object|null|undefined} format an item's or column's
 * @param {object|null|undefined} [defaults] the report's
 * @returns {string} '' for null and undefined
 */
export function formatValue(value, format, defaults) {
    if (value === null || value === undefined) return '';

    const f = effectiveFormat(format, defaults);
    if (!f) return String(value);

    if (NUMBER_TYPES.includes(f.type)) {
        const number = toNumber(value);
        return number === null ? String(value) : formatNumber(number, f);
    }

    const parts = dateParts(value);
    return parts === null ? String(value) : formatDate(parts, f.pattern);
}


/**
 * A value as the number it stands for, or null: a number, or text that is
 * plainly one. "007" is a number here - a column formatted as a number has
 * said its values are numbers.
 * @param {*} value
 * @returns {number|null}
 */
export function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    const text = value.trim();
    return NUMERIC_TEXT.test(text) ? Number(text) : null;
}


/**
 * A value's date, as the parts it was written with - or null for what is not a
 * date. A Date is read in local time, as the host that made it meant it; an
 * ISO string is read as written, offset and all ignored, because "17 June at
 * 09:00" is what the data says and what the report should print.
 *
 * @param {*} value
 * @returns {{year: number, month: number, day: number, hour: number,
 *   minute: number, second: number}|null} month 1 to 12
 */
export function dateParts(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;

        return {
            year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(),
            hour: value.getHours(), minute: value.getMinutes(), second: value.getSeconds()
        };
    }

    if (typeof value !== 'string') return null;

    const match = value.trim().match(ISO_DATE);
    if (!match) return null;

    const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
    const parts = {
        year: Number(y), month: Number(mo), day: Number(d),
        hour: Number(h), minute: Number(mi), second: Number(s)
    };

    /** 2026-02-31 is not a day; printing it as one would be inventing data */
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) return null;
    if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;

    return parts;
}


/**
 * One line a person reads to know what a format does - the rail's summary.
 * @param {object|null|undefined} format
 * @param {object|null|undefined} [defaults]
 * @returns {string}
 */
export function describeFormat(format, defaults) {
    const f = effectiveFormat(format, defaults);
    if (!f) return 'As it comes';

    if (DATE_TYPES.includes(f.type)) {
        return `${f.type === 'date' ? 'Date' : 'Date & time'} · ${f.pattern}`;
    }

    const name = { number: 'Number', currency: 'Currency', percent: 'Percent' }[f.type];
    const sample = formatValue(f.type === 'percent' ? 1234.5678 : 1234567.891, f);

    return `${name} · ${sample}`;
}


/* ---------------- numbers ---------------- */


/**
 * Rounds to the format's places with Intl - which rounds 1.005 to 1.01, where
 * toFixed gives 1.00 - and then groups and signs the digits here, because
 * Indian grouping, a trailing minus and a symbol after the figure are not
 * things every Intl locale offers.
 */
function formatNumber(number, f) {
    const scaled = f.type === 'percent' ? number * 100 : number;

    const digits = plainDigits(Math.abs(scaled), f.decimals);
    const isZero = /^[0.]*$/.test(digits);

    if (isZero && f.zero === 'blank') return '';
    if (isZero && f.zero === 'dash') return '-';

    const [whole, fraction] = digits.split('.');
    let body = group(whole, f.grouping) + (fraction ? `.${fraction}` : '');

    if (f.type === 'percent') body += '%';
    if (f.type === 'currency' && f.symbol) {
        body = f.symbolPosition === 'after' ? `${body} ${f.symbol}` : `${f.symbol}${body}`;
    }

    /** -0.001 at two places is 0.00, not -0.00 */
    if (scaled >= 0 || isZero) return body;

    switch (f.negative) {
        case 'brackets': return `(${body})`;
        case 'trailing': return `${body}-`;
        default: return `-${body}`;
    }
}


const PLAIN = new Map();

/** an unsigned number to exactly `decimals` places, digits only: "1234567.89" */
function plainDigits(number, decimals) {
    if (!PLAIN.has(decimals)) {
        PLAIN.set(decimals, new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: false
        }));
    }

    return PLAIN.get(decimals).format(number);
}


/** the whole part of a number, grouped: 1234567 as 1,234,567 or 12,34,567 */
function group(whole, grouping) {
    if (grouping === 'none' || whole.length <= 3) return whole;

    if (grouping === 'indian') {
        /** the last three digits, then pairs - 12,34,567 */
        const head = whole.slice(0, -3);
        const tail = whole.slice(-3);
        return `${head.replace(/\B(?=(\d{2})+$)/g, ',')},${tail}`;
    }

    return whole.replace(/\B(?=(\d{3})+$)/g, ',');
}


function clampDecimals(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_FORMAT.decimals;
    return Math.min(MAX_DECIMALS, Math.max(0, n));
}


function withoutType(defaults) {
    const { type, ...rest } = defaults;
    void type;
    return rest;
}


/* ---------------- dates ---------------- */


function formatDate(parts, pattern) {
    const pad = (n) => String(n).padStart(2, '0');
    const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;

    return pattern.replace(DATE_TOKENS, (token) => {
        switch (token) {
            case 'yyyy': return String(parts.year).padStart(4, '0');
            case 'yy': return pad(parts.year % 100);
            case 'MMMM': return MONTHS[parts.month - 1];
            case 'MMM': return MONTHS[parts.month - 1].slice(0, 3);
            case 'MM': return pad(parts.month);
            case 'M': return String(parts.month);
            case 'dd': return pad(parts.day);
            case 'd': return String(parts.day);
            case 'HH': return pad(parts.hour);
            case 'H': return String(parts.hour);
            case 'hh': return pad(hour12);
            case 'h': return String(hour12);
            case 'mm': return pad(parts.minute);
            case 'ss': return pad(parts.second);
            case 'a': return parts.hour < 12 ? 'AM' : 'PM';
            default: return token;
        }
    });
}


/* ---------------- spreadsheets ---------------- */


/**
 * The Excel number format code that shows a value the way formatValue prints
 * it - so a workbook cell keeps the real number or date and still reads as the
 * report does. null when the format leaves the value as it comes.
 *
 * Indian grouping has no Excel code of its own: Excel groups in threes only.
 * It is said with two conditional sections - a crore and over, a lakh and over
 * - so 1,00,000.00 reads the same on any machine whatever its region. Those
 * conditions take the sections a negative and a zero would otherwise have, so
 * under Indian grouping a negative below a lakh's size keeps a plain minus and
 * the zero style is not carried over.
 *
 * @param {object|null|undefined} format
 * @param {object|null|undefined} [defaults]
 * @returns {string|null}
 */
export function excelNumberFormat(format, defaults) {
    const f = effectiveFormat(format, defaults);
    if (!f) return null;

    if (DATE_TYPES.includes(f.type)) return excelDate(f.pattern);

    const places = f.decimals > 0 ? `.${'0'.repeat(f.decimals)}` : '';
    const percent = f.type === 'percent' ? '%' : '';
    const symbol = f.type === 'currency' && f.symbol ? quote(f.symbol) : '';

    const dress = (digits) => {
        const body = `${digits}${places}${percent}`;
        if (!symbol) return body;
        return f.symbolPosition === 'after' ? `${body}${quote(' ')}${symbol}` : `${symbol}${body}`;
    };

    if (f.grouping === 'indian') {
        return [
            `[>=10000000]${dress('##\\,##\\,##\\,##0')}`,
            `[>=100000]${dress('##\\,##\\,##0')}`,
            dress('#,##0')
        ].join(';');
    }

    const positive = dress(f.grouping === 'none' ? '0' : '#,##0');

    const negative = {
        minus: `-${positive}`,
        brackets: `(${positive})`,
        trailing: `${positive}-`
    }[f.negative];

    const zero = {
        zero: positive,
        dash: quote('-'),
        blank: ''
    }[f.zero];

    return `${positive};${negative};${zero}`;
}


/**
 * A date pattern in Excel's terms. Every character that is not a date token is
 * escaped, because Excel reads a bare `/` or `:` as the reader's own date and
 * time separators - and dd/MM/yyyy has to stay slashes on a machine set to
 * dots.
 */
function excelDate(pattern) {
    let out = '';
    let last = 0;

    for (const match of pattern.matchAll(DATE_TOKENS)) {
        out += escapeLiteral(pattern.slice(last, match.index));
        out += {
            yyyy: 'yyyy', yy: 'yy', MMMM: 'mmmm', MMM: 'mmm', MM: 'mm', M: 'm',
            dd: 'dd', d: 'd', HH: 'hh', H: 'h', hh: 'hh', h: 'h',
            mm: 'mm', ss: 'ss', a: 'AM/PM'
        }[match[0]];
        last = match.index + match[0].length;
    }

    return out + escapeLiteral(pattern.slice(last));
}


function escapeLiteral(text) {
    return [...text].map(ch => (ch === ' ' ? ' ' : `\\${ch}`)).join('');
}


/** text Excel prints as it stands, inside a format code */
function quote(text) {
    return `"${String(text).replace(/"/g, '')}"`;
}


/**
 * A value as Excel's own: the number, or the date as a serial - days since
 * 1899-12-30, the time as the fraction of a day - or null when the value is not
 * of the format's type and has to go in as text.
 *
 * @param {*} value
 * @param {object|null|undefined} format
 * @param {object|null|undefined} [defaults]
 * @returns {number|null}
 */
export function excelValue(value, format, defaults) {
    const f = effectiveFormat(format, defaults);
    if (!f) return null;

    if (NUMBER_TYPES.includes(f.type)) return toNumber(value);

    const parts = dateParts(value);
    if (!parts) return null;

    const days = Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000 + 25569;
    const time = (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86400;

    return f.type === 'date' ? days : days + time;
}
