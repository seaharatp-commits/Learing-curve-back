export interface GeneratedQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface GeneratedTopicLesson {
  title: string;
  content: string;
}

export interface GeneratedTopicResult {
  lessonId: string;
  quizId: string | null;
  title: string;
}

export interface GeneratedLessonQuizResult {
  quizId: string;
  title: string;
}

export interface LessonChatResult {
  answer: string;
}

export interface QuizListItem {
  id: string;
  title: string;
  questionCount: number;
  sourceArticleTitle: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
}

export interface QuizQuestionForAttempt {
  id: string;
  questionText: string;
  options: string[];
  skillMappings?: Array<{
    skillId: string;
    skillName: string;
    positionId: string;
    positionName: string;
    weight: number;
  }>;
}

export interface QuizForAttempt {
  id: string;
  title: string;
  questions: QuizQuestionForAttempt[];
}

export interface SubmitAnswer {
  questionId: string;
  selectedIndex: number;
}

export interface AnswerResult {
  questionId: string;
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  explanation: string | null;
}

export interface QuizAttemptResult {
  attemptId: string;
  score: number;
  totalQuestions: number;
  correctCount: number;
  answers: AnswerResult[];
  submittedAt: Date;
}

export interface QuizAttemptHistoryItem {
  attemptId: string;
  quizId: string;
  lessonId: string | null;
  quizTitle: string;
  score: number;
  totalQuestions: number;
  correctCount: number;
  submittedAt: Date;
  answers: AnswerResult[];
  detailAnswers: QuizAttemptDetailAnswer[];
}

export interface QuizAttemptDetailAnswer {
  questionId: string;
  questionText: string;
  selectedIndex: number | null;
  selectedAnswer: string | null;
  correctIndex: number | null;
  correctAnswer: string | null;
  isCorrect: boolean;
  explanation: string | null;
}
