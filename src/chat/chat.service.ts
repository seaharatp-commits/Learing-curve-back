import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { AiChatMessage } from "../ai/ai.types";
import { AiQuestionUnderstandingService } from "../ai/ai-question-understanding.service";
import type {
  KnowledgeBaseCandidate,
  KnowledgeBaseRecommendation,
  QuestionAnalysisResult,
} from "../ai/ai-question-understanding.types";
import { RecommendationService } from "../knowledge-base/recommendation.service";
import { SkillRadarService } from "../skill-radar/skill-radar.service";
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

const THAI_HELPDESK_STYLE_PROMPT =
  "For Thai answers, write like a friendly female teaching assistant: clear, warm, beginner-friendly, and practical. Use short paragraphs. Use clean numbered steps only when the user needs ordered actions. Use bullet points for causes, notes, warnings, and details. Do not output raw JSON. Do not use excessive bold text. Do not output broken or unclosed Markdown such as **text or text** without a matching pair.";

const TROUBLESHOOTING_FORMAT_PROMPT =
  "For troubleshooting answers, prefer this structure when useful:\nสาเหตุที่เป็นไปได้:\n- ...\n\nวิธีแก้เบื้องต้น:\n1. ...\n2. ...\n\nข้อควรระวัง:\n- ...\n\nถ้ายังไม่หาย:\n- Ask for useful details such as Windows version, device or motherboard model, exact error, screenshot, and steps already tried.";

const BIOS_SAFETY_PROMPT =
  "If the answer involves BIOS, UEFI, Secure Boot, TPM, boot settings, disk settings, or security settings, warn the user to be careful. Do not suggest random BIOS changes. Ask for the device or motherboard model when needed. Avoid overconfident advice when details are missing.";

const SOURCE_NOTE_PROMPT =
  "Do not add a Knowledge Base source note inside the answer body. The application UI shows source metadata separately at the bottom when a Knowledge Base article is used.";

const SELECTED_KB_FOLLOW_UP_PROMPT =
  'Updated selected-KB follow-up rule that overrides any stricter wording below: when a Knowledge Base article is selected, use it as the main source and clearly separate KB-supported details from extra explanation. If the KB has enough detail, answer from the KB without adding unsupported facts. If the KB does not have enough detail for the user follow-up, you may add relevant general knowledge when it helps the learner, but label it clearly in Thai before the extra section: "ข้อมูลจากฐานความรู้มีจำกัด จึงเสริมคำอธิบายจากความรู้ทั่วไปเพิ่มเติม". Do not present general knowledge as if it came from the KB. Do not invent steps, conditions, product behavior, or facts as KB-supported details unless they are present in the KB content.';

const LOW_KB_CONFIDENCE_PROMPT =
  'The selected Knowledge Base relevance score for this follow-up question is below 25%. Treat the KB as weak or partial context only. You may answer mainly from relevant general knowledge, but clearly label that part with this exact Thai note before the extra explanation: "ข้อมูลจากฐานความรู้มีจำกัด จึงเสริมคำอธิบายจากความรู้ทั่วไปเพิ่มเติม". Use only KB facts that are clearly relevant. Do not imply the general-knowledge details came from the KB.';

const CHAT_AI_OPTIONS = { temperature: 0.5, maxTokens: 1200 };

const BASE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}\n\n${CLEAN_ENDING_PROMPT}\n\n${LIST_FORMATTING_PROMPT}\n\n${THAI_HELPDESK_STYLE_PROMPT}\n\n${TROUBLESHOOTING_FORMAT_PROMPT}\n\n${BIOS_SAFETY_PROMPT}\n\n${SOURCE_NOTE_PROMPT}`;

const SELECTED_KB_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}\n\n${SELECTED_KB_FOLLOW_UP_PROMPT}`;

export const DEFAULT_SUGGESTED_QUESTIONS = [
  "Next.js ใช้ Ant Design หรือ MUI ดีกว่ากัน?",
  "ช่วยอธิบาย error นี้แบบเข้าใจง่าย",
  "วิเคราะห์ขั้นตอนแก้ปัญหานี้ให้หน่อย",
];

