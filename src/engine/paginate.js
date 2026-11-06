
import { pageRegions, bandZoneHeight } from './regions.js';
import { levelsOf, groupFrame, fragmentBandsOf, startsPage } from './tables.js';
import { designHeight, total, headerHeightFor, bandsHeight } from './measure.js';
import { formatValue, percentFormat } from './format.js';
import { PERCENTAGE, shownValue } from './group.js';
import { soleKey } from './resolve.js';
import { highlightFor } from './highlight.js';


const REGEX = /\{([^{}]+)\}/g;

/** placeholders only this stage can resolve, once the page count is known */
const PAGE_KEYS = ['page', 'totalPages'];



export function paginate(json) {
    const paginateJSON = structuredClone(json);


    let context = {
        page: paginateJSON.page,
        bands: paginateJSON.bands,
        assignedBands: {
            reportHeader: paginateJSON.bands.find(b => b.type === "reportHeader"),
            reportFooter: paginateJSON.bands.find(b => b.type === "reportFooter"),
            pageHeader: paginateJSON.bands.find(b => b.type === "pageHeader"),
            pageFooter: paginateJSON.bands.find(b => b.type === "pageFooter"),
            detail: paginateJSON.bands.find(b => b.type === "detail"),
        }
    };


    context.availableHeight = calAvailableHeight(paginateJSON.page);

    /**
     * Bands are anchored to zones rather than stacked, so a short detail band
     * no longer drags the page footer up off the bottom edge.
     */
    context.regionsFor = (pageNO, isLastPage) => pageRegions({
        bands: context.assignedBands,
        contentHeight: context.availableHeight,
        isFirstPage: pageNO === 1,
        isLastPage
    });


    const flowBands = paginateJSON.bands.filter(
        b => ![
            "reportHeader",
            "reportFooter",
            "pageHeader",
            "pageFooter",
            "groupHeader",
            "groupFooter"
        ].includes(b.type)
    );

    paginateJSON.pages = resolve(calPages(flowBands, context));

    return paginateJSON;
}


/**
 * How many rows starting at `from` fit in `room` px.
 *
 * A table used to be sliced with a division, because every row was the same
 * height. A row is now as tall as its own text wraps to, so the only honest
 * answer is to add them up until one does not fit.
 *
 * @param {number[]} heights every row's height, in order
 * @param {number} from the first row still to be placed
 * @param {number} room the space below the table's top on this page
 * @param {number} [limit] never return more than this many
 * @returns {number} rows to take, possibly zero
 */
function rowsThatFit(heights, from, room, limit = Infinity) {
    let used = 0;
    let taken = 0;

    while (from + taken < heights.length && taken < limit) {
        const next = used + heights[from + taken];
        if (next > room) break;

        used = next;
        taken++;
    }

    return taken;
}


/** the height of one slice of rows */
function sliceHeight(heights, from, count) {
    return total(heights.slice(from, from + count));
}


/**
 * A table's row heights, however the table came by them.
 *
 * measure.js writes them on; a table drawn straight from a layout - the
 * designer canvas - has none, and every row is the height it declares.
 *
 * @param {object} item a table
 * @param {object[]} rows the rows being placed
 * @param {number[]} [heights] what measure.js worked out, if it ran
 * @returns {number[]}
 */
function heightsFor(item, rows, heights) {
    if (Array.isArray(heights) && heights.length === (rows ?? []).length) {
        return heights;
    }

    return (rows ?? []).map(() => item.rowHeight ?? 0);
}


