# Learing-curve-back

NestJS backend for Learning Curve (AI support helpdesk). Database: PostgreSQL via Prisma.

## Schema overview

- **users** — auth + role (`USER` / `ADMIN`)
- **categories** — shared lookup table for issue reports and knowledge base articles
- **chat_sessions** / **chat_messages** — one session has many messages; each message is `USER` or `ASSISTANT`
- **issue_reports** — แจ้งปัญหา, linked to a `reporter` (User) and a `category`, tracks `priority`/`status`
- **knowledge_base_articles** — linked to a `category` and optionally an `author` (admin)

Relations:
```
User 1---* ChatSession 1---* ChatMessage
User 1---* IssueReport *---1 Category
User 1---* KnowledgeBaseArticle *---1 Category
```

## API

All routes are mounted under `/api`. JWT bearer auth (`Authorization: Bearer <token>`) is required except login.

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | email+password → `{ accessToken, user }` |
| GET | `/api/auth/me` | auth | current user |
| POST | `/api/chat` | auth | send a message, get session + AI reply |
| GET | `/api/chat?sessionId=` | auth | messages for a session (owner only) |
| GET | `/api/history` | auth | current user's chat sessions |
| POST | `/api/issues` | auth | report an issue (แจ้งปัญหา) |
| GET | `/api/issues` | ADMIN | list all issues |
| GET | `/api/knowledge-base` | auth | list KB articles |
| POST/PUT/DELETE | `/api/knowledge-base[/:id]` | ADMIN | manage KB articles |
| GET | `/api/dashboard` | ADMIN | aggregate stats |

The mock AI reply matches the message against KB article titles/content (same heuristic the frontend mock used), falling back to a generic acknowledgement.

## Setup

```bash
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, PORT
npm install
npm run prisma:migrate
npm run prisma:seed
npm run start:dev      # http://localhost:3333/api
```

Demo accounts (from the seed script): `admin@learningcurve.dev` / `admin1234` (ADMIN), `user@learningcurve.dev` / `user1234` (USER).