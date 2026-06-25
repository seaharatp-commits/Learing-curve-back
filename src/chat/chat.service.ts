import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SendMessageDto } from "./dto/send-message.dto";

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateAiReply(content: string): Promise<string> {
    const lower = content.toLowerCase();
    const articles = await this.prisma.knowledgeBaseArticle.findMany();
    const match = articles.find(
      (article) =>
        lower.includes(article.title.toLowerCase()) || article.content.toLowerCase().includes(lower),
    );
    if (match) return `จากฐานความรู้ "${match.title}": ${match.content}`;
    return `รับทราบปัญหาของคุณแล้วครับ/ค่ะ: "${content}" — ทีม AI กำลังวิเคราะห์และจะแนะนำวิธีแก้ไขให้เร็วที่สุด`;
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    let session = dto.sessionId
      ? await this.prisma.chatSession.findUnique({ where: { id: dto.sessionId } })
      : null;

    if (session && session.userId !== userId) {
      throw new ForbiddenException("คุณไม่มีสิทธิ์เข้าถึงบทสนทนานี้");
    }

    if (!session) {
      session = await this.prisma.chatSession.create({
        data: { userId, title: dto.content.slice(0, 40) },
      });
    } else {
      session = await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });
    }

    const userMessage = await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: dto.content },
    });

    const aiContent = await this.generateAiReply(dto.content);
    const aiMessage = await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: "ASSISTANT", content: aiContent },
    });

    return { session, messages: [userMessage, aiMessage] };
  }

  async getSessionMessages(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException("ไม่พบบทสนทนานี้");
    if (session.userId !== userId) throw new ForbiddenException("คุณไม่มีสิทธิ์เข้าถึงบทสนทนานี้");

    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
  }
}
