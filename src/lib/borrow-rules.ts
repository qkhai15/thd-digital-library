export const BORROW_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["borrowed", "cancelled"],
  borrowed: ["returned"],
  returned: [], rejected: [], cancelled: [],
};

export function canTransitionBorrow(from: string, to: string) {
  return from === to || Boolean(BORROW_TRANSITIONS[from]?.includes(to));
}

export function borrowStockDelta(from: string, to: string) {
  if (from === to || !canTransitionBorrow(from, to)) return 0;
  if (from === "pending" && to === "approved") return -1;
  if (from === "borrowed" && to === "returned") return 1;
  if (["approved", "ready_for_pickup"].includes(from) && to === "cancelled") return 1;
  return 0;
}
