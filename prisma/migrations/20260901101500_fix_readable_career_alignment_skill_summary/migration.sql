-- Use a literal delimiter rather than a regular expression so every cached
-- skill-score entry is resolved to its current skill name.
CREATE OR REPLACE VIEW "readable_career_alignment" AS
SELECT
  u."name" AS "userName",
  p."name" AS "positionName",
  alignment."scoreSumSnapshot",
  COALESCE(snapshot."skillScoreSummary", '') AS "skillScoreSummary",
  alignment."alignmentScore",
  alignment."level",
  alignment."description",
  alignment."quotes",
  alignment."strengths",
  alignment."nextSteps",
  alignment."generatedBy",
  alignment."createdAt",
  alignment."updatedAt"
FROM "career_alignment" alignment
JOIN "users" u ON u."id" = alignment."userId"
JOIN "positions" p ON p."id" = alignment."positionId"
LEFT JOIN LATERAL (
  SELECT string_agg(
    skill."name" || ': ' || split_part(snapshot_item, ':', 2),
    ' | ' ORDER BY skill."name"
  ) AS "skillScoreSummary"
  FROM unnest(string_to_array(alignment."skillScoreHash", '|')) AS snapshot_item
  JOIN "position_skills" skill ON skill."id" = split_part(snapshot_item, ':', 1)
) snapshot ON TRUE;
