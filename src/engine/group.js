export function group(resolvedJson, data) {
    const json = structuredClone(resolvedJson);
    const hasGroup = data.groupBy != null;
    if (hasGroup) {
        return withGroup(json, data);
    } else {
        return withoutGroup(json, data);
    }
}


function withGroup(json, data) {
    const bands = json.bands;
    const tableBand = findTableBand(bands);
    const groupedData = groupedRows(data[tableBand.dataset], data.groupBy);
}


function withoutGroup(json, data) {
    const bands = json.bands;
    const tableBand = findTableBand(bands);
    tableBand.row = data[tableBand.dataset];
    aggregate(bands, data[tableBand.dataset]);
    return json;
}

function findTableBand(bands) {
    for (const band of bands) {
        for (const item of band.items) {
            if (item.type == "table") {
                return item;
            }
        }
    }
}


function aggregate(bands, dataset) {
    for (const band of bands) {
        for (const item of band.items) {
            if (item.type == "text") {
                const match = item.value.match(/\{([^}]+)\}/);
                if (!match) continue;
                const aggregateExpr = parseAggregate(match[1]);
                switch (aggregateExpr?.key) {
                    case 'sum':
                        const sum = dataset.reduce((acc, row) => acc + (parseFloat(row[aggregateExpr.field]) || 0), 0);
                        item.text = sum.toString();
                        break;
                    case 'count':
                        item.text = dataset.length.toString();
                        break;
                    case 'avg':
                        const avg = dataset.reduce((acc, row) => acc + (parseFloat(row[aggregateExpr.field]) || 0), 0) / dataset.length;
                        item.text = avg.toString();
                        break;
                    default:
                        console.debug(`No aggregate function found for key: ${aggregateExpr?.key}`);
                }
            }
        }
    }
}


function parseAggregate(expr) {
    const match = expr.match(/^(\w+)\((.*?)\)$/);
    if (!match) return null;
    return {
        key: match[1],
        field: match[2]
    }
}


function groupedAggregate(bands, dataset) {
    const groupFooter = null;
}


function groupedRows(dataset, groupBy) {
    const grouped = {};
    for (const row of dataset) {
        const key = row[groupBy];
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(row);
    }
    return grouped;
}