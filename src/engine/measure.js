export function measure(json) {
    let H = 0;
    const page = json.page;
    const noOfGroups = json.bands.flatMap(band => band.items || [])
        .find(item => item.type == 'table')?.groups.length || 0;
    console.debug(noOfGroups);
    for (const band of json.bands) {
        if (band.type == 'detail') {
            H = H + detailBand(band, json.groupBy);
            continue;
        }

        if (band.type == 'groupHeader' || band.type == 'groupFooter') {
            H = H + (band.height * noOfGroups);
            continue;
        }

        H = H + band.height;
    }
    return H + page.margin.top + page.margin.bottom;
}

function detailBand(band, group) {
    let h = 0;
    let axisY = null;

    for (const item of band.items) {

        if (item.type == ' text') {
            if (axisY != null && axisY == item.y) continue;
            h = h + item.h;
            axisY = item.y
        }

        if (item.type == 'table') {
            let datasetLength = 0;
            if (group != null) {
                for (const group of item.groups) {
                    datasetLength += group.rows.length;
                }
            } else {
                datasetLength = item.row.length;
            }
            h = h + (datasetLength * item.rowHeight) + item.headerHeight;
        }
    }

    return h;
}