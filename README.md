# LearningCurve Backend

NestJS backend for LearningCurve. It uses PostgreSQL through Prisma and exposes
authenticated learning, quiz, chat, Knowledge Base, and Skill Radar APIs.

## Source Of Truth

Keep the implementation and `prisma/schema.prisma` as the source of truth for
models, relations, permissions, and routes. The current schema includes:

- `User`, `Category`, `ChatSession`, and `ChatMessage`
- `KnowledgeBaseArticle`
- `Lesson`, `LessonProgress`, `Quiz`, `Question`, and `QuizAttempt`
- `Position`, `PositionSkill`, `UserSkillScore`, `SkillScoreEvent`
- `QuizQuestionSkill` and cached `CareerAlignment`

`CareerAlignment` is cached per `userId + positionId`. The cache is invalidated
by the deterministic `skillScoreHash`, not by `scoreSumSnapshot` alone.

## API

All routes are mounted under `/api`. JWT authentication is required unless
marked `public`. Admin-only routes are protected by `RolesGuard`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | Liveness check; does not query the database |
| GET | `/api/health/ready` | public | Readiness check; verifies the Prisma database connection |
| POST | `/api/auth/login` | public | Login with email and password |
| POST | `/api/auth/register` | public | Register a user |
| GET/POST | `/api/auth/me`, `/api/auth/change-password` | auth | Account operations |
| GET | `/api/learning/dashboard` | auth | Learner dashboard data |
| GET | `/api/learning/lessons/:id` | auth | Lesson detail |
| POST | `/api/learning/lessons/generate-from-topic` | auth | Generate a lesson from a topic |
| POST | `/api/learning/lessons/:id/chat` | auth | Ask a follow-up about a lesson |
| POST | `/api/learning/lessons/:id/quizzes/generate` | auth | Generate a quiz from a lesson |
| POST | `/api/learning/lessons/:id/complete` | auth | Complete a lesson |
| GET/POST/DELETE | `/api/learning/quizzes...` | auth | List, take, submit, and delete quizzes/attempts |
| POST/GET | `/api/chat`, `/api/chat/suggested-questions` | auth | AI Chat and suggested questions |
| GET/DELETE | `/api/history...` | auth | Current user's chat history |
| GET/POST/PUT/DELETE | `/api/knowledge-base...` | auth/admin | KB list, recommendation, and admin CRUD |
| GET/PUT | `/api/skill-radar/me...` | auth | User position, Skill Radar, and Career Alignment |
| GET/POST/PATCH | `/api/skill-radar/admin...` | admin | Position, skill, mapping, and event management |
| GET | `/api/dashboard` | admin | Admin dashboard statistics |

Normal users are scoped to their own lessons, quizzes, attempts, chats, and
skill data. Admin access is granted only by the existing role guards.

## AI behavior and fallback

`AiService` calls `POST {AI_API_URL}/chat`. The caller services handle failures:

- Chat returns a readable general-AI or Knowledge Base summary fallback.
- Lesson follow-up returns a concise lesson-based fallback.
- Lesson/quiz generation returns a clear temporary-unavailable response and
  does not save incomplete generated data.
- Career Alignment stores deterministic fallback content with
  `generatedBy = "fallback"` when the AI Center is unavailable.

The AI gateway URL is configured through `AI_API_URL`. Timeout and optional
provider/model settings are configurable through environment variables.

## Environment

Copy `.env.example` to `.env` and set real deployment values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/learning_curve?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=3333
AI_API_URL="https://ai.develyst.online"
AI_API_TIMEOUT_MS=30000
AI_API_PROVIDER=""
AI_API_MODEL=""
CORS_ORIGINS="http://localhost:3000,https://learning.develyst.online"
```

Never commit `.env`, production credentials, AI keys, or the JWT secret.

## Local setup

Requires Node 18+ and PostgreSQL.

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

The backend is available at `http://localhost:3333/api`.

Before deployment, verify `DATABASE_URL`, `JWT_SECRET`, `AI_API_URL`,
`CORS_ORIGINS`, and the frontend `NEXT_PUBLIC_API_URL`/`BACKEND_API_URL`.