function calPages(bands, context) {
    let pages = [];

    // initial page creation
    let currentPage = newPage(1, context);
    pages.push(currentPage);

    // spreading the report header and footer from the context.assignedBands
    const { assignedBands, availableHeight } = context;
    const { reportFooter, reportHeader, pageHeader, pageFooter } = assignedBands;

    /**
     * The detail zone of a continuation page - no report header, no report
     * footer, so it is the largest zone any page offers. Nothing can be split
     * smaller than this, which makes it the yardstick for "will this fit at all".
     */
    const freshPageHeight = context.regionsFor(2, false).detail.height;

    /** the report header now owns a zone; newPage placed it on page 1 already */
    if (reportHeader && currentPage.regions.detail.height <= 0) {
        console.warn(
            `The header zones leave no room for detail on page 1. ` +
            `Reduce the reportHeader or pageHeader height.`
        );
    }


    // looping the flow band and calculation the items
    // that can be fit inside the currentPage
    // conditions : 1. when page has no more place left and incoming item is not table
    // 2. when the is no more place and left and incoming item is table
    // if the incoming item is table then checks the row length . and based on the available space allocate the row

    /**
     * The lowest edge, in band coordinates, that anything placed on the current
     * page has reached. Items are drawn absolutely at their `y` inside the band
     * box, so what an item costs its zone is `y + measuredHeight` - the same
     * figure measure.js and render.js work from. Adding heights the way a flow
     * layout would leaves the gap above an item unpaid for, and the band then
     * runs past its zone straight over the page footer.
     */
    let bandBottom = 0;

    /**
     * How far the band's coordinate space has been shifted up on the current
     * page. A band taller than a page is continued by moving whatever did not
     * fit to the top of the next zone rather than redrawing it at the same `y`,
     * which would only overflow the new page in the same place.
     */
    let carry = 0;

    /**
     * What every item placed on this page was designed to end at, and what it
     * actually ended at - both in the band space of this page.
     *
     * Two kinds of item are only as tall as their data makes them: a table,
     * which is its header plus however many rows arrive, and a text box, which
     * wraps to as many lines as the words need. Neither is usually the last
     * thing in a band - a total under the rows, a second line of the address
     * under the first - and everything below was placed at the `y` it was
     * given, which was measured against the size the designer drew.
     *
     * So what sits below something that grew has to float down with it, which
     * is what this list is for.
     */
    let grown = [];


    /** the detail zone of the page being filled, which page 1 may shrink */
    const detailZone = () => currentPage.regions.detail.height;

    /**
     * Moves to a fresh page, handing the band built so far to the page being
     * left behind. Everything a page break has to remember lives here so the
     * call sites cannot drift apart.
     * @param {object} calBand the band under construction
     * @param {object} band its template, for the replacement
     * @param {number} shiftTo the band-space y that becomes the top of the new page
     * @returns {object} the new, empty calBand
     */
    const breakPage = (calBand, band, shiftTo) => {
        if (calBand.items.length > 0) currentPage.bands.push(calBand);

        currentPage = newPage(pages.length + 1, context);
        pages.push(currentPage);
        bandBottom = 0;
        carry = shiftTo;

        /** whatever grew on this page did not grow on the next one */
        grown = [];

        return { ...band, items: [] };
    };

    /**
     * Records a placed item against the page and its band.
     * @param {object} calBand
     * @param {object} placed the item as it will be drawn, y and height final
     */
    const place = (calBand, placed) => {
        calBand.items.push(placed);

        bandBottom = Math.max(bandBottom, (placed.y ?? 0) + (placed.measuredHeight ?? 0));

        calBand.measuredHeight = bandBottom;
        currentPage.usedHeight = (availableHeight - detailZone()) + bandBottom;
    };

    /**
     * How far down what is already on the page pushes something designed to
     * start at `top`.
     *
     * Only what is *above* it counts, and above means the whole box is: an item
     * level with a table's rows or beside a wrapping paragraph is not under it
     * and is not moved by it.
     *
     * The shift is the difference between where those items were designed to
     * end and where they really ended - not the sum of how much each one grew.
     * Two paragraphs side by side that each wrap one extra line push what is
     * under them down by one line, not by two; and a table with fewer rows than
     * it was drawn with gives the space back rather than leaving a hole.
     *
     * @param {number} top the item's y, less the carry - so, on this page
     * @returns {number} px, negative when what is above ended early
     */
    const shiftBelow = (top) => {
        let designed = -Infinity;
        let actual = -Infinity;

        for (const box of grown) {
            if (box.designBottom > top) continue;

            designed = Math.max(designed, box.designBottom);
            actual = Math.max(actual, box.actualBottom);
        }

        return designed === -Infinity ? 0 : actual - designed;
    };

    /**
     * Where an item is drawn, in the band space of the page it lands on: the
     * `y` in the file, less the carry of a band continued onto a new page, plus
     * whatever grew above it. An item keeps the gap it was designed with - ten
     * pixels under the last row stays ten pixels under the last row, however
     * many rows there turn out to be.
     *
     * @param {number} itemY the item's y as designed
     * @returns {number}
     */
    const pageY = (itemY) => {
        const top = itemY - carry;
        return top + shiftBelow(top);
    };


    for (const band of bands) {
        let calBand = {
            ...band,
            items: []
        };

        /** the shift belongs to one band's coordinate space, not to the page */
        carry = 0;

        /** and so does what grew inside it */
        grown = [];

        /**
         * Top to bottom, not file order. Items are absolutely positioned, so
         * where one sits on the page is its `y` and nothing else - walking them
         * in declaration order let a header text written after the table get
         * carried to whatever page the table happened to end on.
         */
        const ordered = [...band.items].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));

        for (const item of ordered) {
            const itemY = item.y ?? 0;
            const localBottom = pageY(itemY) + item.measuredHeight;

            if (localBottom > detailZone() && item.type != "table") {
                /**
                 * An item taller than an empty zone overflows wherever it goes,
                 * so spending a page break on it only buys a blank page.
                 */
                if (item.measuredHeight > freshPageHeight) {
                    console.warn(
                        `Item "${item.id}" is ${Math.ceil(item.measuredHeight)}px tall, past the ` +
                        `${freshPageHeight}px detail zone of an empty page; it will overflow.`
                    );
                } else {
                    calBand = breakPage(calBand, band, itemY);
                }

                place(calBand, { ...structuredClone(item), y: pageY(itemY) });
            }
            /**
             * A table goes down the splitting path when it overflows - or when
             * one of its groups has to start a page, which a table placed whole
             * on the page it starts on would never do.
             */
            else if (item.type == "table"
                && (localBottom > detailZone() || breaksPages(item))) {

                /**
                 * Where the next slice of this table starts inside the band. The
                 * first slice keeps the y the designer gave it, because whatever
                 * sits above it is on this page too. A continuation slice has
                 * nothing above it, so it starts at the top of the zone rather
                 * than leaving that gap blank on every page.
                 *
                 * pageY, not the designed y less the carry: a table under
                 * another table starts under however far the first one really
                 * reached, the same as a fixed item does. Placed at its designed
                 * y it drew straight over the rows above it.
                 */
                let tableY = pageY(itemY);

                // when the table has group
                if (item.groups) {
                    /**
                     * What a fragment draws around its rows - column labels, the
                     * headers of every level it opens, the footers of every level
                     * it closes - is groupFrame's to say, the same rule measure.js
                     * sized the table by. A table grouped at one level frames every
                     * fragment the same way; a nested one does not, so the frame
                     * is asked for afresh for each slice rather than added up once.
                     */
                    const tblHeaderHgt = item.headerMeasured ?? headerHeightFor(item);
                    const levels = levelsOf(item);

                    /** what the bands and labels around one fragment's rows cost */
                    const frameOf = (grp, firstOnPage, ends) => {
                        const frame = groupFrame(item, grp, firstOnPage, ends);
                        return {
                            frame,
                            above: (frame.columnHeader ? tblHeaderHgt : 0) + bandsHeight(frame.headers),
                            below: bandsHeight(frame.footers)
                        };
                    };

                    /** the tallest row anywhere in the table, since any group may hold it */
                    const tallest = Math.max(
                        item.rowHeight ?? 0,
                        ...(item.groups ?? []).flatMap(grp =>
                            heightsFor(item, grp.rows, grp.rowHeights)));

                    /**
                     * The most a slice can need: the labels, every level's
                     * header, one row and every level's footer - a group that is
                     * the last of its region and of its city at once.
                     */
                    const reservedSpace = tblHeaderHgt + tallest
                        + total(levels.map(level => level?.header?.measuredHeight ?? 0))
                        + total(levels.map(level => level?.footer?.measuredHeight ?? 0));

                    /**
                     * same trap as the ungrouped path: if the minimum viable slice
                     * (table header + group headers + one row + group footers) is
                     * taller than an empty page we would allocate pages forever.
                     */
                    const sliceFitsAnyPage = reservedSpace <= freshPageHeight;

                    if (!sliceFitsAnyPage) {
                        console.warn(
                            `Table "${item.id}": table header + group headers + one row + group footers ` +
                            `(${reservedSpace}px) exceeds the ${freshPageHeight}px printable page. ` +
                            `Falling back to one row per page; rows will overflow their page.`
                        );
                    }

                    /**
                     * How many rows of a group fit in {room} px.
                     *
                     * The group footers only print on the fragment that finishes
                     * the group, so they are reserved only when this page could
                     * actually finish it. Without that the last slice of a group
                     * added footer height that nobody had budgeted for, and the
                     * detail band grew past its zone straight over the page footer.
                     *
                     * When the rows would fit but the footers would not, one row is
                     * deliberately held back so the footers land on the next page
                     * beside a row rather than alone.
                     * @param {number[]} heights the group's row heights, in order
                     * @param {number} from the first row of this group still unplaced
                     * @param {number} room px left in the detail zone below the table top
                     * @param {number} rowsLeft rows still unplaced in this group
                     * @param {number} above labels and headers over this slice
                     * @param {number} below footers under it, if it ends the group
                     * @returns {number} rows to place now, possibly 0
                     */
                    const fitRows = (heights, from, room, rowsLeft, above, below) => {
                        const body = room - above;

                        const withFooter = rowsThatFit(heights, from, body - below, rowsLeft);

                        /** the group ends here, so its footers have to fit here too */
                        if (rowsLeft <= withFooter) return rowsLeft;

                        return Math.min(
                            rowsThatFit(heights, from, body, rowsLeft),
                            rowsLeft - 1
                        );
                    };


                    /** the fragments placed on the page being built */
                    let calGroups = [];

                    let calItemHeight = 0; // used to cal the item hgt


                    /**
                     * Each innermost group in turn - for a one-level table, each
                     * group. A group that does not fit what is left of a page has
                     * as many rows placed as do, and carries on at the top of the
                     * next with its headers drawn again.
                     */
                    for (const [n, grp] of item.groups.entries()) {

                        /**
                         * A group at a level that says `newPage` closes the page
                         * the group before it is on, whatever room is left.
                         */
                        if (startsPage(item, grp, n) && calGroups.length > 0) {
                            const dupItem = structuredClone(item);

                            dupItem.groups = calGroups;
                            dupItem.y = tableY;
                            dupItem.measuredHeight = calItemHeight;
                            place(calBand, dupItem);

                            calBand = breakPage(calBand, band, itemY);
                            calGroups = [];
                            calItemHeight = 0;
                            tableY = 0;
                        }

                        let currIdx = 0;
                        const rowLen = grp.rows.length;
                        const heights = heightsFor(item, grp.rows, grp.rowHeights);

                        while (currIdx < rowLen) {

                            /** the table starts at tableY, so only what is below it is usable */
                            const roomHgt = detailZone() - tableY - calItemHeight;

                            const firstOnPage = calGroups.length === 0;

                            /** a page we have already emptied cannot be emptied again - take the slice as is */
                            const isFreshPage = firstOnPage
                                && calBand.items.length === 0
                                && tableY === 0
                                && detailZone() >= freshPageHeight;

                            const { above } = frameOf(grp, firstOnPage, false);
                            const { below } = frameOf(grp, firstOnPage, true);

                            /**
                             * Rows this page can take. fitRows reserves the group
                             * footers whenever the group would end here, so the
                             * slice it hands back always fits the detail zone.
                             */
                            let canFitRows = fitRows(
                                heights, currIdx, roomHgt, rowLen - currIdx, above, below);

                            /**
                             * A page we have already emptied cannot be emptied again,
                             * so place a row regardless - an oversized slice overflows
                             * one page, while asking for another empty page forever
                             * hangs the whole render.
                             */
                            if (canFitRows < 1 && isFreshPage) canFitRows = 1;

                            /** nothing fits in what is left - carry the group to a new page */
                            if (canFitRows < 1) {
                                if (calGroups.length > 0) {
                                    let dupItem = structuredClone(item);

                                    dupItem.groups = calGroups;
                                    dupItem.y = tableY;
                                    dupItem.measuredHeight = calItemHeight;
                                    place(calBand, dupItem);
                                }

                                calBand = breakPage(calBand, band, itemY);
                                calGroups = [];
                                calItemHeight = 0;
                                tableY = 0;
                                continue;
                            }

                            const rows = grp.rows.slice(currIdx, currIdx + canFitRows);
                            const slice = heights.slice(currIdx, currIdx + canFitRows);

                            currIdx += rows.length;

                            const hasMoreRows = currIdx < rowLen;

                            const { frame, above: drawnAbove, below: drawnBelow } =
                                frameOf(grp, firstOnPage, !hasMoreRows);

                            calItemHeight += total(slice) + drawnAbove + drawnBelow;

                            calGroups.push(groupFragment(grp, frame, rows, slice, !hasMoreRows));
                        }
                    }

                    if (calGroups.length > 0) {
                        const dupItem = structuredClone(item);

                        dupItem.groups = calGroups;
                        dupItem.y = tableY;
                        dupItem.measuredHeight = calItemHeight;

                        /** measure after the push so the band height includes its own table */
                        place(calBand, dupItem);

                        calGroups = [];
                    }

                } else {
                    const rowLen = item.row.length;
                    let currIdx = 0;

                    const tblHeaderHgt = item.headerMeasured ?? headerHeightFor(item);

                    /** as tall as each row wrapped to, or its declared height */
                    const heights = heightsFor(item, item.row, item.rowHeights);

                    /**
                     * a row taller than an empty page can never be placed by the normal
                     * rule, and asking for a new page forever is an infinite loop.
                     * detect it once, up front, and fall back to one row per page.
                     *
                     * The tallest one is what decides it now: with wrapping, one
                     * row of a thousand can be the one that does not fit.
                     */
                    const tallest = Math.max(item.rowHeight ?? 0, ...heights);
                    const rowFitsAnyPage = freshPageHeight - tblHeaderHgt >= tallest;

                    if (!rowFitsAnyPage) {
                        console.warn(
                            `Table "${item.id}": its tallest row is ${Math.ceil(tallest)}px, ` +
                            `which with the ${tblHeaderHgt}px header exceeds the ` +
                            `${freshPageHeight}px printable page. Falling back to one row ` +
                            `per page; rows will overflow their page.`
                        );
                    }

                    while (currIdx < rowLen) {
                        /** the table starts at tableY, so only what is below it is usable */
                        const roomHgt = detailZone() - tableY;

                        let canFitRows = rowsThatFit(
                            heights, currIdx, roomHgt - tblHeaderHgt, rowLen - currIdx);

                        /** on a page we have already emptied, take one row anyway so currIdx advances */
                        const isFreshPage = calBand.items.length === 0
                            && tableY === 0
                            && detailZone() >= freshPageHeight;

                        if (canFitRows < 1 && isFreshPage) canFitRows = 1;

                        if (canFitRows < 1) {
                            /** anything already placed on this page must land before we leave it */
                            calBand = breakPage(calBand, band, itemY);
                            tableY = 0;
                            continue;
                        }

                        canFitRows = Math.min(canFitRows, rowLen - currIdx);

                        let dupItem = structuredClone(item);

                        const rows = item.row.slice(currIdx, currIdx + canFitRows);

                        const occHgt =
                            sliceHeight(heights, currIdx, canFitRows) + tblHeaderHgt;

                        dupItem.row = rows;
                        /** the slice carries its own heights, so the renderer needs no arithmetic */
                        dupItem.rowHeights = heights.slice(currIdx, currIdx + canFitRows);
                        dupItem.y = tableY;
                        dupItem.measuredHeight = occHgt;

                        place(calBand, dupItem);

                        currIdx += rows.length;
                        const hasMoreRows = currIdx < rowLen;

                        /**
                         * only push when we are leaving this page behind
                         * the final partial band is handed to the flush after the item loop
                         */
                        if (hasMoreRows) {
                            calBand = breakPage(calBand, band, itemY);
                            tableY = 0;
                        }
                    }
                }

            }
            else {
                /**
                 * a grouped table that never splits still has to reach render as
                 * fragments, otherwise its group bands only appear on reports long
                 * enough to overflow.
                 */
                const placed = item.type === "table" && item.groups
                    ? { ...item, groups: wholeGroupFragments(item) }
                    : item;

                place(calBand, { ...structuredClone(placed), y: pageY(itemY) });
            }

            /**
             * The item has landed. Whatever it turned out to be worth is what
             * the items still to be placed have to clear, so record it.
             *
             * It is read back out of the band rather than remembered, because
             * the branches above place an item by several routes - whole,
             * split, grouped - and what they all agree on is that the last
             * thing to reach the band being built is this item.
             */
            const drawn = [...calBand.items]
                .reverse()
                .find(one => one.id === item.id);

            if (drawn) {
                grown.push({
                    designBottom: (itemY - carry) + designHeight(item),
                    actualBottom: (drawn.y ?? 0) + (drawn.measuredHeight ?? 0)
                });
            }
        }

        /** after the loop if their is any kind of data is their in calBand */
        if (calBand.items.length > 0) {
            currentPage.bands.push(calBand);
            calBand = {
                ...band, items: []
            };
        }

    }


    /**
     * The report footer takes a zone above the page footer on the last page,
     * which shrinks that page's detail zone. If the detail already filled more
     * than the smaller zone allows, the footer starts a page of its own.
     */
    if (reportFooter) {
        const zone = bandZoneHeight(reportFooter, availableHeight);

        if (currentPage.usedHeight + zone > availableHeight) {
            currentPage = newPage(pages.length + 1, context);
            pages.push(currentPage);
        }

        currentPage.bands.push(structuredClone(reportFooter));
        currentPage.usedHeight += zone;
    }

    /** the last page is only known now, so its zones are recomputed here */
    const lastPage = pages[pages.length - 1];
    lastPage.regions = context.regionsFor(lastPage.pageNO, Boolean(reportFooter));

    anchorBands(pages);

    return pages;
}


