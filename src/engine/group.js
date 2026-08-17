export function group(resolvedJson, data) {
    let json = structuredClone(resolvedJson);
    const hasGroup = json.groupBy != null;
    if (hasGroup) {
        return withGroup(json, data);
    } else {
        return withoutGroup(json, data);
    }
}


function withGroup(json, data) {
    const bands = json.bands;
    const tableBand = findTableBand(bands);
    const groupedData = groupedRows(data[tableBand.dataset], json.groupBy);
    const groupedAggregates = groupedAggregate(bands, groupedData);
    tableBand.groups =
        Object.entries(groupedData).map(
            ([key, rows]) => ({
                key,
                rows,
                aggregates: groupedAggregates[key]
            })
        );
    aggregate(bands, data[tableBand.dataset]);
    return json;
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
                const opera = arithmeticOpera(item, dataset);
                if (opera == null) continue;
                item.text = opera.text;
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


function groupedAggregate(bands, dataset, groupBy) {
    const aggregates = {};
    for (const band of bands) {
        if (band.type === "groupFooter") {
            for (const item of band.items) {
                if (item.type == "text") {
                    for (const [key, data] of Object.entries(dataset)) {
                        if (!aggregates[key]) {
                            aggregates[key] = {
                                count: null,
                                sum: null,
                                avg: null,
                                min: null,
                                max: null
                            };
                        }
                        const opera = arithmeticOpera(item, data);

                        if (!opera) continue;

                        switch (opera.key) {
                            case 'count':
                                aggregates[key].count = Number(opera.text);
                                break;

                            case 'sum':
                                aggregates[key].sum = Number(opera.text);
                                break;
                            case 'avg':
                                aggregates[key].avg = Number(opera.text);
                                break;
                            case 'max':
                                aggregates[key].max = Number(opera.text);
                                break;
                            case 'min':
                                aggregates[key].min = Number(opera.text);
                                break;
                        }
                    }
                }
            }
        }
    }
    return aggregates;
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


function arithmeticOpera(item, dataset) {
    const match = item.value.match(/\{([^}]+)\}/);
    if (!match) return null;
    const aggregateExpr = parseAggregate(match[1]);
    switch (aggregateExpr?.key) {
        case 'sum':
            const sum = dataset.reduce((acc, row) => acc + (parseFloat(row[aggregateExpr.field]) || 0), 0);
            return {
                ...aggregateExpr,
                text: sum.toString()
            };
            break;
        case 'count':
            return {
                ...aggregateExpr,
                text: dataset.length.toString()
            };
            break;
        case 'avg':
            const avg = dataset.reduce((acc, row) => acc + (parseFloat(row[aggregateExpr.field]) || 0), 0) / dataset.length;
            return {
                ...aggregateExpr,
                text: avg.toString()
            };
            break;
        case 'max':
            const max = Math.max(
                ...dataset.map(row => Number(row[aggregateExpr.field]) || 0)
            );
            return {
                ...aggregateExpr,
                text: max.toString()
            };
            break;
        case 'min':
            const min = Math.min(
                ...dataset.map(row => Number(row[aggregateExpr.field]) || 0)
            );
            return {
                ...aggregateExpr,
                text: min.toString()
            };
            break;
        default:
            console.debug(`No aggregate function found for key: ${aggregateExpr?.key}`);
            return null;
    }
}