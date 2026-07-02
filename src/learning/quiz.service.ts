import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { AiChatMessage } from "../ai/ai.types";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import type { SubmitAttemptDto } from "./dto/submit-attempt.dto";
import type {
  AnswerResult,
  GeneratedLessonQuizResult,
  GeneratedQuestion,
  GeneratedTopicLesson,
  GeneratedTopicResult,
  LessonChatResult,
  QuizAttemptResult,
  QuizForAttempt,
  QuizListItem,
} from "./quiz.types";

const QUESTIONS_PER_QUIZ = 5;
const MAX_GENERATION_ATTEMPTS = 3;
const MIN_CONTENT_LENGTH = 50;

const QUIZ_SYSTEM_PROMPT =
  "คุณคือผู้ช่วยสร้างแบบทดสอบปรนัยจากเนื้อหาความรู้ที่ให้มาเท่านั้น " +
  "ห้ามแต่งข้อมูลหรือถามเรื่องที่ไม่มีอยู่ในเนื้อหาต้นฉบับ " +
  `สร้างคำถามปรนัย ${QUESTIONS_PER_QUIZ} ข้อ แต่ละข้อมีตัวเลือก 4 ข้อ และมีคำตอบที่ถูกต้องเพียงข้อเดียว ` +
  "ตอบกลับเป็น JSON เท่านั้น ไม่มีคำอธิบายอื่น ไม่ใช้ markdown หรือ code fence " +
  'รูปแบบ: {"questions": [{"question": string, "options": string[4], "correctIndex": number, "explanation": string}]}';

const TOPIC_LESSON_SYSTEM_PROMPT =
  "คุณคือผู้ช่วยสร้างบทเรียนภาษาไทยจากหัวข้อที่ผู้ใช้สนใจ ให้เนื้อหาถูกต้อง อ่านง่าย และเหมาะกับการเรียนด้วยตนเอง " +
  "ใช้รายละเอียด/ข้อมูลประกอบที่ผู้ใช้ให้มาเป็นบริบทสำคัญเพื่อให้ตอบตรง topic แต่ถ้าข้อมูลประกอบไม่พอให้สรุปอย่างระมัดระวัง " +
  "อย่าสร้างแบบทดสอบในขั้นตอนนี้ " +
  "ตอบกลับเป็น JSON เท่านั้น ไม่มี markdown หรือ code fence " +
  'รูปแบบ: {"title": string, "content": string} ' +
  "content ควรเป็นบทเรียน 3-5 ย่อหน้า มีแนวคิดหลัก ขั้นตอน/ตัวอย่าง และข้อควรระวัง";

