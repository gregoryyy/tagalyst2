const memoryStore: Record<string, any> = {};

const chrome = {
    storage: {
        local: {
            get: (keys: string[] | string | null, cb: (items: Record<string, any>) => void) => {
                if (keys === null || typeof keys === 'undefined') {
                    cb({ ...memoryStore });
                    return;
                }
                const keyArr = Array.isArray(keys) ? keys : [keys];
                const result: Record<string, any> = {};
                keyArr.forEach(k => { result[k] = memoryStore[k]; });
                cb(result);
            },
            set: (items: Record<string, any>, cb: () => void) => {
                Object.assign(memoryStore, items);
                cb();
            },
            clear: (cb: () => void) => {
                Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
                cb();
            },
        },
    },
};

export default chrome;
export { chrome };
