import { describe, expect, it, vi } from "vitest";
import {
  createFinancialReportingService,
  type FinancialReportingRepository,
} from "../src/index.js";

describe("financial reporting", () => {
  it("loads an active catalog product by validated ID", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const findCatalogProduct = vi.fn(async () => null);
    const service = createFinancialReportingService({
      findCatalogProduct,
    } as unknown as FinancialReportingRepository);

    await expect(service.getCatalogProduct(id)).resolves.toBeNull();
    expect(findCatalogProduct).toHaveBeenCalledWith(id);
    expect(() => service.getCatalogProduct("not-a-uuid")).toThrow(
      "Product ID must be a UUID",
    );
  });
});
