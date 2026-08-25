
const REGEX = /\{([^{}]+)\}/g;



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
            details: paginateJSON.bands.find(b => b.type === "details"),
            groupHeader: paginateJSON.bands.find(b => b.type === "groupHeader") || null,
            groupFooter: paginateJSON.bands.find(b => b.type === "groupFooter") || null,
        }
    };


    context.availableHeight = calAvailableHeight(paginateJSON.page);


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
    const { reportFooter, reportHeader, groupHeader, groupFooter } = assignedBands;


    // handling the first page 
    // note : need to handle overflow
    if (reportHeader) {
        currentPage.bands.push(reportHeader);
        currentPage.usedHeight += reportHeader.measuredHeight;
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
                if (calBand.items.length > 0) currentPage.bands.push(calBand);

                currentPage = newPage(pages.length + 1, context);
                currentPage.bands.push(calBand);
                pages.push(currentPage);

                calBand = {
                    ...band, items: []
                };

                
                calBand.items.push(item);
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

                            const hasMinHgt = remainingHgt >= reservedSpace;

                            /** while the {hasMinHgt} is false then create new page */
                            if (!hasMinHgt) {
                                if (calGroups.length > 0) {
                                    let dupItem = structuredClone(item);

                                    dupItem.groups = calGroups;
                                    calBand.items.push(dupItem);
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

                            canFitRows = Math.min(
                                canFitRows,
                                rowLen - currIdx
                            );

                            if (canFitRows <= 0) continue;


                            const rows = grp.rows.slice(currIdx, currIdx + canFitRows);

                            currIdx += rows.length;

                            const hasMoreRows = currIdx < rowLen;

                            const occHgt = (rows.length * item.rowHeight) + (grpHeaderHgt + tblHeaderHgt) + (!hasMoreRows ? grpFooterHgt : 0);

                            calItemHeight += occHgt;

                            let grpFragment = {
                                key: grp.key,
                                rows: rows,
                                aggregates: grp.aggregates,
                                showHeader: true,
                                showFooter: !hasMoreRows
                            }

                            currentPage.usedHeight += occHgt;

                            calGroups.push(grpFragment);
                        }
                    }

                    if (calGroups.length > 0) {
                        const dupItem = structuredClone(item);

                        dupItem.groups = calGroups;
                        dupItem.measuredHeight = calItemHeight;

                        calBand.measuredHeight =
                            calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);

                        calBand.items.push(dupItem);
                        currentPage.bands.push(calBand);

                        calGroups = [];
                    }

                } else {
                    const rowLen = item.row.length;
                    let currIdx = 0;

                    while (currIdx < rowLen) {
                        const remainingHgt = availableHeight - currentPage.usedHeight;

                        const canFitRows = Math.floor((remainingHgt - (item.showHeader ? item.headerHeight : 0)) / item.rowHeight);


                        if (remainingHgt <= 0 || canFitRows < 1) {
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
                        currentPage.bands.push(calBand);


                        currIdx += rows.length;
                        const hasMoreRows = currIdx < rowLen;

                        if (hasMoreRows) {
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
                calBand.items.push(item);
                calBand.measuredHeight =
                    calBand.items.reduce((sum, item) => sum + item.measuredHeight, 0);
                currentPage.usedHeight += item.measuredHeight;
            }
        }

    }


    // handle report footer
    if (reportFooter) {
        if (
            currentPage.usedHeight + reportFooter.measuredHeight > availableHeight
        ) {
            currentPage = newPage(pages.length + 1, context);
            pages.push(currentPage);
        }
        currentPage.bands.push(reportFooter);
        currentPage.usedHeight += reportFooter.measuredHeight;
    }

    return pages;
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
    const { pageHeader, pageFooter } = context.assignedBands;

    const bands = [];

    if (pageHeader) {
        bands.push(structuredClone(pageHeader));
    }

    if (pageFooter) {
        bands.push(structuredClone(pageFooter));
    }

    return {
        pageNO,
        bands,
        usedHeight:
            (pageHeader?.measuredHeight ?? 0) +
            (pageFooter?.measuredHeight ?? 0),
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

function resolve(pages) {
    for (const page of pages) {
        for (const band of page.bands) {
            if (band.type == "pageFooter") {
                for (const item of band.items) {
                    if (item.type == "text") {
                        item.text = item.value.replace(REGEX, (match, key) => {
                            switch (key) {
                                case "page":
                                    return page.pageNO;
                                case "totalPages":
                                    return pages.length;
                                default:
                                    return "";
                            }
                        })
                    }
                }
            }
        }
    }
    return pages;
}