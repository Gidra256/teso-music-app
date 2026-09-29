import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

const requestMetrics = new AsyncLocalStorage();

export const PERF_METRICS_ENABLED =
  process.env.PERF_METRICS === "1" || process.env.TESO_PERF_METRICS === "1";

function currentMetrics() {
  return PERF_METRICS_ENABLED ? requestMetrics.getStore() : null;
}

export function perfMetricsMiddleware(req, res, next) {
  if (!PERF_METRICS_ENABLED) return next();

  const metrics = {
    dbAcquireMs: 0,
    dbMs: 0,
    sqlQueries: 0,
    startedAt: performance.now(),
    storageMs: 0,
    storageOps: 0,
  };

  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithPerfHeaders(...args) {
    const totalMs = performance.now() - metrics.startedAt;
    res.setHeader("X-Teso-Total-Ms", totalMs.toFixed(1));
    res.setHeader("X-Teso-Db-Ms", metrics.dbMs.toFixed(1));
    res.setHeader("X-Teso-Db-Acquire-Ms", metrics.dbAcquireMs.toFixed(1));
    res.setHeader("X-Teso-Sql-Queries", String(metrics.sqlQueries));
    res.setHeader("X-Teso-Storage-Ms", metrics.storageMs.toFixed(1));
    res.setHeader("X-Teso-Storage-Ops", String(metrics.storageOps));
    return writeHead.apply(this, args);
  };

  requestMetrics.run(metrics, next);
}

export async function recordDbAcquire(operation) {
  const metrics = currentMetrics();
  if (!metrics) return operation();

  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    metrics.dbAcquireMs += performance.now() - startedAt;
  }
}

export async function recordDbQuery(operation) {
  const metrics = currentMetrics();
  if (!metrics) return operation();

  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    metrics.sqlQueries += 1;
    metrics.dbMs += performance.now() - startedAt;
  }
}

export async function recordStorageOperation(operation) {
  const metrics = currentMetrics();
  if (!metrics) return operation();

  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    metrics.storageOps += 1;
    metrics.storageMs += performance.now() - startedAt;
  }
}
