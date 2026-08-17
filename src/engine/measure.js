export function measure(json) {
    let measureJson = structuredClone(json);
    const page = measureJson.page;
    const noOfGroups = measureJson.groupBy != null ? measureJson.bands.flatMap(band => band.items || [])
        .find(item => item.type == 'table')?.groups.length || 0 : 0;


    for (const band of measureJson.bands) {
        if (!band.items) continue;
        calItemHgt(band, measureJson.groupBy);
    }
    return measureJson;
}


function calItemHgt(band, group) {
    let calBandHgt = 0;
    let axisY = null;
    for (const item of band.items) {
        switch (item.type) {
            case 'text':
                item.measuredHeight = item.h;
                if (axisY != null && axisY == item.y) continue;
                calBandHgt += item.measuredHeight;
                break
            case 'table':
                let datasetLength = 0;

                if (group != null) {
                    for (const group of item.groups) {
                        datasetLength += group.rows.length;
                    }
                } else {
                    datasetLength = item.row.length;
                }
                item.measuredHeight = datasetLength * item.rowHeight
                calBandHgt += item.measuredHeight;
                break;
            default:
                console.warn("Invalid item type");
        }

        axisY = item.y;
    }
    band.measuredHeight = calBandHgt;
    return band;
}