/**
 * Gives every placed band the top of its zone, in coordinates relative to the
 * printable area. This is what the renderer positions against, and it is the
 * whole point of the exercise: the page footer's top comes from the bottom of
 * the page, never from how far the detail happened to reach.
 * @param {object[]} pages
 */
function anchorBands(pages) {
    for (const page of pages) {
        for (const band of page.bands) {
            const zone = page.regions[band.type] ?? page.regions.detail;

            band.top = zone.top;
            band.zoneHeight = zone.height;
        }
    }
}

/**
 * Whether any group of a table has to start a page of its own.
 * @param {object} item a table
 * @returns {boolean}
 */
function breaksPages(item) {
    return Array.isArray(item.groups) && item.groups.some((grp, n) => startsPage(item, grp, n));
}


/**
 * Every group of a table that fits on one page, as unsplit fragments. Gives the
 * no-overflow path the same shape the splitting path produces.
 * @param {object} item the table item carrying groups, and its own group bands
 * @returns {object[]}
 */
function wholeGroupFragments(item) {
    return item.groups.map((grp, n) => groupFragment(
        grp, groupFrame(item, grp, n === 0, true), grp.rows, grp.rowHeights, true));
}


/**
 * One group's rows on one page, with the bands drawn around them resolved for
 * that group - which is everything render/ needs to draw it.
 *
 *   showHeader    whether the table's column labels head this fragment
 *   showFooter    whether this fragment ends its group
 *   headerBands   the group headers over the rows, outermost first
 *   footerBands   the group footers under them, innermost first
 *   headerBand    the innermost level's header, when it is drawn here, and
 *   footerBand    its footer: all of a one-level table's group bands, under
 *                 the names they have always had
 *
 * Each band in the lists carries `level`, 0 for the outermost.
 *
 * @param {object} grp the innermost group, from group.js
 * @param {{columnHeader: boolean, headers: object[], footers: object[]}} frame from groupFrame
 * @param {object[]} rows the rows placed
 * @param {number[]} rowHeights their heights
 * @param {boolean} ends whether this is the group's last fragment
 * @returns {object}
 */
