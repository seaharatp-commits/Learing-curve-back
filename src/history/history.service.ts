import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async remove(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException("ไม่พบบทสนทนานี้");
    if (session.userId !== userId) throw new ForbiddenException("คุณไม่มีสิทธิ์ลบบทสนทนานี้");

    await this.prisma.chatSession.delete({ where: { id: sessionId } });
    return { success: true };
  }

  async list(userId: string) {
    const sessions = await this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      userId: session.userId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastMessage: session.messages[0]?.content ?? "",
      messageCount: session._count.messages,
    }));
  }
}