const SUGGESTED_QUESTIONS_MIN = 3;
const SUGGESTED_QUESTIONS_MAX = 5;
const SUGGESTED_QUESTIONS_DISPLAY_LIMIT = 3;
const SUGGESTED_QUESTIONS_OPTIONS = { temperature: 0.7, maxTokens: 500 };
const RECENT_ACTIVITY_LIMIT = 10;

const SUGGESTED_QUESTIONS_SYSTEM_PROMPT = [
  "You generate example follow-up questions a learner could tap to start a chat on a learning platform.",
  "Return ONLY a JSON array of 3 to 5 short question strings in Thai. No markdown, no commentary, no object wrapper.",
  "Each question must be realistic, specific, and something the given learner would plausibly ask next.",
  "Base the questions on the learner's current position and the latestActivities list when it has items.",
  "latestActivities contains the learner's 10 most recent actions across chat, lessons, quizzes, Knowledge Base answers, and Skill Radar signals.",
  "If latestActivities is empty, generate general starter questions for the learner's selected position and skills instead of inventing fake history.",
  "Do not repeat the learner's recent questions verbatim — build on them or explore a related angle.",
  "Keep each question under 100 characters.",
].join("\n");

interface SuggestedQuestionActivity {
  type: "chat_question" | "lesson_created" | "quiz_attempt" | "kb_answer" | "skill_signal";
  title: string;
  detail?: string;
  score?: number;
  createdAt: string;
}

interface RecentSkillScoreEvent {
  skill: { name: string };
  position: { name: string };
  sourceType: string;
  scoreAfter: number;
  createdAt: Date | string;
}

interface SuggestedQuestionsSummary {
  currentPosition: string;
  positionSkills: string[];
  topSkills: string[];
  weakSkills: string[];
  latestActivities: SuggestedQuestionActivity[];
  recentTopics: string[];
  recentQuestions: string[];
  learningProgress: { completedLessons: number; totalLessons: number; percentage: number };
  recommendedKnowledgeBase: string[];
}

interface SuggestedQuestionsCacheEntry {
  signature: string;
  questions: string[];
}

export interface ChatRecommendedKnowledgeBase {
  articleId: string;
  title: string;
  preview: string | null;
  summary?: string | null;
  confidenceScore: number;
  matchedSkills: string[];
  reason: string;
  whyThisKBIsRelevant: string;
  shouldRecommend: boolean;
}

interface ChatRecommendationFlowResult {
  analysis: QuestionAnalysisResult | null;
  recommendations: KnowledgeBaseRecommendation[];
  recommendedKnowledgeBases: ChatRecommendedKnowledgeBase[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly suggestedQuestionsCache = new Map<string, SuggestedQuestionsCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly aiQuestionUnderstandingService: AiQuestionUnderstandingService,
    private readonly recommendationService: RecommendationService,
    private readonly skillRadarService: SkillRadarService,
  ) {}

