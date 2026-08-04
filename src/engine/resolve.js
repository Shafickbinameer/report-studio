/**
 * The resolve.js is used to analysis the incoming json using regex and 
 * replacing the only the text content into actual data given by the user
 * so the input are @param rptJson and @param rptData
 */


const REGEX = /\{([^{}]+)\}/g;


/**
 * Resolves the report JSON with the provided data
 * @param {*} rptJson 
 * @param {*} rptData 
 * @returns 
 */
export function resolve(rptJson, rptData) {
    try {
        // cloning the report json and assigning it to new var
        // so that report will not affect
        const resolved = structuredClone(rptJson);

        for (const band of resolved.bands) {
            for (const item of band.items) {
                if (item.type == "text")
                    item.text = resolveTxt(item, rptData);
            }
        }

        return resolved;
    } catch (err) {
        console.error(`Resolve error. message : ${err}`);
    }
}


/**
 * Resolves the text value of an item with the provided data
 * @param {*} item 
 * @param {*} rptData 
 * @returns 
 */
function resolveTxt(item, rptData) {
    return item.value.replace(REGEX, (match, key) => {
        return validatePlaceHolder(key, rptData);
    })
}

/**
 * Validate the given and find weather the key is system keys or not
 * in-case of system keys return appropriate value
 * eg : key == today the return current date
 * @param {*} key 
 * @param {*} rptData 
 * @returns 
 */
function validatePlaceHolder(key, rptData) {
    if (key.includes('(') && key.includes(')')) return '';

    if (key == 'page' || key == 'totalPages') {
        console.debug(`System key found: ${key}. Deferred until pagination.`);
        return '';
    };

    if (key == 'today') return new Date().toISOString().slice(0, 10);

    const value = findVal(key, rptData);

    if (value === undefined) {
        console.warn(`Unresolved placeholders: ${key}`);
        return '';
    }

    return String(value);
}


/**
 * Helps to find the value from the given data
 * @param {*} key 
 * @param {*} rptData 
 * @returns 
 */
function findVal(key, rptData) {
    return key.split('.').reduce(
        (obj, key) => {
            return obj?.[key];
        }, rptData
    );
}




