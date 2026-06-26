# Learing-curve-back

NestJS backend for **Learning Curve** — a Thai-language AI helpdesk/support web app.
Handles auth, AI chat (proxied to an external AI gateway), chat history, issue reports
(แจ้งปัญหา), and an admin-only knowledge base + dashboard.

Companion repo: `Learing-curve-front` (Next.js + HeroUI). Both repos live under
`C:\Users\User\Desktop\LearningCurve\`.

## Stack

- NestJS 10, TypeScript
- PostgreSQL via Prisma 6 (`prisma/schema.prisma`)
- JWT auth (`@nestjs/jwt` + `passport-jwt`), bcrypt password hashing
- axios for the outbound call to the AI gateway

## Architecture

All routes are mounted under `/api` (set via `app.setGlobalPrefix("api")` in `src/main.ts`).
JWT bearer auth is required on every route except `POST /api/auth/login`.

```
src/
├── main.ts                  # global prefix, CORS, ValidationPipe
├── app.module.ts             # wires every feature module
├── prisma/                   # PrismaService (global), connects on module init
├── ai/                       # AiService — calls the external AI Develyst gateway
├── auth/                     # JWT login, JwtAuthGuard, RolesGuard, @Roles, @CurrentUser
├── chat/                     # POST/GET /chat — builds AI Develyst conversation, persists messages
├── history/                  # GET /history — current user's chat sessions + last message
├── issues/                   # POST /issues (any user), GET /issues (ADMIN)
├── knowledge-base/           # GET (any user), POST/PUT/DELETE (ADMIN)
├── dashboard/                # GET /dashboard (ADMIN) — aggregate stats
└── common/categories.service.ts  # upserts a Category by name (shared by issues + KB)
```

Each feature module follows: `dto/` (class-validator) → `*.service.ts` (Prisma calls) →
`*.controller.ts` (guards + routes) → `*.module.ts`.

### Auth model

- `CredentialsProvider`-style login: `POST /api/auth/login` checks email/password against
  `users` table (bcrypt), returns `{ accessToken, user }`. JWT payload: `{ sub, email, role }`.
- `JwtAuthGuard` (route-level `@UseGuards`) + `RolesGuard` + `@Roles("ADMIN")` for
  admin-only endpoints (issues list, all knowledge-base mutations, dashboard).
- `@CurrentUser()` param decorator reads `req.user` (set by `JwtStrategy.validate`).

### AI integration (`src/ai/`)

Chat does **not** generate replies itself — it calls an external gateway, "AI Develyst"
(see the Bruno API collection at `C:\Users\User\Downloads\bruno\bruno` for the full
contract). That gateway fronts OpenAI/Gemini/xAI/DeepSeek behind one API.

- `AiService.chat(messages)` → `POST {AI_API_URL}/chat` with `{ messages, provider?, model? }`.
  If `AI_API_PROVIDER`/`AI_API_MODEL` env vars are unset, the gateway uses its own fallback
  chain (`deepseek → xai → gemini → openai`) and returns whichever provider responded.
- `ChatService.generateAiReply()` builds the conversation: a Thai system prompt, the
  session's prior messages (mapped from the DB's `USER`/`ASSISTANT` enum to lowercase
  `user`/`assistant`), and the new message. If a knowledge-base article's title/content
  matches the message (simple substring check), its content is injected into the system
  prompt as grounding context — a lightweight RAG.
- **Fallback**: if the AI Develyst call throws (network error, gateway down, etc.),
  `ChatService` falls back to a canned reply (the matched KB content verbatim, or a generic
  Thai acknowledgement) so chat never hard-fails.
- Env: `AI_API_URL` (default in `.env.example` is the production gateway
  `https://ai.develyst.online`; there's also a `local.bru` pointing at `localhost:3009`
  if a local instance of the gateway is ever run).

### Issue → Knowledge Base learning pipeline (`src/knowledge-base/knowledge-learning.service.ts`)

`POST /api/issues/:id/learn` (ADMIN) turns a resolved-in-spirit support ticket into a
standardized KB article, automatically:

1. Sends the issue (title/description/category/priority) to the AI gateway with a prompt
   that demands strict JSON back — `{ title, summary, symptoms, environment, rootCause,
   resolution, verification, keywords[], tags[], category }` — and explicitly forbids
   inventing technical details not present in the original report (unknown fields come
   back as `"ไม่ระบุ"`, never fabricated).
