export function storageCapacityBudget(env = process.env) {
  const limit = Number(env.STORAGE_CAPACITY_LIMIT_BYTES || 1024 ** 3);
  const headroom = Number(env.STORAGE_CAPACITY_HEADROOM_BYTES || 1024 ** 2);
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(headroom) || headroom < 0 || headroom >= limit) throw new Error('Invalid Storage capacity budget.');
  return { limit, headroom };
}

export function storageCapacityLevel(used, limit) {
  if (![used, limit].every(Number.isSafeInteger) || used < 0 || limit <= 0) throw new Error('Invalid Storage capacity measurement.');
  return used >= limit * 0.85 ? 'critical' : used >= limit * 0.7 ? 'warning' : 'normal';
}
