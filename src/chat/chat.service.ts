import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { AiChatMessage } from "../ai/ai.types";
import { SendMessageDto } from "./dto/send-message.dto";
import { sanitizeReply } from "./sanitize-reply.util";

const SYSTEM_PROMPT =
  "คุณคือผู้ช่วย AI สำหรับระบบ Learning Curve ที่ช่วยตอบและแนะนำวิธีแก้ไขปัญหาให้ผู้ใช้งาน " +
  "ตอบเป็นภาษาไทย สั้น กระชับ และนำไปปฏิบัติได้จริง " +
  "ตอบเป็นข้อความล้วน ห้ามใช้ markdown หรือสัญลักษณ์จัดรูปแบบใด ๆ เช่น **, __, #, `, - นำหน้าหัวข้อ";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  private fallbackReply(content: string, knowledge?: { title: string; content: string }): string {
    if (knowledge) return `จากฐานความรู้ "${knowledge.title}": ${knowledge.content}`;
    return `คำตอบนี้ไม่ได้อ้างอิงจากฐานความรู้ที่แอดมินเพิ่มไว้โดยตรง แต่เป็นคำตอบจากความรู้ทั่วไปของ AI: รับทราบคำถาม "${content}" แล้วค่ะ`;
  }

  private async generateAiReply(
    sessionId: string,
    content: string,
    knowledge?: { title: string; content: string },
  ): Promise<string> {
    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: knowledge
          ? `${SYSTEM_PROMPT}\n\nให้ใช้ข้อมูลจากฐานความรู้ที่ผู้ใช้เลือกเป็นบริบทหลักในการตอบ หากต้องเสริมจากความรู้ทั่วไปให้บอกให้ชัดว่าเป็นข้อมูลเพิ่มเติม\n\nข้อมูลจากฐานความรู้ — "${knowledge.title}": ${knowledge.content}`
          : `${SYSTEM_PROMPT}\n\nคำถามนี้ไม่ได้เลือกข้อมูลจากฐานความรู้ที่แอดมินเพิ่มไว้ ให้ตอบจากความรู้ทั่วไปได้ แต่ต้องขึ้นต้นหรือระบุให้ชัดว่า "คำตอบนี้ไม่ได้อ้างอิงจากฐานความรู้ที่แอดมินเพิ่มไว้โดยตรง"`,
      },
      ...history.map((message): AiChatMessage => ({
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
      })),
      { role: "user", content },
    ];

    try {
      const reply = await this.aiService.chat(messages);
      return sanitizeReply(reply);
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

    const knowledge = dto.knowledgeBaseArticleId
      ? await this.prisma.knowledgeBaseArticle.findUnique({
          where: { id: dto.knowledgeBaseArticleId },
          select: { id: true, title: true, content: true },
        })
      : null;

    if (dto.knowledgeBaseArticleId && !knowledge) {
      throw new NotFoundException("ไม่พบข้อมูลฐานความรู้ที่เลือก");
    }

    const aiContent = await this.generateAiReply(session.id, dto.content, knowledge ?? undefined);

    const userMessage = await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: dto.content },
    });

    const aiMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: aiContent,
        sourceType: knowledge ? "KNOWLEDGE_BASE" : "GENERAL_AI",
        sourceArticleId: knowledge?.id ?? null,
        sourceArticleTitle: knowledge?.title ?? null,
        sourceConfidenceScore: knowledge ? dto.knowledgeBaseConfidenceScore ?? null : null,
      },
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
