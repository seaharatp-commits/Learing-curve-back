export interface LearningProgress {
  completedLessons: number;
  totalLessons: number;
  percentage: number;
}

export interface QuizPerformance {
  totalCompleted: number;
  averageScore: number;
  latestScore: number | null;
}

export interface RecentQuiz {
  id: string;
  title: string;
  score: number;
  completedAt: Date;
}

export interface ContinueLearning {
  lessonId: string;
  title: string;
}

export interface LearningDashboard {
  learningProgress: LearningProgress;
  quizPerformance: QuizPerformance;
  recentQuizzes: RecentQuiz[];
  continueLearning: ContinueLearning | null;
}