const LESSON_ASSISTANT_STYLE_PROMPT =
  "Answer in a friendly, clear, beginner-friendly Thai teaching style. Use short paragraphs. Use clean numbered steps only when order matters. Use bullet points for causes, notes, and warnings. Do not output raw JSON. Avoid excessive bold text. Do not output broken or unclosed Markdown such as **text or text** without a matching pair. For troubleshooting answers, use these headings when useful: สาเหตุที่เป็นไปได้:, วิธีแก้เบื้องต้น:, ข้อควรระวัง:, ถ้ายังไม่หาย:. If the answer involves BIOS, UEFI, Secure Boot, TPM, boot settings, disk settings, or security settings, warn the learner to be careful, avoid random BIOS changes, ask for the device or motherboard model when needed, and avoid overconfident advice when details are missing.";

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  private buildExtractionMessages(article: { title: string; content: string }): AiChatMessage[] {
    return [
      { role: "system", content: QUIZ_SYSTEM_PROMPT },
      { role: "user", content: `หัวข้อ: ${article.title}\n\nเนื้อหา: ${article.content}` },
    ];
  }

  private buildTopicLessonMessages(topic: string, detail: string): AiChatMessage[] {
    const cleanDetail = detail.trim();
    return [
      { role: "system", content: TOPIC_LESSON_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `หัวข้อที่อยากเรียนรู้: ${topic}` +
          (cleanDetail ? `\n\nรายละเอียด/ข้อมูลประกอบเพื่อช่วยให้ตอบตรงหัวข้อ:\n${cleanDetail}` : ""),
      },
    ];
  }

  private buildLessonChatMessages(
    lesson: { title: string; content: string },
    message: string,
    chatHistory = "",
  ): AiChatMessage[] {
    return [
      {
        role: "system",
        content:
          "You are a friendly female teaching assistant for the current lesson. Use the lesson content as the main context, then add relevant extra knowledge only when it helps the learner understand the lesson better. " +
          "Treat the conversation history as real context. The learner's latest message may refer to earlier answers with words like 'this', 'that', 'it', 'like I said', or 'is my understanding correct'. Do not answer the latest message as an isolated new question when the history is relevant. " +
          "Give answers that are complete enough to be clear, but not too long, repetitive, or overwhelming. By default, aim for 2-4 short paragraphs, with concise bullet points when useful and one simple example when it improves understanding. " +
          "Use a natural, warm, easy-to-read teaching style. Avoid robotic, overly brief, or overly formal wording. " +
          "Follow the learner's requested response style in the latest message. If they ask for a short answer, keep it concise. If they ask for bullets, examples, comparison, beginner-friendly language, or a simpler explanation, use that format. " +
          "If the learner explains their own understanding or asks whether their understanding is correct, first check it directly, then clarify what is correct, what needs adjustment, and why. " +
          "Return a clean learner-facing answer, not JSON. If a title helps, write it as a short Markdown heading, then write the explanation as readable Markdown/text. Never output raw objects like { title, content }. " +
          LESSON_ASSISTANT_STYLE_PROMPT +
          " " +
          "When adding information beyond the lesson content, clearly label that part in Thai as 'คำอธิบายเพิ่มเติม:' or 'บริบทเพิ่มเติม:'. " +
          "Do not answer questions that are unrelated or too far from the lesson; briefly say in Thai that the question is outside this lesson and invite the learner to ask something connected to the topic. " +
          "If answering in Thai, use a polite, warm feminine tone and end sentences naturally with 'ค่ะ' where appropriate.",
      },
      {
        role: "system",
        content:
          "คุณคือผู้ช่วยติวภาษาไทย ตอบคำถามโดยยึดหัวข้อและเนื้อหาบทเรียนที่ให้มาเป็นหลัก " +
          "ให้อ่านประวัติการคุยก่อนหน้าเพื่อเข้าใจบริบทต่อเนื่อง โดยเฉพาะคำถามต่อเนื่องที่อ้างถึงคำตอบก่อนหน้า ความเข้าใจของผู้เรียน หรือสิ่งที่ผู้เรียนเพิ่งถามไป " +
          "ถ้าคำตอบอยู่ในบทเรียน ให้สรุปและอธิบายจากบทเรียนให้ชัดเจน ถ้าบทเรียนยังไม่พอแต่คำถามยังเกี่ยวข้องกัน ให้เสริมความรู้ทั่วไปที่ถูกต้องพร้อมระบุว่าเป็นคำอธิบายเพิ่มเติม " +
          "ถ้าผู้เรียนบอกความเข้าใจของตัวเอง ให้ตรวจว่าเข้าใจถูกไหมก่อน แล้วค่อยแก้ไขหรือเติมส่วนที่ขาด ถ้าผู้เรียนขอคำตอบสั้น ๆ อธิบายง่าย ๆ bullet ตัวอย่าง หรือการเปรียบเทียบ ให้ทำตามรูปแบบที่ผู้เรียนขอ " +
          "ห้ามตอบเป็น JSON ดิบ ถ้าต้องมีหัวข้อให้ใช้ Markdown heading สั้น ๆ แล้วตามด้วยคำอธิบายที่อ่านง่าย " +
          "จัดคำตอบให้อ่านง่ายด้วยย่อหน้าสั้น ๆ bullet เมื่อเหมาะสม และตัวอย่างง่าย ๆ เมื่อช่วยให้เข้าใจขึ้น " +
          "ตอบให้ครบประเด็น ไม่สั้นจนขาดสาระ และไม่ยาวจนล้นหรือซ้ำไปมา ใช้น้ำเสียงสุภาพ อบอุ่น เป็นกันเองแบบผู้ช่วยสอนผู้หญิง และลงท้ายด้วยค่ะอย่างเป็นธรรมชาติ",
      },
      {
        role: "user",
        content:
          `Current lesson topic:\n${lesson.title}\n\nMain lesson content/reference:\n${lesson.content}` +
          (chatHistory.trim()
            ? `\n\nPrevious conversation history, oldest to newest:\n${chatHistory.trim()}`
            : "\n\nPrevious conversation history:\nNo previous messages in this lesson chat.") +
          `\n\nLatest learner message:\n${message.trim()}\n\nYour task: answer the latest learner message using the lesson, the relevant previous conversation, and the learner's requested answer style.`,
      },
    ];
  }

  private normalizeLessonChatAnswer(raw: string): string {
    const cleaned = raw
      .replace(/```(?:json|markdown|md)?/gi, "")
      .replace(/```/g, "")
      .trim();

    if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) {
      return raw.trim();
    }

    try {
      const parsed = JSON.parse(cleaned) as { title?: unknown; content?: unknown };
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const content = typeof parsed.content === "string" ? parsed.content.trim() : "";

      if (!title && !content) return raw.trim();
      return [title ? `## ${title}` : "", content].filter(Boolean).join("\n\n");
    } catch {
      return raw.trim();
    }
  }

  private fallbackLessonChatAnswer(lesson: { title: string; content: string }): string {
    const cleanContent = lesson.content.replace(/\s+/g, " ").trim();
    const summary =
      cleanContent.length > 420
        ? `${cleanContent.slice(0, 420).trim()}...`
        : cleanContent;

    return [
      "ขออภัยค่ะ ตอนนี้ระบบ AI ยังตอบคำถามต่อเนื่องแบบละเอียดไม่ได้ชั่วคราว",
      `จากบทเรียน "${lesson.title}" สรุปใจความสำคัญเบื้องต้นได้ว่า:`,
      summary || "บทเรียนนี้ยังมีข้อมูลไม่เพียงพอสำหรับสรุปค่ะ",
      "กรุณาลองถามใหม่อีกครั้งในอีกสักครู่ หรือถามให้เฉพาะเจาะจงขึ้นเพื่อให้ระบบช่วยอธิบายต่อได้ค่ะ",
    ].join("\n\n");
  }

  private buildLessonQuizMessages(
    lesson: { title: string; content: string },
    additionalPrompt: string,
  ): AiChatMessage[] {
    const focus = additionalPrompt.trim();
    return [
      {
        role: "system",
        content:
          QUIZ_SYSTEM_PROMPT +
          " When creating a quiz from a lesson, treat the lesson content as the only factual source. The learner conversation may be used only to choose emphasis, difficulty, or subtopics that already exist in the lesson. Do not create questions from unsupported claims in the conversation.",
      },
      {
        role: "user",
        content:
          `Lesson title: ${lesson.title}\n\nVerified lesson content - use this as the factual source:\n${lesson.content}` +
          (focus
            ? `\n\nLearner chat context - use only as focus or emphasis, not as a factual source:\n${focus}`
            : "") +
          "\n\nCreate quiz questions only when the answer can be supported by the verified lesson content above.",
      },
    ];
  }

  private async ensureCurrentUserExists(user: RequestUser) {
    const existingUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!existingUser) {
      throw new UnauthorizedException("บัญชีผู้ใช้นี้ไม่มีอยู่ในระบบ กรุณาเข้าสู่ระบบใหม่");
    }
  }

  private parseJsonObject(raw: string): Record<string, unknown> {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI response did not contain JSON");

    try {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      try {
        const cleaned = jsonMatch[0].replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(cleaned) as Record<string, unknown>;
      } catch (error) {
        this.logger.warn(`Failed to parse AI quiz response, will retry: ${error}`);
        throw new Error("AI response was not valid JSON");
      }
    }
  }

  private normalizeQuestions(value: unknown): GeneratedQuestion[] {
    if (!Array.isArray(value)) return [];

    return value
      .filter(
        (q): q is GeneratedQuestion =>
          typeof q === "object" &&
          q !== null &&
          typeof (q as GeneratedQuestion).question === "string" &&
          Array.isArray((q as GeneratedQuestion).options) &&
          (q as GeneratedQuestion).options.length === 4 &&
          typeof (q as GeneratedQuestion).correctIndex === "number" &&
          (q as GeneratedQuestion).correctIndex >= 0 &&
          (q as GeneratedQuestion).correctIndex <= 3,
      )
      .map((q) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: typeof q.explanation === "string" ? q.explanation : "",
      }));
  }

  private parseQuestions(raw: string): GeneratedQuestion[] {
    const parsed = this.parseJsonObject(raw);
    return this.normalizeQuestions(parsed.questions);
  }

  // AI responses sometimes double-encode the lesson: the "content" field is
  // itself a JSON string like {"title": ..., "content": "actual text"}
  // instead of plain prose. Unwrap one level so raw JSON never lands in the
  // saved lesson content.
  private normalizeLessonContent(value: string): string {
    const stripFences = (text: string) =>
      text
        .replace(/```(?:json)?/gi, "")
        .replace(/```/g, "")
        .trim();

    const text = stripFences(value);
    if (/^\{[\s\S]*\}$/.test(text)) {
      try {
        const inner = JSON.parse(text) as Record<string, unknown>;
        if (typeof inner.content === "string" && inner.content.trim()) {
          return stripFences(inner.content);
        }
      } catch {
        // not valid JSON after all, fall through and keep the stripped text
      }
    }
    return text;
  }

  private parseTopicLesson(raw: string, fallbackTitle: string): GeneratedTopicLesson {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = this.parseJsonObject(raw);
    } catch {
      const content = this.normalizeLessonContent(raw);
      if (content.length >= MIN_CONTENT_LENGTH) {
        return { title: fallbackTitle, content };
      }
      throw new Error("AI response did not contain a usable lesson");
    }

    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : fallbackTitle;
    const content =
      typeof parsed.content === "string" ? this.normalizeLessonContent(parsed.content) : "";

    if (!title || !content) {
      throw new Error("AI response did not contain a usable lesson");
    }

    return { title, content };
  }

  private getAiHttpStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
    const response = (error as { response?: { status?: unknown } }).response;
    return typeof response?.status === "number" ? response.status : undefined;
  }

  private isTemporaryAiFailure(error: unknown): boolean {
    const status = this.getAiHttpStatus(error);
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private describeAiFailure(error: unknown): string {
    const status = this.getAiHttpStatus(error);
    if (status) return `AI gateway responded with HTTP ${status}`;
    if (error instanceof Error) return error.message;
    return String(error);
  }

  async generateFromArticle(user: RequestUser, articleId: string) {
    const article = await this.prisma.knowledgeBaseArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException("ไม่พบบทความนี้");

    if (article.content.trim().length < MIN_CONTENT_LENGTH) {
      throw new BadRequestException(
        "เนื้อหาของบทความนี้สั้นเกินไปสำหรับสร้างแบบทดสอบ กรุณาเพิ่มรายละเอียดในบทความก่อน",
      );
    }

    let questions: GeneratedQuestion[] = [];
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        const reply = await this.aiService.chat(this.buildExtractionMessages(article));
        questions = this.parseQuestions(reply);
        if (questions.length > 0) break;
      } catch (error) {
        lastError = error;
      }
    }

    if (questions.length === 0) {
      this.logger.error(
        `AI failed to generate a usable quiz after ${MAX_GENERATION_ATTEMPTS} attempts: ${lastError}`,
      );
      throw new BadRequestException(
        "AI สร้างแบบทดสอบไม่สำเร็จหลังจากลองหลายครั้ง กรุณาลองใหม่อีกครั้ง",
      );
    }

    const quiz = await this.prisma.quiz.create({
      data: {
        title: `แบบทดสอบ: ${article.title}`,
        createdByUserId: user.id,
        sourceArticleId: article.id,
        questions: {
          create: questions.map((q) => ({
            questionText: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
          })),
        },
      },
      include: { questions: true },
    });

    this.logger.log(`Generated quiz ${quiz.id} (${quiz.questions.length} questions) from article ${articleId}`);
    return quiz;
  }

  async generateFromTopic(user: RequestUser, topic: string, detail = ""): Promise<GeneratedTopicResult> {
    const cleanTopic = topic.trim();
    if (cleanTopic.length < 2) {
      throw new BadRequestException("กรุณาระบุหัวข้อที่อยากเรียนรู้อย่างน้อย 2 ตัวอักษร");
    }
    await this.ensureCurrentUserExists(user);

    let generated: GeneratedTopicLesson | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        const reply = await this.aiService.chat(this.buildTopicLessonMessages(cleanTopic, detail), {
          temperature: 0.6,
          maxTokens: 1800,
        });
        generated = this.parseTopicLesson(reply, cleanTopic);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!generated) {
      this.logger.error(
        `AI failed to generate a usable lesson after ${MAX_GENERATION_ATTEMPTS} attempts: ${this.describeAiFailure(lastError)}`,
      );
      if (this.isTemporaryAiFailure(lastError)) {
        throw new ServiceUnavailableException(
          "ระบบ AI ไม่พร้อมใช้งานชั่วคราว กรุณารอสักครู่แล้วลองสร้างบทเรียนใหม่อีกครั้ง",
        );
      }
      throw new BadRequestException("AI สร้างบทเรียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }

    const maxOrder = await this.prisma.lesson.aggregate({ _max: { order: true } });
    const lesson = await this.prisma.lesson.create({
      data: {
        title: generated.title,
        createdByUserId: user.id,
        content: generated.content,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    });

    this.logger.log(`Generated lesson ${lesson.id} from topic "${cleanTopic}"`);
    return { lessonId: lesson.id, quizId: null, title: lesson.title };
  }

  async askLessonQuestion(
    user: RequestUser,
    lessonId: string,
    message: string,
    chatHistory = "",
  ): Promise<LessonChatResult> {
    const cleanMessage = message.trim();
    if (!cleanMessage) throw new BadRequestException("กรุณาระบุคำถาม");

    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException("ไม่พบบทเรียนนี้");
    if (user.role !== "ADMIN" && lesson.createdByUserId !== user.id) {
      throw new NotFoundException("ไม่พบบทเรียนนี้");
    }

    try {
      const answer = await this.aiService.chat(this.buildLessonChatMessages(lesson, cleanMessage, chatHistory), {
        temperature: 0.5,
        maxTokens: 1000,
      });

      return { answer: this.normalizeLessonChatAnswer(answer) };
    } catch (error) {
      this.logger.error(`AI failed to answer lesson follow-up: ${this.describeAiFailure(error)}`);
      return { answer: this.fallbackLessonChatAnswer(lesson) };
    }
  }

  async generateQuizFromLesson(
    user: RequestUser,
    lessonId: string,
    additionalPrompt = "",
  ): Promise<GeneratedLessonQuizResult> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException("ไม่พบบทเรียนนี้");
    if (user.role !== "ADMIN" && lesson.createdByUserId !== user.id) {
      throw new NotFoundException("ไม่พบบทเรียนนี้");
    }
    await this.ensureCurrentUserExists(user);
    if (lesson.content.trim().length < MIN_CONTENT_LENGTH) {
      throw new BadRequestException("เนื้อหาบทเรียนนี้สั้นเกินไปสำหรับสร้างแบบทดสอบ");
    }

    let questions: GeneratedQuestion[] = [];
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        const reply = await this.aiService.chat(this.buildLessonQuizMessages(lesson, additionalPrompt), {
          temperature: 0.4,
          maxTokens: 1400,
        });
        questions = this.parseQuestions(reply);
        if (questions.length > 0) break;
      } catch (error) {
        lastError = error;
      }
    }

    if (questions.length === 0) {
      this.logger.error(
        `AI failed to generate a usable lesson quiz after ${MAX_GENERATION_ATTEMPTS} attempts: ${lastError}`,
      );
      throw new BadRequestException("AI สร้างแบบทดสอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }

    const quiz = await this.prisma.quiz.create({
      data: {
        title: `แบบทดสอบ: ${lesson.title}`,
        createdByUserId: user.id,
        lessonId: lesson.id,
        questions: {
          create: questions.map((q) => ({
            questionText: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
          })),
        },
      },
    });

    this.logger.log(`Generated quiz ${quiz.id} from lesson ${lesson.id}`);
    return { quizId: quiz.id, title: quiz.title };
  }

  async list(user: RequestUser): Promise<QuizListItem[]> {
    const quizzes = await this.prisma.quiz.findMany({
      where: user.role === "ADMIN" ? undefined : { createdByUserId: user.id },
      orderBy: { createdAt: "desc" },
      include: { createdBy: true, sourceArticle: true, _count: { select: { questions: true } } },
    });

    return quizzes
      .filter((quiz) => quiz._count.questions > 0)
      .map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        questionCount: quiz._count.questions,
        sourceArticleTitle: quiz.sourceArticle?.title ?? null,
        createdByUserId: quiz.createdByUserId,
        createdByName: quiz.createdBy?.name ?? null,
        createdByEmail: quiz.createdBy?.email ?? null,
      }));
  }

  async getForAttempt(user: RequestUser, quizId: string): Promise<QuizForAttempt> {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });
    if (!quiz) throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    if (user.role !== "ADMIN" && quiz.createdByUserId !== user.id) {
      throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    }

    return {
      id: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: q.options,
      })),
    };
  }

  async remove(user: RequestUser, quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    if (user.role !== "ADMIN" && quiz.createdByUserId !== user.id) {
      throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    }

    await this.prisma.quiz.delete({ where: { id: quizId } });
    return { success: true };
  }

  async submitAttempt(user: RequestUser, quizId: string, dto: SubmitAttemptDto): Promise<QuizAttemptResult> {
    const userId = user.id;
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });
    if (!quiz) throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    if (user.role !== "ADMIN" && quiz.createdByUserId !== userId) {
      throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    }
    if (quiz.questions.length === 0) throw new BadRequestException("แบบทดสอบนี้ยังไม่มีคำถาม");

    if (!Array.isArray(dto.answers) || dto.answers.length === 0) {
      throw new BadRequestException("กรุณาตอบคำถามให้ครบทุกข้อก่อนส่งแบบทดสอบ");
    }

    const questionById = new Map(quiz.questions.map((q) => [q.id, q]));
    const seenQuestionIds = new Set<string>();

    for (const answer of dto.answers) {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new BadRequestException(
          "คำตอบที่ส่งมาไม่ตรงกับแบบทดสอบนี้ กรุณาลองทำแบบทดสอบใหม่อีกครั้ง",
        );
      }

      if (seenQuestionIds.has(answer.questionId)) {
        throw new BadRequestException("พบคำตอบซ้ำในคำถามเดียวกัน กรุณาลองทำแบบทดสอบใหม่อีกครั้ง");
      }

      seenQuestionIds.add(answer.questionId);

      if (answer.selectedIndex < 0 || answer.selectedIndex >= question.options.length) {
        throw new BadRequestException(
          "ตัวเลือกคำตอบไม่ถูกต้อง กรุณาลองทำแบบทดสอบใหม่อีกครั้ง",
        );
      }
    }

    if (seenQuestionIds.size !== quiz.questions.length) {
      throw new BadRequestException("กรุณาตอบคำถามให้ครบทุกข้อก่อนส่งแบบทดสอบ");
    }

    const answers: AnswerResult[] = dto.answers.map((answer) => {
      const question = questionById.get(answer.questionId)!;
      return {
        questionId: answer.questionId,
        selectedIndex: answer.selectedIndex,
        correctIndex: question.correctIndex,
        isCorrect: answer.selectedIndex === question.correctIndex,
        explanation: question.explanation,
      };
    });

    const correctCount = answers.filter((a) => a.isCorrect).length;
    const score = Math.round((correctCount / quiz.questions.length) * 100);

    const attempt = await this.prisma.quizAttempt.create({
      data: { userId, quizId, score },
    });

    return {
      attemptId: attempt.id,
      score,
      totalQuestions: quiz.questions.length,
      correctCount,
      answers,
    };
  }
}
