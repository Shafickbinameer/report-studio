
import { pageRegions, bandZoneHeight } from './regions.js';


const REGEX = /\{([^{}]+)\}/g;

/** placeholders only this stage can resolve, once the page count is known */
const PAGE_KEYS = ['page', 'totalPages'];



export function paginate(json) {
    const paginateJSON = structuredClone(json);


    let context = {
        page: paginateJSON.page,
        bands: paginateJSON.bands,
        group: paginateJSON.groupBy,
        assignedBands: {
            reportHeader: paginateJSON.bands.find(b => b.type === "reportHeader"),
            reportFooter: paginateJSON.bands.find(b => b.type === "reportFooter"),
            pageHeader: paginateJSON.bands.find(b => b.type === "pageHeader"),
            pageFooter: paginateJSON.bands.find(b => b.type === "pageFooter"),
            detail: paginateJSON.bands.find(b => b.type === "detail"),
            groupHeader: paginateJSON.bands.find(b => b.type === "groupHeader") || null,
            groupFooter: paginateJSON.bands.find(b => b.type === "groupFooter") || null,
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


function calPages(bands, context) {
    let pages = [];

    // initial page creation
    let currentPage = newPage(1, context);
    pages.push(currentPage);

    // spreading the report header and footer from the context.assignedBands
    const { assignedBands, availableHeight, group } = context;
    const { reportFooter, reportHeader, groupHeader, groupFooter, pageHeader, pageFooter } = assignedBands;

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


    for (const band of bands) {
        let calBand = {
            ...band,
            items: []
        };

        /** the shift belongs to one band's coordinate space, not to the page */
        carry = 0;

        /**
         * Top to bottom, not file order. Items are absolutely positioned, so
         * where one sits on the page is its `y` and nothing else - walking them
         * in declaration order let a header text written after the table get
         * carried to whatever page the table happened to end on.
         */
        const ordered = [...band.items].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));

        for (const item of ordered) {
            const itemY = item.y ?? 0;
            const localBottom = (itemY - carry) + item.measuredHeight;

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

                place(calBand, { ...structuredClone(item), y: itemY - carry });
            }
            else if (localBottom > detailZone() && item.type == "table") {

                /**
                 * Where the next slice of this table starts inside the band. The
                 * first slice keeps the y the designer gave it, because whatever
                 * sits above it is on this page too. A continuation slice has
                 * nothing above it, so it starts at the top of the zone rather
                 * than leaving that gap blank on every page.
                 */
                let tableY = itemY - carry;

                // when the table has group
                if (group !== null) {
                    /**  reserved hgt for group table at least i a page we should fit this
                    * table header, group header, min of one row and the group footer
                    * also provide the table header hgt , group header and footer hgt
                    */
                    const grpHeaderHgt = groupHeader?.measuredHeight ?? 0;
                    const grpFooterHgt = groupFooter?.measuredHeight ?? 0;
                    const tblHeaderHgt = item?.headerHeight ?? 0;
                    const reservedSpace =
                        tblHeaderHgt + grpHeaderHgt + item.rowHeight + grpFooterHgt;

                    /**
                     * same trap as the ungrouped path: if the minimum viable slice
                     * (table header + group header + one row + group footer) is taller
                     * than an empty page we would allocate pages forever.
                     */
                    const sliceFitsAnyPage = reservedSpace <= freshPageHeight;

                    if (!sliceFitsAnyPage) {
                        console.warn(
                            `Table "${item.id}": table header + group header + one row + group footer ` +
                            `(${reservedSpace}px) exceeds the ${freshPageHeight}px printable page. ` +
                            `Falling back to one row per page; rows will overflow their page.`
                        );
                    }

                    /**
                     * How many rows of a group fit in {room} px.
                     *
                     * The group footer only prints on the fragment that finishes the
                     * group, so it is reserved only when this page could actually
                     * finish it. Without that the last slice of a group added
                     * grpFooterHgt that nobody had budgeted for, and the detail band
                     * grew past its zone straight over the page footer.
                     *
                     * When the rows would fit but the footer would not, one row is
                     * deliberately held back so the footer lands on the next page
                     * beside a row rather than alone.
                     * @param {number} room px left in the detail zone below the table top
                     * @param {number} rowsLeft rows still unplaced in this group
                     * @returns {number} rows to place now, possibly 0
                     */
                    const fitRows = (room, rowsLeft) => {
                        const body = room - grpHeaderHgt - tblHeaderHgt;

                        const withFooter =
                            Math.floor((body - grpFooterHgt) / item.rowHeight);

                        /** the group ends here, so its footer has to fit here too */
                        if (rowsLeft <= withFooter) return rowsLeft;

                        return Math.min(
                            Math.floor(body / item.rowHeight),
                            rowsLeft - 1
                        );
                    };


                    /**
                     * this groups variable helps us to know for current page how much groups are their
                     */
                    let calGroups = [];

                    let calItemHeight = 0; // used to cal the item hgt



                    /**
                     * Looping the group to allocate it to the bands
                     * so while looping we will gonna loop every groups (grp A, grp B etc...)
                     * at first push table and group header input the calBand
                     * then push the can fit rows to the calBand
                     */


                    for (const grp of item.groups) {


                        let currIdx = 0;
                        const rowLen = grp.rows.length;

                        while (currIdx < rowLen) {

                            /** the table starts at tableY, so only what is below it is usable */
                            const roomHgt = detailZone() - tableY - calItemHeight;

                            /** a page we have already emptied cannot be emptied again - take the slice as is */
                            const isFreshPage = calGroups.length === 0
                                && calBand.items.length === 0
                                && tableY === 0
                                && detailZone() >= freshPageHeight;

                            /**
                             * Rows this page can take. fitRows reserves the group
                             * footer whenever the group would end here, so the slice
                             * it hands back always fits the detail zone.
                             */
                            let canFitRows = fitRows(roomHgt, rowLen - currIdx);

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

                            currIdx += rows.length;

                            const hasMoreRows = currIdx < rowLen;

                            const occHgt = (rows.length * item.rowHeight) + (grpHeaderHgt + tblHeaderHgt) + (!hasMoreRows ? grpFooterHgt : 0);

                            calItemHeight += occHgt;

                            /**
                             * groupHeader / groupFooter are templates, not flow bands - they never
                             * land on a page of their own. Resolve them per fragment here, where the
                             * group's own rows and aggregates are in hand, so render/ only has to draw.
                             */
                            let grpFragment = {
                                key: grp.key,
                                rows: rows,
                                aggregates: grp.aggregates,
                                showHeader: true,
                                showFooter: !hasMoreRows,
                                headerBand: resolveGroupBand(groupHeader, grp, rows[0]),
                                footerBand: !hasMoreRows
                                    ? resolveGroupBand(groupFooter, grp, rows[0])
                                    : null
                            }

                            calGroups.push(grpFragment);
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

                    const tblHeaderHgt = item.showHeader ? item.headerHeight : 0;

                    /**
                     * a row taller than an empty page can never be placed by the normal
                     * rule, and asking for a new page forever is an infinite loop.
                     * detect it once, up front, and fall back to one row per page.
                     */
                    const rowFitsAnyPage =
                        Math.floor((freshPageHeight - tblHeaderHgt) / item.rowHeight) >= 1;

                    if (!rowFitsAnyPage) {
                        console.warn(
                            `Table "${item.id}": rowHeight ${item.rowHeight} plus header ${tblHeaderHgt} ` +
                            `exceeds the ${freshPageHeight}px printable page. Falling back to one row per page; ` +
                            `rows will overflow their page.`
                        );
                    }

                    while (currIdx < rowLen) {
                        /** the table starts at tableY, so only what is below it is usable */
                        const roomHgt = detailZone() - tableY;

                        let canFitRows = Math.floor((roomHgt - tblHeaderHgt) / item.rowHeight);

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

                        const occHgt = (rows.length * item.rowHeight) + tblHeaderHgt;

                        dupItem.row = rows;
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
                    ? { ...item, groups: wholeGroupFragments(item, groupHeader, groupFooter) }
                    : item;

                place(calBand, { ...structuredClone(placed), y: itemY - carry });
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
 * Every group of a table that fits on one page, as unsplit fragments. Gives the
 * no-overflow path the same shape the splitting path produces.
 * @param {object} item the table item carrying groups
 * @param {object|null} groupHeader
 * @param {object|null} groupFooter
 * @returns {object[]}
 */
function wholeGroupFragments(item, groupHeader, groupFooter) {
    return item.groups.map(grp => ({
        key: grp.key,
        rows: grp.rows,
        aggregates: grp.aggregates,
        showHeader: true,
        showFooter: true,
        headerBand: resolveGroupBand(groupHeader, grp, grp.rows[0]),
        footerBand: resolveGroupBand(groupFooter, grp, grp.rows[0])
    }));
}


/**
 * Fills in a groupHeader / groupFooter template for one group fragment.
 * Unlike the aggregate pass in group.js this keeps the literal text around a
 * placeholder, so "Subtotal: {sum(price)}" stays "Subtotal: 160".
 * @param {object|null} bandTemplate the shared groupHeader / groupFooter band
 * @param {object} grp the group being placed, carrying its aggregates
 * @param {object} sampleRow any row of the group - all share the groupBy value
 * @returns {object|null} a resolved clone, or null when no template exists
 */
function resolveGroupBand(bandTemplate, grp, sampleRow) {
    if (!bandTemplate) return null;

    const resolved = structuredClone(bandTemplate);

    for (const item of resolved.items) {
        if (item.type !== "text") continue;
        /**
         * Build on `text`, not `value` - resolve.js has already put the root
         * data in and deliberately left everything group-scoped standing.
         */
        item.text = (item.text ?? item.value).replace(
            REGEX,
            (match, key) => groupPlaceholder(match, key.trim(), grp, sampleRow)
        );
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
 * @returns {string}
 */
function groupPlaceholder(match, key, grp, sampleRow) {
    if (PAGE_KEYS.includes(key)) return match;

    const expr = key.match(/^(\w+)\((.*?)\)$/);

    if (expr) {
        const [, fn, field] = expr;
        const value = grp.aggregates?.[field]?.[fn.trim()];
        return value == null ? '' : String(value);
    }

    const value = sampleRow?.[key];
    return value == null ? '' : String(value);
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
                resolvePageKeys(fragment.headerBand, pageNO, totalPages);
                resolvePageKeys(fragment.footerBand, pageNO, totalPages);
            }
        }
    }
}