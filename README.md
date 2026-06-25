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

## Setup

```bash
cp .env.example .env   # set DATABASE_URL
npm install
npm run prisma:migrate
npm run prisma:seed
```