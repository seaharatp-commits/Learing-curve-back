import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByName(name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) throw new BadRequestException("กรุณาระบุหมวดหมู่");

    const existing = await this.prisma.category.findFirst({
      where: { name: { equals: normalizedName, mode: "insensitive" } },
    });
    if (existing) return existing;

    return this.prisma.category.create({ data: { name: normalizedName } });
  }
}
