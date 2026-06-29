import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { AiChatMessage } from "../ai/ai.types";
import type { SubmitAttemptDto } from "./dto/submit-attempt.dto";
import type {
  AnswerResult,
  GeneratedQuestion,
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

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  private buildExtractionMessages(article: {
    title: string;
    content: string;
  }): AiChatMessage[] {
    return [
      { role: "system", content: QUIZ_SYSTEM_PROMPT },
      { role: "user", content: `หัวข้อ: ${article.title}\n\nเนื้อหา: ${article.content}` },
    ];
  }

  // The AI occasionally emits near-valid JSON for this prompt specifically —
  // 5 questions x 4 options is a much bigger payload than the single-object
  // extraction prompts elsewhere, and longer generations are where models
  // slip up (stray trailing comma, etc). Try a raw parse first, then retry
  // once after stripping trailing commas before throwing.
  // Throws a plain Error (not BadRequestException) on unparseable JSON so
  // generateFromArticle can retry against the AI gateway instead of failing
  // the request on the first flaky response.
  private parseQuestions(raw: string): GeneratedQuestion[] {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI response did not contain JSON");

    let parsed: { questions?: unknown };
    try {
      parsed = JSON.parse(jsonMatch[0]) as { questions?: unknown };
    } catch {
      try {
        const cleaned = jsonMatch[0].replace(/,\s*([\]}])/g, "$1");
        parsed = JSON.parse(cleaned) as { questions?: unknown };
      } catch (error) {
        this.logger.warn(`Failed to parse AI quiz response, will retry: ${error}`);
        throw new Error("AI response was not valid JSON");
      }
    }
    if (!Array.isArray(parsed.questions)) return [];

    return parsed.questions
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

  async generateFromArticle(articleId: string) {
    const article = await this.prisma.knowledgeBaseArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException("ไม่พบบทความนี้");

    // The system prompt forbids the AI from inventing facts not in the
    // article, so very short content can't yield 5 distinct, truthful
    // questions -- it would just fail after burning 3 AI roundtrips.
    // Reject upfront with a message that tells the admin what to fix.
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

  async list(): Promise<QuizListItem[]> {
    const quizzes = await this.prisma.quiz.findMany({
      orderBy: { createdAt: "desc" },
      include: { sourceArticle: true, _count: { select: { questions: true } } },
    });

    return quizzes
      .filter((quiz) => quiz._count.questions > 0)
      .map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        questionCount: quiz._count.questions,
        sourceArticleTitle: quiz.sourceArticle?.title ?? null,
      }));
  }

  async getForAttempt(quizId: string): Promise<QuizForAttempt> {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });
    if (!quiz) throw new NotFoundException("ไม่พบแบบทดสอบนี้");

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

  async submitAttempt(userId: string, quizId: string, dto: SubmitAttemptDto): Promise<QuizAttemptResult> {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });
    if (!quiz) throw new NotFoundException("ไม่พบแบบทดสอบนี้");
    if (quiz.questions.length === 0) throw new BadRequestException("แบบทดสอบนี้ยังไม่มีคำถาม");

    const questionById = new Map(quiz.questions.map((q) => [q.id, q]));
    const answers: AnswerResult[] = dto.answers
      .filter((answer) => questionById.has(answer.questionId))
      .map((answer) => {
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