2. Searches existing KB articles for a match using **token-level overlap**, not exact
   keyword string equality — the AI phrases the same finding differently every call
   (`"Windows 11"` vs `"Windows"`, `"0x80070005"` vs `"error 0x80070005"`), so keywords/
   title/symptoms are tokenized into individual words and compared as sets
   (`buildFingerprint`). Match requires 2+ shared tokens, or 1+ if the category also matches.
3. On a match: merges the new findings into the existing article's fields (appends
   genuinely new info, skips anything that's already a substring of the existing text)
   and regenerates `content`. No match: creates a new article.
4. Either way, marks the source `IssueReport.status = RESOLVED` and links it via
   `knowledgeBaseArticleId` (many issues can point at the same article over time).

**Known limitation:** merging is naive text concatenation with `(เพิ่มเติม)` prefixes, not
AI-summarized — after many merges into the same article, `content` will get long and
repetitive. Fine for now; revisit if any article accumulates a lot of merges.

There's currently no frontend trigger for this endpoint — call it directly, or build an
admin UI button (e.g. on the dashboard's per-issue drill-down) if needed.

### Database (Prisma)

Six tables — see `prisma/schema.prisma`:

```
User 1---* ChatSession 1---* ChatMessage
User 1---* IssueReport *---1 Category
User 1---* IssueReport *---1 KnowledgeBaseArticle   (optional, set by the learning pipeline)
User 1---* KnowledgeBaseArticle *---1 Category
```

`categories` is a shared lookup table — both `issue_reports` and `knowledge_base_articles`
reference it by name (resolved/created on the fly via `CategoriesService.resolveByName`),
rather than storing free-text category strings.

`KnowledgeBaseArticle.summary/symptoms/environment/rootCause/resolution/verification/
keywords/tags` are all nullable/empty-default — articles created by hand through the admin
UI (`KnowledgeBaseService`, not `KnowledgeLearningService`) never populate them; `content`
remains the single source of truth for what the frontend displays either way.

## Local setup

Requires Docker (for Postgres) and Node 18+.

```bash
docker run -d --name learning-curve-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=learning_curve -p 5432:5432 postgres:16-alpine

cp .env.example .env          # DATABASE_URL, JWT_SECRET, PORT, AI_API_URL
npm install
npm run prisma:migrate        # creates tables
npm run prisma:seed           # admin@learningcurve.dev / admin1234, user@learningcurve.dev / user1234
npm run start:dev             # http://localhost:3333/api
```

**Gotcha:** if the Postgres container or this server isn't running, the frontend's login
will just show "อีเมลหรือรหัสผ่านไม่ถูกต้อง" — looks like a wrong-password error but is
actually a connection failure. Check `docker ps` and that this server is listening on 3333
first.

## API surface

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | public | → `{ accessToken, user }` |
| GET | `/api/auth/me` | auth | |
| POST | `/api/chat` | auth | `{ sessionId?, content }` → creates/continues a session, calls AI Develyst |
| GET | `/api/chat?sessionId=` | auth | messages for a session (owner only) |
| GET | `/api/history` | auth | current user's sessions, with `lastMessage`/`messageCount` |
| POST | `/api/issues` | auth | `{ title, description, category, priority }` |
| GET | `/api/issues` | ADMIN | all issues, newest first |
| POST | `/api/issues/:id/learn` | ADMIN | runs the AI extraction → dedup/merge → KB pipeline, marks issue RESOLVED |
| GET | `/api/knowledge-base` | auth | |
| POST/PUT/DELETE | `/api/knowledge-base[/:id]` | ADMIN | |
| GET | `/api/dashboard` | ADMIN | totals + issues grouped by category |

## Known rough edges

- `bcrypt`/`@types/bcrypt` pinned to specific versions — don't bump without checking
  native binary compatibility on Windows.
- Unit tests exist for the highest-risk pure logic: `text-similarity.util.spec.ts`,
  `recommendation.service.spec.ts`, `knowledge-learning.service.spec.ts` (`npm test`,
  Prisma/AiService mocked — no live DB needed). Controllers/guards/other services still
  only verified manually via curl/Node one-liners against a live Postgres + AI Develyst.
- `RolesGuard` throws a Thai-language `ForbiddenException` message — keep error messages
  in Thai for consistency with the rest of the app (it's user-facing in the frontend).
