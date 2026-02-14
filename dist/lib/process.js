"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const SIGNALS = ['SIGINT', 'SIGTERM'];
/**
 * Runs a function with an abort signal that will be triggered when the process
 * receives a termination signal.
 */
async function run(fn) {
    const killController = new AbortController();
    const abort = (signal) => {
        for (const sig of SIGNALS)
            process.off(sig, abort);
        killController.abort(signal);
    };
    for (const sig of SIGNALS)
        process.on(sig, abort);
    try {
        await fn(killController.signal);
    }
    finally {
        abort();
    }
}