function groupFragment(grp, frame, rows, rowHeights, ends) {
    const innermost = (grp.levels?.length ?? 1) - 1;

    const resolved = ({ level, band }) => resolveGroupBand(
        band, grp.levels?.[level] ?? grp, rows[0], level);

    const headerBands = frame.headers.map(resolved);
    const footerBands = frame.footers.map(resolved);

    return {
        key: grp.key,
        path: grp.path ?? [grp.key],
        rows,
        rowHeights,
        aggregates: grp.aggregates,
        showHeader: frame.columnHeader,
        showFooter: ends,
        headerBands,
        footerBands,
        headerBand: headerBands.find(band => band.level === innermost) ?? null,
        footerBand: footerBands.find(band => band.level === innermost) ?? null
    };
}


/**
 * Fills in a groupHeader / groupFooter template for one group fragment.
 * Unlike the aggregate pass in group.js this keeps the literal text around a
 * placeholder, so "Subtotal: {sum(price)}" stays "Subtotal: 160".
 * @param {object|null} bandTemplate the table's own groupHeader / groupFooter band
 * @param {object} grp the group the band is drawn for, carrying its aggregates -
 *   for an outer level's band, that level's group
 * @param {object} sampleRow any row of the group - all share the groupBy value
 * @param {number} [level=0] the level the band is drawn for
 * @returns {object|null} a resolved clone, or null when no template exists
 */
