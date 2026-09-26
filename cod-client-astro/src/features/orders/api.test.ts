import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { bulkDeleteOrders, deleteOrder, updateOrder } from "./api";

describe("orders API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: [] });
  });

  it("deletes a single order by id", async () => {
    await deleteOrder("ord/1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/orders/ord%2F1", { method: "DELETE" });
  });

  it("bulk deletes through the bulk-delete endpoint", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: { deleted: ["ord/1"], failed: [] } });
    await expect(bulkDeleteOrders(["ord/1", "ord/2"])).resolves.toEqual({ deleted: ["ord/1"], failed: [] });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/orders/bulk-delete", expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["ord/1", "ord/2"] }) }));
  });

  it("patches an order through the edit endpoint", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: { price: 4500, deliveryFee: 500, codAmount: 5000 } });
    await updateOrder("ord/1", { address: "New address" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/orders/ord%2F1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ address: "New address" }) }));
  });
});
