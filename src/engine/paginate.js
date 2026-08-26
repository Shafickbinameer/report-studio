
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

    for (const band of bands) {
        let calBand = {
            ...band,
            items: []
        };

        for (const item of band.items) {
            if (
                (item.measuredHeight + currentPage.usedHeight) > availableHeight && item.type != "table"
            ) {
                if (calBand.items.length > 0) {
                    currentPage.bands.push(calBand);
                    calBand = {
                        ...band, items: []
                    };
                };

                currentPage = newPage(pages.length + 1, context);
                pages.push(currentPage);

                calBand.items.push(structuredClone(item));
                calBand.measuredHeight =
                    calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);
                currentPage.usedHeight += item.measuredHeight;

            }
            else if ((item.measuredHeight + currentPage.usedHeight) > availableHeight && item.type == "table") {

                // when the table has group
                if (group !== null) {
                    /**  reserved hgt for group table at least i a page we should fit this
                    * table header, group header and min of one row
                    * also provide the table header hgt , group header and footer hgt
                    */
                    const grpHeaderHgt = groupHeader?.measuredHeight ?? 0;
                    const grpFooterHgt = groupFooter?.measuredHeight ?? 0;
                    const tblHeaderHgt = item?.headerHeight ?? 0;
                    const reservedSpace = tblHeaderHgt + grpHeaderHgt + item.rowHeight;

                    /**
                     * same trap as the ungrouped path: if the minimum viable slice
                     * (table header + group header + one row) is taller than an empty
                     * page, {hasMinHgt} never becomes true and we allocate pages forever.
                     */
                    const sliceFitsAnyPage = reservedSpace <= freshPageHeight;

                    if (!sliceFitsAnyPage) {
                        console.warn(
                            `Table "${item.id}": table header + group header + one row (${reservedSpace}px) ` +
                            `exceeds the ${freshPageHeight}px printable page. Falling back to one row per page; ` +
                            `rows will overflow their page.`
                        );
                    }


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

                            const remainingHgt = availableHeight - currentPage.usedHeight;

                            /** a page we have already emptied cannot be emptied again - take the slice as is */
                            const isFreshPage = calGroups.length === 0
                                && calBand.items.length === 0
                                && currentPage.usedHeight <= availableHeight - freshPageHeight;

                            const hasMinHgt = remainingHgt >= reservedSpace
                                || (!sliceFitsAnyPage && isFreshPage);

                            /** while the {hasMinHgt} is false then create new page */
                            if (!hasMinHgt) {
                                if (calGroups.length > 0) {
                                    let dupItem = structuredClone(item);

                                    dupItem.groups = calGroups;
                                    dupItem.measuredHeight = calItemHeight;
                                    calBand.items.push(dupItem);
                                }
                                if (calBand.items.length > 0) {
                                    calBand.measuredHeight =
                                        calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);
                                    currentPage.bands.push(calBand);
                                }
                                currentPage = newPage(pages.length + 1, context);
                                pages.push(currentPage);
                                calBand = {
                                    ...band, items: []
                                };
                                calGroups = [];
                                calItemHeight = 0;
                                continue;
                            }

                            const availableRowHgt = remainingHgt - grpHeaderHgt - tblHeaderHgt;

                            let canFitRows = Math.floor(availableRowHgt / item.rowHeight);

                            /** the oversized-slice fallback still has to place one row to make progress */
                            if (canFitRows < 1 && !sliceFitsAnyPage && isFreshPage) canFitRows = 1;

                            canFitRows = Math.min(
                                canFitRows,
                                rowLen - currIdx
                            );

                            /**
                             * {hasMinHgt} should already guarantee at least one row, so reaching
                             * here means the height figures disagree. Bail out of this group rather
                             * than spin - a silent hang is far worse than a short page.
                             */
                            if (canFitRows <= 0) {
                                console.warn(
                                    `Table "${item.id}", group "${grp.key}": no row fits despite ${remainingHgt}px ` +
                                    `remaining. Skipping ${rowLen - currIdx} row(s).`
                                );
                                break;
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

                            currentPage.usedHeight += occHgt;

                            calGroups.push(grpFragment);
                        }
                    }

                    if (calGroups.length > 0) {
                        const dupItem = structuredClone(item);

                        dupItem.groups = calGroups;
                        dupItem.measuredHeight = calItemHeight;

                        calBand.items.push(dupItem);

                        /** measure after the push so the band height includes its own table */
                        calBand.measuredHeight =
                            calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);

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
                        const remainingHgt = availableHeight - currentPage.usedHeight;

                        let canFitRows = Math.floor((remainingHgt - tblHeaderHgt) / item.rowHeight);

                        /** on a page we have already emptied, take one row anyway so currIdx advances */
                        const isFreshPage = calBand.items.length === 0
                            && currentPage.usedHeight <= availableHeight - freshPageHeight;

                        if (!rowFitsAnyPage && isFreshPage) canFitRows = 1;

                        if (remainingHgt <= 0 || canFitRows < 1) {
                            /** anything already placed on this page must land before we leave it */
                            if (calBand.items.length > 0) {
                                calBand.measuredHeight =
                                    calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);
                                currentPage.bands.push(calBand);
                            }
                            currentPage = newPage(pages.length + 1, context);
                            pages.push(currentPage);
                            calBand = {
                                ...band, items: []
                            };
                            continue;
                        }


                        let dupItem = structuredClone(item);

                        const rows = item.row.slice(currIdx, currIdx + canFitRows);

                        const occHgt =
                            (rows.length * item.rowHeight) +
                            (item.showHeader ? item.headerHeight : 0);


                        dupItem.row = rows;
                        dupItem.measuredHeight = occHgt;


                        calBand.items.push(dupItem);
                        calBand.measuredHeight =
                            calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);
                        currentPage.usedHeight += occHgt;


                        currIdx += rows.length;
                        const hasMoreRows = currIdx < rowLen;

                        /**
                         * only push when we are leaving this page behind
                         * the final partial band is handed to the flush after the item loop
                         */
                        if (hasMoreRows) {
                            currentPage.bands.push(calBand);
                            currentPage = newPage(pages.length + 1, context);
                            pages.push(currentPage);
                            calBand = {
                                ...band, items: []
                            };
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

                calBand.items.push(structuredClone(placed));
                calBand.measuredHeight =
                    calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);
                currentPage.usedHeight += item.measuredHeight;
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