function resolveGroupBand(bandTemplate, grp, sampleRow, level = 0) {
    if (!bandTemplate) return null;

    const resolved = structuredClone(bandTemplate);
    resolved.level = level;

    for (const item of resolved.items) {
        if (item.type !== "text") continue;
        /**
         * Build on `text`, not `value` - resolve.js has already put the root
         * data in and deliberately left everything group-scoped standing.
         */
        const sole = soleKey(item.value);

        item.text = (item.text ?? item.value).replace(REGEX, (match, key) => {
            const found = groupPlaceholder(match, key.trim(), grp, sampleRow);

            /** the value itself, for an item that prints nothing else - a subtotal */
            if (sole === key.trim() && found.value !== undefined) {
                item.raw = found.value;
                if (found.share) item.rawFormat = percentFormat(item.format);
            }

            if (found.value === undefined) return found.text;
            if (found.value == null) return '';
            if (found.share) return formatValue(found.value, percentFormat(item.format));
            return formatValue(found.value, found.count ? null : item.format);
        });

        /** a subtotal's rules, asked of this group's total; a field reads the group's row */
        const lit = highlightFor(item.highlight, shownValue(item), sampleRow);
        if (lit) item.highlighted = lit;
    }

    return resolved;
}


/**
 * Resolves one placeholder inside a group band. An aggregate expression reads
 * the group's own aggregates; anything else reads a field off the group's rows.
 * {page} and {totalPages} are left standing - the page they land on is not
 * known until every page exists, so resolve() fills those in at the end.
 * @param {string} match the whole `{...}` token
 * @param {string} key
 * @param {object} grp
 * @param {object} sampleRow
 * @returns {{text?: string, value?: *, count?: boolean}} `text` for a token
 *   left standing, else the `value` it stands for - formatted by the caller
 */
