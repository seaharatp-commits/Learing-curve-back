-- Roll back the read-only display views.  The application uses only its
-- original tables; this restores the database object layout accordingly.
DROP VIEW IF EXISTS "readable_quiz_question_skills";
DROP VIEW IF EXISTS "readable_career_alignment";
DROP VIEW IF EXISTS "readable_skill_score_events";
DROP VIEW IF EXISTS "readable_user_skill_scores";
DROP VIEW IF EXISTS "readable_position_skills";
DROP VIEW IF EXISTS "readable_positions";
DROP VIEW IF EXISTS "readable_lesson_progress";
DROP VIEW IF EXISTS "readable_quiz_attempts";
DROP VIEW IF EXISTS "readable_questions";
DROP VIEW IF EXISTS "readable_quizzes";
DROP VIEW IF EXISTS "readable_lessons";
DROP VIEW IF EXISTS "readable_knowledge_base_articles";
DROP VIEW IF EXISTS "readable_chat_messages";
DROP VIEW IF EXISTS "readable_chat_sessions";
DROP VIEW IF EXISTS "readable_categories";
DROP VIEW IF EXISTS "readable_users";
