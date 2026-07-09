/**
 * Pure Career Readiness Benchmark calculation.
 *
 * No Prisma/NestJS/AI dependency — plain data in, plain result out — so the
 * "which level does this learner's Skill Radar map to" decision is deterministic,
 * unit-testable, and reusable. AI is only used later (in the service) to phrase a
 * human-friendly description; it NEVER decides the level or the numbers here.
 */

export interface CareerReadinessSkillInput {
  name: string;
  score: number; // 0-100
  evidenceCount: number;
}

export interface CareerReadinessResult {
  /** e.g. "Junior Strong" — the tier label shown on the benchmark card. */
  level: string;
  /** 0-100 backend-computed readiness number the level is derived from. */
  readinessScore: number;
  /** Top skill names that actually have evidence, strongest first. */
  strengths: string[];
}

// Tier ladder, checked high-to-low. A learner needs a higher readinessScore to
// reach each higher tier. "Junior Strong" sits in the middle as the design default.
const LEVEL_TIERS: ReadonlyArray<{ min: number; level: string }> = [
  { min: 82, level: "Advanced" },
  { min: 68, level: "Intermediate" },
  { min: 50, level: "Junior Strong" },
  { min: 30, level: "Junior" },
  { min: 1, level: "Beginner" },
];
const NO_EVIDENCE_LEVEL = "Getting Started";
const MAX_STRENGTHS = 3;

// How much the average skill score vs. breadth-of-evidence each contribute to
// readiness. avgScore dominates (0.6) but proving evidence across MORE skills
// lifts readiness (up to +0.4) — so a single very strong skill can't reach the
// top tiers alone; you have to be well-rounded for the position.
const AVG_SCORE_WEIGHT = 0.6;
const BREADTH_WEIGHT = 0.4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * @param skills           All skills for the learner's position (with their current score/evidence).
 * @param totalSkillCount  Denominator for breadth; defaults to skills.length.
 */
export function calculateCareerReadiness(
  skills: CareerReadinessSkillInput[],
  totalSkillCount: number = skills.length,
): CareerReadinessResult {
  // Only skills the learner has actually demonstrated (real evidence + a real
  // score) count toward readiness. Skills sitting at 0 with no evidence are noise.
  const evidenced = skills.filter((skill) => skill.evidenceCount > 0 && skill.score > 0);

  if (evidenced.length === 0) {
    return { level: NO_EVIDENCE_LEVEL, readinessScore: 0, strengths: [] };
  }

  const avgScore =
    evidenced.reduce((sum, skill) => sum + clamp(skill.score, 0, 100), 0) / evidenced.length;
  const breadth = totalSkillCount > 0 ? clamp(evidenced.length / totalSkillCount, 0, 1) : 0;

  const readinessScore = round2(clamp(avgScore * (AVG_SCORE_WEIGHT + BREADTH_WEIGHT * breadth), 0, 100));

  const level = LEVEL_TIERS.find((tier) => readinessScore >= tier.min)?.level ?? "Beginner";

  const strengths = [...evidenced]
    .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount)
    .slice(0, MAX_STRENGTHS)
    .map((skill) => skill.name);

  return { level, readinessScore, strengths };
}