function groupPlaceholder(match, key, grp, sampleRow) {
    if (PAGE_KEYS.includes(key)) return { text: match };

    const expr = key.match(/^(\w+)\((.*?)\)$/);

    if (expr) {
        const [, fn, field] = expr;
        return {
            value: grp.aggregates?.[field]?.[fn.trim()] ?? null,
            count: fn.trim() === 'count',
            share: fn.trim() === PERCENTAGE
        };
    }

    return { value: sampleRow?.[key] ?? null };
}


/**
 * this is fn to create new pages whenever the report need
 * so while creating the page itself we reserve the place for the
 * header and footer of the page
 * @param {Int16Array} pageNO 
 * @param {object} context 
 * @returns object
 */
function newPage(pageNO, context) {
    const { pageHeader, pageFooter, reportHeader } = context.assignedBands;

    const regions = context.regionsFor(pageNO, false);
    const bands = [];

    if (pageHeader) bands.push(structuredClone(pageHeader));
    if (pageFooter) bands.push(structuredClone(pageFooter));

    /** the report header owns a zone of its own, on the first page only */
    if (reportHeader && pageNO === 1) bands.push(structuredClone(reportHeader));

    return {
        pageNO,
        bands,
        regions,

        /**
         * Everything the header and footer zones have already taken. The loop
         * reads capacity as availableHeight - usedHeight, which is now exactly
         * the detail zone rather than whatever the stack happened to leave.
         */
        usedHeight: context.availableHeight - regions.detail.height
    };
}


