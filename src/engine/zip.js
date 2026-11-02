/**
 * zip.js writes a ZIP archive, which is what an .xlsx file is.
 *
 * Only as much of the format as a spreadsheet needs (PKWARE APPNOTE 6.3):
 * entries are STORED, not deflated, so there is no compressor to carry and the
 * whole thing stays synchronous - the export it serves returns at once, the way
 * the CSV download does. The cost is a larger file, and a report is text that
 * already downloads in a blink.
 *
 * No ZIP64: four gigabytes of report would not fit in a browser string long
 * before it reached this file. Timestamps are fixed at the format's epoch, so
 * the same report always zips to the same bytes.
 */


/** 1980-01-01 00:00 in MS-DOS date and time fields - the earliest ZIP can say */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** general purpose bit 11: names are UTF-8 */
const UTF8_NAMES = 0x0800;

/** 2.0, the version that introduced folders - what every reader accepts */
const VERSION = 20;


/** the CRC-32 lookup table (the IEEE polynomial, reflected), built on first use */
let table = null;

function crcTable() {
    if (table) return table;

    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }

    return table;
}


/**
 * The CRC-32 of some bytes, as ZIP records it.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit
 */
export function crc32(bytes) {
    const t = crcTable();
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);

    return (crc ^ 0xFFFFFFFF) >>> 0;
}


/**
 * Packs files into a ZIP archive.
 *
 * @param {{name: string, data: Uint8Array|string}[]} files in the order they
 *   go in; a string is written as UTF-8
 * @returns {Uint8Array} the archive
 */
export function zip(files) {
    const encoder = new TextEncoder();

    const entries = files.map(({ name, data }) => {
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        return { name: encoder.encode(name), bytes, crc: crc32(bytes), offset: 0 };
    });

    const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.bytes.length, 0);
    const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);

    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let at = 0;

    const u16 = (v) => { view.setUint16(at, v, true); at += 2; };
    const u32 = (v) => { view.setUint32(at, v, true); at += 4; };
    const put = (bytes) => { out.set(bytes, at); at += bytes.length; };

    for (const e of entries) {
        e.offset = at;

        u32(0x04034B50);            // local file header signature
        u16(VERSION);               // version needed to extract
        u16(UTF8_NAMES);            // general purpose flags
        u16(0);                     // compression: stored
        u16(DOS_TIME);
        u16(DOS_DATE);
        u32(e.crc);
        u32(e.bytes.length);        // compressed size
        u32(e.bytes.length);        // uncompressed size
        u16(e.name.length);
        u16(0);                     // extra field length
        put(e.name);
        put(e.bytes);
    }

    const centralStart = at;

    for (const e of entries) {
        u32(0x02014B50);            // central directory header signature
        u16(VERSION);               // version made by
        u16(VERSION);               // version needed to extract
        u16(UTF8_NAMES);
        u16(0);                     // stored
        u16(DOS_TIME);
        u16(DOS_DATE);
        u32(e.crc);
        u32(e.bytes.length);
        u32(e.bytes.length);
        u16(e.name.length);
        u16(0);                     // extra field length
        u16(0);                     // comment length
        u16(0);                     // disk number start
        u16(0);                     // internal attributes
        u32(0);                     // external attributes
        u32(e.offset);              // where the local header is
        put(e.name);
    }

    const centralLength = at - centralStart;

    u32(0x06054B50);                // end of central directory signature
    u16(0);                         // this disk
    u16(0);                         // the disk the directory starts on
    u16(entries.length);            // entries on this disk
    u16(entries.length);            // entries in all
    u32(centralLength);             // size of the central directory
    u32(centralStart);              // where it starts
    u16(0);                         // comment length

    return out;
}
