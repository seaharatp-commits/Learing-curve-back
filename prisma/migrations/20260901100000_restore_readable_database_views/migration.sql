-- Read-only views for browsing LearningCurve with names instead of relation UUIDs.
-- Base tables remain the sole source of truth; each view reflects current data.

CREATE VIEW "readable_users" AS
SELECT u."name" AS "userName", u."email", u."role", p."name" AS "preferredPositionName", u."createdAt", u."updatedAt"
FROM "users" u LEFT JOIN "positions" p ON p."id" = u."preferredPositionId";

CREATE VIEW "readable_categories" AS
SELECT c."name" AS "categoryName", c."createdAt"
FROM "categories" c;

CREATE VIEW "readable_chat_sessions" AS
SELECT u."name" AS "userName", u."email" AS "userEmail", s."title" AS "sessionTitle", s."createdAt", s."updatedAt"
FROM "chat_sessions" s JOIN "users" u ON u."id" = s."userId";

CREATE VIEW "readable_chat_messages" AS
SELECT
  u."name" AS "userName", s."title" AS "sessionTitle", m."role", m."content", m."sourceType",
  COALESCE(m."sourceArticleTitle", a."title") AS "sourceArticleTitle", m."sourceConfidenceScore", m."createdAt"
FROM "chat_messages" m
JOIN "chat_sessions" s ON s."id" = m."sessionId"
JOIN "users" u ON u."id" = s."userId"
LEFT JOIN "knowledge_base_articles" a ON a."id" = m."sourceArticleId";

CREATE VIEW "readable_knowledge_base_articles" AS
SELECT
  a."title", a."content", c."name" AS "categoryName", u."name" AS "authorName", a."summary", a."symptoms",
  a."environment", a."rootCause", a."resolution", a."verification", a."keywords", a."tags", a."originalText",
  a."createdAt", a."updatedAt"
FROM "knowledge_base_articles" a
JOIN "categories" c ON c."id" = a."categoryId"
LEFT JOIN "users" u ON u."id" = a."authorId";

CREATE VIEW "readable_lessons" AS
SELECT l."title", l."content", l."order", u."name" AS "createdByUserName", l."createdAt"
FROM "lessons" l LEFT JOIN "users" u ON u."id" = l."createdByUserId";

CREATE VIEW "readable_quizzes" AS
SELECT
  q."title", u."name" AS "createdByUserName", l."title" AS "lessonTitle", a."title" AS "sourceArticleTitle",
  p."name" AS "positionName", q."createdAt"
FROM "quizzes" q
LEFT JOIN "users" u ON u."id" = q."createdByUserId"
LEFT JOIN "lessons" l ON l."id" = q."lessonId"
LEFT JOIN "knowledge_base_articles" a ON a."id" = q."sourceArticleId"
LEFT JOIN "positions" p ON p."id" = q."positionId";

CREATE VIEW "readable_questions" AS
SELECT q."title" AS "quizTitle", question."questionText", question."options", question."correctIndex", question."explanation", question."createdAt"
FROM "questions" question JOIN "quizzes" q ON q."id" = question."quizId";

CREATE VIEW "readable_quiz_attempts" AS
SELECT
  u."name" AS "userName", q."title" AS "quizTitle", l."title" AS "lessonTitle", attempt."score",
  attempt."selectedAnswers", attempt."correctAnswers", attempt."result", attempt."submittedAt", attempt."completedAt"
FROM "quiz_attempts" attempt
JOIN "users" u ON u."id" = attempt."userId"
JOIN "quizzes" q ON q."id" = attempt."quizId"
LEFT JOIN "lessons" l ON l."id" = attempt."lessonId";

CREATE VIEW "readable_lesson_progress" AS
SELECT u."name" AS "userName", l."title" AS "lessonTitle", progress."completed", progress."completedAt"
FROM "lesson_progress" progress
JOIN "users" u ON u."id" = progress."userId"
JOIN "lessons" l ON l."id" = progress."lessonId";

CREATE VIEW "readable_positions" AS
SELECT p."name" AS "positionName", p."description", p."isActive", p."createdAt", p."updatedAt"
FROM "positions" p;

CREATE VIEW "readable_position_skills" AS
SELECT
  p."name" AS "positionName", skill."name" AS "skillName", skill."description", skill."keywords", skill."weight",
  skill."isActive", skill."createdAt", skill."updatedAt"
FROM "position_skills" skill JOIN "positions" p ON p."id" = skill."positionId";

CREATE VIEW "readable_user_skill_scores" AS
SELECT
  u."name" AS "userName", p."name" AS "positionName", skill."name" AS "skillName", score."score",
  score."evidenceCount", score."confidence", score."wrongStreak", score."masteryPoint", score."updatedAt"
FROM "user_skill_scores" score
JOIN "users" u ON u."id" = score."userId"
JOIN "positions" p ON p."id" = score."positionId"
JOIN "position_skills" skill ON skill."id" = score."skillId";

CREATE VIEW "readable_skill_score_events" AS
SELECT
  u."name" AS "userName", p."name" AS "positionName", skill."name" AS "skillName", event."sourceType",
  event."scoreDelta", event."scoreBefore", event."scoreAfter", event."confidence", event."reason", event."createdAt"
FROM "skill_score_events" event
JOIN "users" u ON u."id" = event."userId"
JOIN "positions" p ON p."id" = event."positionId"
JOIN "position_skills" skill ON skill."id" = event."skillId";

CREATE VIEW "readable_career_alignment" AS
SELECT
  u."name" AS "userName", p."name" AS "positionName", alignment."scoreSumSnapshot",
  COALESCE(snapshot."skillScoreSummary", '') AS "skillScoreSummary", alignment."alignmentScore", alignment."level",
  alignment."description", alignment."quotes", alignment."strengths", alignment."nextSteps", alignment."generatedBy",
  alignment."createdAt", alignment."updatedAt"
FROM "career_alignment" alignment
JOIN "users" u ON u."id" = alignment."userId"
JOIN "positions" p ON p."id" = alignment."positionId"
LEFT JOIN LATERAL (
  SELECT string_agg(skill."name" || ': ' || split_part(snapshot_item, ':', 2), ' | ' ORDER BY skill."name") AS "skillScoreSummary"
  FROM regexp_split_to_table(alignment."skillScoreHash", '\\|') AS snapshot_item
  JOIN "position_skills" skill ON skill."id" = split_part(snapshot_item, ':', 1)
) snapshot ON TRUE;

CREATE VIEW "readable_quiz_question_skills" AS
SELECT q."title" AS "quizTitle", question."questionText", skill."name" AS "skillName", mapping."weight"
FROM "quiz_question_skills" mapping
JOIN "questions" question ON question."id" = mapping."questionId"
JOIN "quizzes" q ON q."id" = question."quizId"
JOIN "position_skills" skill ON skill."id" = mapping."skillId";
