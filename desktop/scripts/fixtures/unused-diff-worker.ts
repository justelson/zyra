import { mock } from 'bun:test'

// Plain Bun presentation tests import the real chat header, which also imports
// developer diffs. Vite owns the worker loader; these fixtures never open diffs.
// Keep the import boundary available and fail if a test actually requests it.
mock.module('@pierre/diffs/worker/worker.js?worker', () => ({
    default: class UnusedDiffWorker {
        constructor() { throw new Error('Unexpected diff worker in static presentation fixture') }
    }
}))
