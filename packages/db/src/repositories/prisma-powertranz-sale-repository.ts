import type {
  PowerTranzPendingSale,
  PowerTranzSaleRepository,
} from "@life-optimizer/financial";
import type { PrismaClient } from "../generated/client.js";

type Client = Pick<PrismaClient, "powerTranzSale">;
const sale = (row: PowerTranzPendingSale): PowerTranzPendingSale => ({
  ...row,
  status: row.status as PowerTranzPendingSale["status"],
});

export class PrismaPowerTranzSaleRepository implements PowerTranzSaleRepository {
  constructor(private readonly db: Client) {}
  async create(input: PowerTranzPendingSale) {
    await this.db.powerTranzSale.create({ data: input });
  }
  async findByTokenHash(tokenHash: string) {
    const row = await this.db.powerTranzSale.findUnique({
      where: { tokenHash },
    });
    return row
      ? sale({ ...row, status: row.status as PowerTranzPendingSale["status"] })
      : null;
  }
  async claim(id: string, at: Date) {
    const result = await this.db.powerTranzSale.updateMany({
      where: { id, status: "pending", expiresAt: { gt: at } },
      data: { status: "processing", processingStartedAt: at },
    });
    return result.count === 1;
  }
  async setStatus(id: string, status: "completed" | "declined") {
    await this.db.powerTranzSale.updateMany({
      where: { id, status: "processing" },
      data: { status },
    });
  }
}
