

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
            groupHeader: paginateJSON.bands.find(b => b.type === "groupHeader") || [],
            groupFooter: paginateJSON.bands.find(b => b.type === "groupFooter") || [],
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

    paginateJSON.pages = calPages(flowBands, context);

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
                currentPage.usedHeight += item.measuredHeight;

            }
            else if ((item.measuredHeight + currentPage.usedHeight) > availableHeight && item.type == "table") {

                // when the table has group
                if (group !== null) {
                    for (const group of item.groups) {
                        const remainingHgt = availableHeight - currentPage.usedHeight;
                        if (remainingHgt > groupHeader.measuredHeight + item.rowHeight) {

                        } else {
                            currentPage = newPage(pages.length + 1, context);
                            pages.push(currentPage);
                            calBand = {
                                ...band, items: []
                            };
                            continue;
                        }
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

                        const occHgt = (canFitRows * item.rowHeight) + item.headerHeight;


                        dupItem.row = rows;
                        dupItem.measuredHeight = occHgt;

                        calBand.items.push(dupItem);
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