/**
 * calculates the available space so assign the bands in a report
 * so the available here actually calculated as
 * page height - (every page will contain margin so) page margin
 * here for margin we only consider the top and bottom because we are calculating the hgt
 * @param {object} page 
 * @returns 
 */
function calAvailableHeight(page) {
    return page.height - (page.margin.top + page.margin.bottom);
}

/**
 * Fills in {page} and {totalPages}, which only become knowable once every page
 * exists. Spec 3.4 allows both in any band, not just the page footer.
 *
 * This works on `text`, never on `value`. Re-resolving from `value` here would
 * throw away everything resolve.js and group.js already put in, which is why
 * those stages leave these two tokens standing rather than blanking them.
 * @param {object[]} pages
 * @returns {object[]} the same pages
 */
function resolve(pages) {
    for (const page of pages) {
        for (const band of page.bands) {
            resolvePageKeys(band, page.pageNO, pages.length);
        }
    }
    return pages;
}


/**
 * Walks one band, including the group header and footer bands carried inside a
 * grouped table's fragments - those never appear in page.bands of their own.
 * @param {object} band
 * @param {number} pageNO
 * @param {number} totalPages
 */
function resolvePageKeys(band, pageNO, totalPages) {
    for (const item of (band?.items ?? [])) {
        if (item.type === "text") {
            const source = item.text ?? item.value ?? '';
            if (!source.includes('{')) continue;

            item.text = source.replace(REGEX, (match, key) => {
                switch (key.trim()) {
                    case "page":
                        return pageNO;
                    case "totalPages":
                        return totalPages;
                    default:
                        return match;
                }
            });
            continue;
        }

        if (item.type === "table" && item.groups) {
            for (const fragment of item.groups) {
                const { headers, footers } = fragmentBandsOf(fragment);
                for (const groupBand of [...headers, ...footers]) {
                    resolvePageKeys(groupBand, pageNO, totalPages);
                }
            }
        }
    }
}