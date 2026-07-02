import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { AiChatMessage } from "../ai/ai.types";
import { SendMessageDto } from "./dto/send-message.dto";
import { sanitizeReply } from "./sanitize-reply.util";

const SYSTEM_PROMPT =
  "คุณคือผู้ช่วย AI สำหรับระบบ Learning Curve ที่ช่วยตอบและแนะนำวิธีแก้ไขปัญหาให้ผู้ใช้งาน " +
  "ตอบเป็นภาษาไทยให้ชัดเจน อ่านง่าย และนำไปปฏิบัติได้จริง " +
  "ใช้ย่อหน้าสั้น ๆ รายการลำดับเลข bullet points และตัวอย่างง่าย ๆ ได้เมื่อช่วยให้อ่านเข้าใจขึ้น " +
  "ห้ามตอบเป็น raw JSON ห้ามแสดง object ดิบ และหลีกเลี่ยงการจัดรูปแบบที่รกหรืออ่านยาก";

const CLEAN_ENDING_PROMPT =
  "Keep the answer focused enough to finish within the response limit. Do not start a new paragraph or bullet point unless you can complete it. End with a complete sentence. If the answer is getting long, summarize the remaining details instead of cutting off mid-sentence.";

const LIST_FORMATTING_PROMPT =
  "When writing ordered steps, use explicit sequential numbering such as 1., 2., 3., 4. Do not repeat 1. for every item. Use bullets only for unordered lists.";

const CHAT_AI_OPTIONS = { temperature: 0.5, maxTokens: 1200 };

const BASE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}\n\n${CLEAN_ENDING_PROMPT}\n\n${LIST_FORMATTING_PROMPT}`;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  private summarizeKnowledgeFallback(content: string): string {
    const cleanContent = content
      .replace(/```(?:json|markdown|md)?/gi, "")
      .replace(/```/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleanContent.length <= 500) return cleanContent;

    const clipped = cleanContent.slice(0, 500);
    const lastSentenceEnd = Math.max(
      clipped.lastIndexOf("."),
      clipped.lastIndexOf("!"),
      clipped.lastIndexOf("?"),
      clipped.lastIndexOf("。"),
    );

    return `${clipped.slice(0, lastSentenceEnd > 180 ? lastSentenceEnd + 1 : 500).trim()}...`;
  }

  private fallbackReply(content: string, knowledge?: { title: string; content: string }): string {
    if (knowledge) {
      return [
        `ขออภัยค่ะ ตอนนี้ AI สร้างคำตอบแบบละเอียดไม่ได้ จึงสรุปจากฐานความรู้ "${knowledge.title}" แบบย่อให้ก่อนค่ะ`,
        this.summarizeKnowledgeFallback(knowledge.content),
        "หากต้องการรายละเอียดเพิ่มเติม กรุณาลองถามอีกครั้งค่ะ",
      ].join("\n\n");
    }
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
          ? `${BASE_SYSTEM_PROMPT}\n\nผู้ใช้เลือกฐานความรู้ "${knowledge.title}" เป็นแหล่งอ้างอิงหลักในการตอบคำถามนี้ ให้ยึดข้อมูลในฐานความรู้นี้เป็นหลักอย่างเคร่งครัด ห้ามเดา ห้ามแต่งรายละเอียด ขั้นตอน เงื่อนไข หรือข้อสรุปที่ไม่มีข้อมูลรองรับในฐานความรู้ หากฐานความรู้มีข้อมูลไม่พอ ให้บอกอย่างชัดเจนว่า "ฐานความรู้นี้ยังให้รายละเอียดไม่เพียงพอ" แล้วแนะนำว่าควรถามหรือเพิ่มข้อมูลอะไรต่อ ห้ามใส่ความรู้ทั่วไปเพิ่มเอง เว้นแต่คำถามของผู้ใช้ขอให้เสริมความรู้ทั่วไปอย่างชัดเจน และถ้าเสริม ต้องขึ้นหัวข้อว่า "ข้อมูลเพิ่มเติมนอกฐานความรู้:" ก่อนเสมอ ตอบโดยเรียบเรียงใหม่ให้อ่านง่าย ไม่ใช่คัดลอกเนื้อหาดิบทั้งก้อน\n\nข้อมูลจากฐานความรู้:\nชื่อ: ${knowledge.title}\nเนื้อหา:\n${knowledge.content}`
          : `${BASE_SYSTEM_PROMPT}\n\nคำถามนี้ไม่ได้เลือกข้อมูลจากฐานความรู้ที่แอดมินเพิ่มไว้ ให้ตอบจากความรู้ทั่วไปได้ แต่ต้องขึ้นต้นหรือระบุให้ชัดว่า "คำตอบนี้ไม่ได้อ้างอิงจากฐานความรู้ที่แอดมินเพิ่มไว้โดยตรง"`,
      },
      ...history.map((message): AiChatMessage => ({
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
      })),
      { role: "user", content },
    ];

    try {
      const reply = await this.aiService.chat(messages, CHAT_AI_OPTIONS);
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
