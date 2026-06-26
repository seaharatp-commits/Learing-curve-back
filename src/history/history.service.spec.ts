import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { HistoryService } from "./history.service";
import { PrismaService } from "../prisma/prisma.service";

function makeService() {
  const prisma = {
    chatSession: { findUnique: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
  };
  const service = new HistoryService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe("HistoryService.remove", () => {
  it("throws NotFoundException when the session does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.chatSession.findUnique.mockResolvedValue(null);

    await expect(service.remove("user-1", "missing")).rejects.toThrow(NotFoundException);
    expect(prisma.chatSession.delete).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when the session belongs to another user", async () => {
    const { service, prisma } = makeService();
    prisma.chatSession.findUnique.mockResolvedValue({ id: "s1", userId: "other-user" });

    await expect(service.remove("user-1", "s1")).rejects.toThrow(ForbiddenException);
    expect(prisma.chatSession.delete).not.toHaveBeenCalled();
  });

  it("deletes the session when the owner matches", async () => {
    const { service, prisma } = makeService();
    prisma.chatSession.findUnique.mockResolvedValue({ id: "s1", userId: "user-1" });

    const result = await service.remove("user-1", "s1");

    expect(result).toEqual({ success: true });
    expect(prisma.chatSession.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });
});
