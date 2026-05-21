// Bootstrap for worker_threads when the worker target is a .ts file.
// Node's --import flag does not propagate the tsx loader into workers, so we
// register tsx explicitly here, then dynamically import the actual worker.
import { register } from 'tsx/esm/api';
import { workerData } from 'node:worker_threads';
register();
await import(workerData.target);