  private cleanKnowledgeFallbackLine(line: string): string {
    return line
      .replace(/```(?:json|markdown|md)?/gi, "")
      .replace(/```/g, "")
      .replace(/^\s*[-*•]\s*/, "")
      .replace(/\s+\d+[.)]\s*0\s+/g, ". ")
      .replace(/^\s*\d+[.)]\s*0\s+/, "")
      .replace(/^\s*\d+[.)]\s*/, "")
      .replace(/^\s*0\s+/, "")
      .replace(/\s+/g, " ")
      .replace(/\s+\.\.\.$/, "")
      .trim();
  }

  private containsSensitiveSystemSettings(content: string): boolean {
    return /\b(BIOS|UEFI|Secure Boot|TPM|boot|disk|security)\b/i.test(content);
  }

  private summarizeKnowledgeFallbackReadable(content: string): string {
    const compactContent = content
      .replace(/```(?:json|markdown|md)?/gi, "")
      .replace(/```/g, "")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const lines = compactContent
      .split(/\n|(?<=\S)\s+(?=\d+[.)]\s)|(?<=\S)\s+(?=[-*•]\s)/)
      .map((line) => this.cleanKnowledgeFallbackLine(line))
      .filter((line) => line.length >= 12 && line !== "...");

    const bullets = Array.from(new Set(lines)).slice(0, 4);

    if (!bullets.length) {
      const fallbackText = this.cleanKnowledgeFallbackLine(compactContent).slice(0, 420);
      return fallbackText
        ? `สรุปจากฐานความรู้:\n- ${fallbackText}`
        : "สรุปจากฐานความรู้:\n- ฐานความรู้นี้ยังมีรายละเอียดไม่เพียงพอสำหรับสรุปคำตอบค่ะ";
    }

    const sections = ["สรุปจากฐานความรู้:", ...bullets.map((line) => `- ${line}`)];

    if (this.containsSensitiveSystemSettings(compactContent)) {
      sections.push(
        "",
        "ข้อควรระวัง:",
        "- การตั้งค่า BIOS/UEFI, Secure Boot หรือ TPM ควรทำอย่างระมัดระวัง และควรตรวจสอบรุ่นเครื่องหรือเมนบอร์ดก่อนเปลี่ยนค่าค่ะ",
      );
    }

    return sections.join("\n");
  }

  private fallbackReply(content: string, knowledge?: { title: string; content: string }): string {
    if (knowledge) {
      return [
        `ขออภัยค่ะ ตอนนี้ AI สร้างคำตอบแบบละเอียดไม่ได้ จึงสรุปจากฐานความรู้ "${knowledge.title}" แบบย่อให้ก่อนค่ะ`,
        this.summarizeKnowledgeFallbackReadable(knowledge.content),
        "หากต้องการรายละเอียดเพิ่มเติม กรุณาลองถามอีกครั้งค่ะ",
      ].join("\n\n");
    }
    return `คำตอบนี้ไม่ได้อ้างอิงจากฐานความรู้ที่แอดมินเพิ่มไว้โดยตรง แต่เป็นคำตอบจากความรู้ทั่วไปของ AI: รับทราบคำถาม "${content}" แล้วค่ะ`;
  }

  private toActivityIso(value?: Date | string | null): string {
    const date = value ? new Date(value) : new Date(0);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  }

  private async generateAiReply(
    sessionId: string,
    content: string,
    knowledge?: { title: string; content: string },
    sourceConfidenceScore?: number | null,
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
          ? `${SELECTED_KB_SYSTEM_PROMPT}${sourceConfidenceScore !== null && sourceConfidenceScore !== undefined && sourceConfidenceScore < 0.25 ? `\n\n${LOW_KB_CONFIDENCE_PROMPT}` : ""}\n\nผู้ใช้เลือกฐานความรู้ "${knowledge.title}" เป็นแหล่งอ้างอิงหลักในการตอบคำถามนี้ ให้ยึดข้อมูลในฐานความรู้นี้เป็นหลักอย่างเคร่งครัด ห้ามเดา ห้ามแต่งรายละเอียด ขั้นตอน เงื่อนไข หรือข้อสรุปที่ไม่มีข้อมูลรองรับในฐานความรู้ หากฐานความรู้มีข้อมูลไม่พอ ให้บอกอย่างชัดเจนว่า "ฐานความรู้นี้ยังให้รายละเอียดไม่เพียงพอ" แล้วแนะนำว่าควรถามหรือเพิ่มข้อมูลอะไรต่อ ห้ามใส่ความรู้ทั่วไปเพิ่มเอง เว้นแต่คำถามของผู้ใช้ขอให้เสริมความรู้ทั่วไปอย่างชัดเจน และถ้าเสริม ต้องขึ้นหัวข้อว่า "ข้อมูลเพิ่มเติมนอกฐานความรู้:" ก่อนเสมอ ตอบโดยเรียบเรียงใหม่ให้อ่านง่าย ไม่ใช่คัดลอกเนื้อหาดิบทั้งก้อน\n\nข้อมูลจากฐานความรู้:\nชื่อ: ${knowledge.title}\nเนื้อหา:\n${knowledge.content}`
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

  private async recomputeSourceConfidence(content: string, articleId: string): Promise<number | null> {
    try {
      const recommendations = await this.recommendationService.recommend({
        title: content,
        description: content,
      });
      const selectedArticle = recommendations.find((recommendation) => recommendation.articleId === articleId);
      return selectedArticle?.confidenceScore ?? null;
    } catch (error) {
      this.logger.warn(`Failed to recompute KB source confidence: ${error}`);
      return null;
    }
  }

  private async recordSkillSignalsFromQuestion(
    userId: string,
    content: string,
    sourceId: string,
    analysis: QuestionAnalysisResult | null,
    recommendations: KnowledgeBaseRecommendation[],
  ) {
    try {
      if (!analysis) return;
      await this.skillRadarService.recordQuestionInterestSignal({
        userId,
        source: "CHAT_QUESTION",
        question: content,
        sourceId,
        analysis,
        recommendations,
      });
    } catch (error) {
      this.logger.warn(`Failed to record AI chat interest signal: ${error}`);
    }
  }

  private buildRecommendedKnowledgeBases(
    recommendations: KnowledgeBaseRecommendation[],
    candidates: KnowledgeBaseCandidate[],
  ): ChatRecommendedKnowledgeBase[] {
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const items: ChatRecommendedKnowledgeBase[] = [];

    for (const recommendation of recommendations) {
      const candidate = candidateById.get(recommendation.knowledgeBaseId);
      if (!candidate) continue;
      items.push({
        articleId: candidate.id,
        title: candidate.title,
        preview: candidate.contentPreview ?? candidate.summary ?? null,
        summary: candidate.summary ?? null,
        confidenceScore: recommendation.confidenceScore,
        matchedSkills: recommendation.matchedSkills,
        reason: recommendation.reason,
        whyThisKBIsRelevant: recommendation.whyThisKBIsRelevant,
        shouldRecommend: recommendation.shouldRecommend,
      });
    }

    return items;
  }

  private async getRecommendedKnowledgeBases(
    userId: string,
    content: string,
  ): Promise<ChatRecommendationFlowResult> {
    try {
      const availableSkillNames = await this.skillRadarService.listSkillNamesForUser(userId);
      const analysis = await this.aiQuestionUnderstandingService.analyzeQuestion({
        userId,
        question: content,
        contextType: "GENERAL_CHAT",
        availableSkillNames,
      });
      const candidates = await this.recommendationService.searchCandidates({
        originalQuestion: analysis.originalQuestion,
        interpretedQuestion: analysis.interpretedQuestion,
        keywords: analysis.keywords,
        possibleSkills: analysis.possibleSkills,
        limit: 20,
      });
      const recommendations = await this.recommendationService.rerankCandidates({
        analysis,
        candidates,
      });

      this.logger.log(
        `Chat KB recommendation flow: interpreted="${analysis.interpretedQuestion.slice(0, 160)}", fallback=${analysis.fallbackUsed === true}, candidates=${candidates.length}, selected=${recommendations.map((recommendation) => `${recommendation.knowledgeBaseId}:${recommendation.confidenceScore}`).join(",") || "none"}`,
      );

      return {
        analysis,
        recommendations,
        recommendedKnowledgeBases: this.buildRecommendedKnowledgeBases(recommendations, candidates),
      };
    } catch (error) {
      this.logger.warn(`Chat KB recommendation flow failed, continuing without recommendations: ${error}`);
      return { analysis: null, recommendations: [], recommendedKnowledgeBases: [] };
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

    const sourceConfidenceScore = knowledge
      ? await this.recomputeSourceConfidence(dto.content, knowledge.id)
      : null;
    const aiContent = await this.generateAiReply(
      session.id,
      dto.content,
      knowledge ?? undefined,
      sourceConfidenceScore,
    );
    const recommendationFlow = await this.getRecommendedKnowledgeBases(userId, dto.content);

    const userMessage = await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: dto.content },
    });
    await this.recordSkillSignalsFromQuestion(
      userId,
      dto.content,
      userMessage.id,
      recommendationFlow.analysis,
      recommendationFlow.recommendations,
    );

    const aiMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: aiContent,
        sourceType: knowledge ? "KNOWLEDGE_BASE" : "GENERAL_AI",
        sourceArticleId: knowledge?.id ?? null,
        sourceArticleTitle: knowledge?.title ?? null,
        sourceConfidenceScore,
      },
    });

    return {
      session,
      messages: [userMessage, aiMessage],
      recommendedKnowledgeBases: recommendationFlow.recommendedKnowledgeBases,
    };
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

  private async buildSuggestedQuestionsSummary(userId: string): Promise<SuggestedQuestionsSummary> {
    const [radar, recentUserMessages, recentLessons, recentAttempts, recentKbAnswers, recentSkillEvents, totalLessons, completedLessons] =
      await Promise.all([
        this.skillRadarService.getUserRadar(userId).catch(() => null),
        this.prisma.chatMessage.findMany({
          where: { role: "USER", session: { userId } },
          orderBy: { createdAt: "desc" },
          take: RECENT_ACTIVITY_LIMIT,
          select: { content: true, createdAt: true },
        }),
        this.prisma.lesson.findMany({
          where: { createdByUserId: userId },
          orderBy: { createdAt: "desc" },
          take: RECENT_ACTIVITY_LIMIT,
          select: { title: true, createdAt: true },
        }),
        this.prisma.quizAttempt.findMany({
          where: { userId },
          orderBy: { completedAt: "desc" },
          take: RECENT_ACTIVITY_LIMIT,
          include: { quiz: { select: { title: true } } },
        }),
        this.prisma.chatMessage.findMany({
          where: { role: "ASSISTANT", sourceType: "KNOWLEDGE_BASE", session: { userId } },
          orderBy: { createdAt: "desc" },
          take: RECENT_ACTIVITY_LIMIT,
          select: { sourceArticleTitle: true, sourceConfidenceScore: true, createdAt: true },
        }),
        (this.prisma.skillScoreEvent as unknown as { findMany?: (args: unknown) => Promise<RecentSkillScoreEvent[]> } | undefined)?.findMany?.({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: RECENT_ACTIVITY_LIMIT,
          include: { skill: { select: { name: true } }, position: { select: { name: true } } },
        }) ?? Promise.resolve([] as RecentSkillScoreEvent[]),
        this.prisma.lesson.count({ where: { createdByUserId: userId } }),
        this.prisma.lessonProgress.count({ where: { userId, completed: true } }),
      ]);

    const skillsWithEvidence = (radar?.skills ?? []).filter((skill) => skill.evidenceCount > 0);
    const topSkills = [...skillsWithEvidence].sort((a, b) => b.score - a.score).slice(0, 3).map((skill) => skill.name);
    const weakSkills = [...skillsWithEvidence].sort((a, b) => a.score - b.score).slice(0, 3).map((skill) => skill.name);

    const positionSkills = radar?.skills.map((skill) => skill.name) ?? [];
    const recentTopics = Array.from(
      new Set([
        ...recentLessons.map((lesson) => lesson.title),
        ...recentAttempts.map((attempt) => attempt.quiz.title),
      ]),
    ).slice(0, RECENT_ACTIVITY_LIMIT);

    const recommendedKnowledgeBase = Array.from(
      new Set(
        recentKbAnswers
          .map((message) => message.sourceArticleTitle)
          .filter((title): title is string => !!title),
      ),
    ).slice(0, 3);

    const latestActivities: SuggestedQuestionActivity[] = [
      ...recentUserMessages.map((message) => ({
        type: "chat_question" as const,
        title: message.content.slice(0, 160),
        createdAt: this.toActivityIso(message.createdAt),
      })),
      ...recentLessons.map((lesson) => ({
        type: "lesson_created" as const,
        title: lesson.title,
        createdAt: this.toActivityIso(lesson.createdAt),
      })),
      ...recentAttempts.map((attempt) => ({
        type: "quiz_attempt" as const,
        title: attempt.quiz.title,
        score: attempt.score,
        createdAt: this.toActivityIso(attempt.completedAt),
      })),
      ...recentKbAnswers
        .filter((message) => !!message.sourceArticleTitle)
        .map((message) => ({
          type: "kb_answer" as const,
          title: message.sourceArticleTitle ?? "",
          score:
            message.sourceConfidenceScore === null || message.sourceConfidenceScore === undefined
              ? undefined
              : Math.round(message.sourceConfidenceScore * 100),
          createdAt: this.toActivityIso(message.createdAt),
        })),
      ...recentSkillEvents.map((event) => ({
        type: "skill_signal" as const,
        title: event.skill.name,
        detail: `${event.position.name}: ${event.sourceType}`,
        score: Math.round(event.scoreAfter),
        createdAt: this.toActivityIso(event.createdAt),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, RECENT_ACTIVITY_LIMIT);

    return {
      currentPosition: radar?.position.name ?? "Software Engineer",
      positionSkills,
      topSkills,
      weakSkills,
      latestActivities,
      recentTopics,
      recentQuestions: recentUserMessages.map((message) => message.content),
      learningProgress: {
        completedLessons,
        totalLessons,
        percentage: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
      },
      recommendedKnowledgeBase,
    };
  }

  private parseSuggestedQuestions(raw: string): string[] {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("AI response did not contain a JSON array");

    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) throw new Error("AI response JSON is not an array");

    const questions = Array.from(
      new Set(
        parsed
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 100)),
      ),
    ).slice(0, SUGGESTED_QUESTIONS_MAX);

    if (questions.length < SUGGESTED_QUESTIONS_MIN) {
      throw new Error(`AI returned too few usable questions (${questions.length})`);
    }

    return questions;
  }

  private pickThreeQuestions(questions: string[]): string[] {
    return Array.from(new Set(questions.map((question) => question.trim()).filter(Boolean)))
      .sort(() => Math.random() - 0.5)
      .slice(0, SUGGESTED_QUESTIONS_DISPLAY_LIMIT);
  }

  private buildPositionStarterQuestions(positionName: string, skills: string[]): string[] {
    const positionQuestions: Record<string, string[]> = {
      "Software Engineer": [
        "ควรเริ่มฝึกออกแบบระบบเว็บจากส่วนไหนก่อนดี?",
        "อยากพัฒนา FrontEnd และ BackEnd ควรเรียนอะไรต่อ?",
        "ช่วยวางแผนฝึกทำโปรเจกต์ Software Engineer ให้หน่อย",
        "ถ้าจะเตรียมตัวสมัครงานสาย Software Engineer ควรโฟกัสอะไร?",
      ],
      "UX/UI Designer": [
        "อยากเริ่มทำ UX/UI Portfolio ควรเริ่มจากอะไร?",
        "ช่วยอธิบายความต่างระหว่าง UX Research กับ UI Design",
        "ถ้าจะออกแบบหน้าจอให้ใช้ง่าย ควรเช็กอะไรบ้าง?",
        "อยากฝึก Design System ควรเริ่มจากส่วนไหน?",
      ],
      Investor: [
        "อยากเริ่มวิเคราะห์หุ้นควรดูตัวเลขอะไรเป็นอันดับแรก?",
        "ช่วยอธิบาย Risk Management สำหรับนักลงทุนมือใหม่",
        "จะประเมินมูลค่าธุรกิจแบบง่าย ๆ ได้อย่างไร?",
        "ควรจัดพอร์ตลงทุนให้เหมาะกับความเสี่ยงยังไง?",
      ],
      "Financial Accounting": [
        "อยากเข้าใจงบการเงินควรเริ่มจากงบไหนก่อน?",
        "ช่วยอธิบายพื้นฐานบัญชีเดบิตเครดิตแบบเข้าใจง่าย",
        "ถ้าจะตรวจความถูกต้องของรายงานการเงินควรดูอะไร?",
        "ภาษีพื้นฐานที่นักบัญชีควรรู้มีอะไรบ้าง?",
      ],
      "Project Manager": [
        "อยากวางแผนโปรเจกต์ให้ไม่หลุด deadline ควรทำยังไง?",
        "ช่วยอธิบาย Risk Management ในโปรเจกต์แบบง่าย ๆ",
        "ถ้าทีมสื่อสารไม่ตรงกัน PM ควรแก้ยังไง?",
        "Agile กับ Scrum ต่างกันอย่างไรสำหรับ Project Manager?",
      ],
      "Sales Manager": [
        "อยากวางแผน Sales Pipeline ควรเริ่มจากอะไร?",
        "ช่วยอธิบายการติดตาม Lead ใน CRM แบบเป็นขั้นตอน",
        "ถ้าปิดการขายไม่ได้ ควรวิเคราะห์จากจุดไหน?",
        "Sales Manager ควรดู KPI อะไรบ้าง?",
      ],
      "IT Support": [
        "ถ้าคอมพิวเตอร์เปิดไม่ติดควรไล่เช็กอะไรบ้าง?",
        "ช่วยอธิบายการแก้ปัญหา Network เบื้องต้น",
        "IT Support ควรถามข้อมูลอะไรจากผู้ใช้ก่อนเริ่มแก้ปัญหา?",
        "อยากฝึก Troubleshooting ให้เก่งขึ้นควรเริ่มอย่างไร?",
      ],
    };

    const skillQuestions = skills.slice(0, 4).map((skill) => `ถ้าอยากพัฒนา ${skill} ควรเริ่มเรียนหรือฝึกอะไรดี?`);
    return this.pickThreeQuestions([
      ...(positionQuestions[positionName] ?? []),
      ...skillQuestions,
      `ช่วยแนะนำเส้นทางเรียนสำหรับสาย ${positionName} ให้หน่อย`,
      `ทักษะสำคัญของ ${positionName} ที่ควรเริ่มฝึกมีอะไรบ้าง?`,
    ]);
  }

  private buildFallbackSuggestedQuestions(summary: SuggestedQuestionsSummary): string[] {
    if (summary.latestActivities.length === 0) {
      return this.buildPositionStarterQuestions(summary.currentPosition, summary.positionSkills);
    }

    const activityQuestions = summary.latestActivities.slice(0, 6).flatMap((activity) => {
      const title = activity.title.slice(0, 45);
      if (activity.type === "chat_question") {
        return [`ช่วยต่อยอดจากคำถามเรื่อง "${title}" ให้ลึกขึ้นหน่อย`, `มีตัวอย่างจริงของ "${title}" ไหม?`];
      }
      if (activity.type === "quiz_attempt") {
        return [`จากแบบทดสอบ "${title}" ควรทบทวนเรื่องไหนต่อ?`, `ช่วยสรุปจุดสำคัญของ "${title}" ให้หน่อย`];
      }
      if (activity.type === "lesson_created") {
        return [`บทเรียน "${title}" ควรเรียนต่อยอดเรื่องอะไร?`, `ช่วยยกตัวอย่างการใช้ "${title}" แบบใช้งานจริง`];
      }
      return [`ช่วยอธิบายเพิ่มเติมเกี่ยวกับ "${title}" ให้เข้าใจง่ายขึ้น`];
    });

    return this.pickThreeQuestions([
      ...activityQuestions,
      ...summary.topSkills.map((skill) => `ถ้าอยากต่อยอด ${skill} ควรถาม AI เรื่องอะไรต่อ?`),
      ...this.buildPositionStarterQuestions(summary.currentPosition, summary.positionSkills),
    ]);
  }

  private buildSuggestedQuestionsSignature(summary: SuggestedQuestionsSummary): string {
    return JSON.stringify({
      currentPosition: summary.currentPosition,
      positionSkills: summary.positionSkills,
      topSkills: summary.topSkills,
      weakSkills: summary.weakSkills,
      latestActivities: summary.latestActivities.map((activity) => ({
        type: activity.type,
        title: activity.title,
        detail: activity.detail ?? null,
        score: activity.score ?? null,
        createdAt: activity.createdAt,
      })),
    });
  }

  async getSuggestedQuestions(userId: string): Promise<{ questions: string[] }> {
    try {
      const summary = await this.buildSuggestedQuestionsSummary(userId);
      const signature = this.buildSuggestedQuestionsSignature(summary);
      const cached = this.suggestedQuestionsCache.get(userId);
      if (cached?.signature === signature) {
        return { questions: cached.questions };
      }

      try {
        const reply = await this.aiService.chat(
          [
            { role: "system", content: SUGGESTED_QUESTIONS_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(summary) },
          ],
          SUGGESTED_QUESTIONS_OPTIONS,
        );

        const questions = this.parseSuggestedQuestions(reply).slice(0, SUGGESTED_QUESTIONS_DISPLAY_LIMIT);
        this.suggestedQuestionsCache.set(userId, { signature, questions });
        return { questions };
      } catch (error) {
        this.logger.warn(`AI suggested questions unavailable, using activity fallback: ${error}`);
        const questions = this.buildFallbackSuggestedQuestions(summary);
        this.suggestedQuestionsCache.set(userId, { signature, questions });
        return { questions };
      }
    } catch (error) {
      this.logger.warn(`AI ล่ม: suggested questions unavailable, using default list: ${error}`);
      return { questions: DEFAULT_SUGGESTED_QUESTIONS.slice(0, SUGGESTED_QUESTIONS_DISPLAY_LIMIT) };
    }
  }
}
