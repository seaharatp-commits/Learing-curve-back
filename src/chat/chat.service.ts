import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { AiChatMessage } from "../ai/ai.types";
import { SendMessageDto } from "./dto/send-message.dto";

const SYSTEM_PROMPT =
  "คุณคือผู้ช่วย AI สำหรับระบบ Learning Curve ที่ช่วยตอบและแนะนำวิธีแก้ไขปัญหาให้ผู้ใช้งาน " +
  "ตอบเป็นภาษาไทย สั้น กระชับ และนำไปปฏิบัติได้จริง";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  private async findRelevantKnowledge(content: string) {
    const lower = content.toLowerCase();
    const articles = await this.prisma.knowledgeBaseArticle.findMany();
    return articles.find(
      (article) =>
        lower.includes(article.title.toLowerCase()) || article.content.toLowerCase().includes(lower),
    );
  }

  private fallbackReply(content: string, knowledge?: { title: string; content: string }): string {
    if (knowledge) return `จากฐานความรู้ "${knowledge.title}": ${knowledge.content}`;
    return `รับทราบปัญหาของคุณแล้วครับ/ค่ะ: "${content}" — ทีม AI กำลังวิเคราะห์และจะแนะนำวิธีแก้ไขให้เร็วที่สุด`;
  }

  private async generateAiReply(sessionId: string, content: string): Promise<string> {
    const knowledge = await this.findRelevantKnowledge(content);

    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: knowledge
          ? `${SYSTEM_PROMPT}\n\nข้อมูลอ้างอิงจากฐานความรู้ที่เกี่ยวข้อง — "${knowledge.title}": ${knowledge.content}`
          : SYSTEM_PROMPT,
      },
      ...history.map((message): AiChatMessage => ({
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
      })),
      { role: "user", content },
    ];

    try {
      return await this.aiService.chat(messages);
    } catch (error) {
      this.logger.error(`AI Develyst call failed, falling back to canned reply: ${error}`);
      return this.fallbackReply(content, knowledge);
    }
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

    const aiContent = await this.generateAiReply(session.id, dto.content);

    const userMessage = await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: dto.content },
    });

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
