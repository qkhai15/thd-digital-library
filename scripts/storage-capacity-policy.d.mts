export function storageCapacityBudget(env?: Record<string, string | undefined>): { limit: number; headroom: number };
export function storageCapacityLevel(used: number, limit: number): 'critical' | 'warning' | 'normal';
