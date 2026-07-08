/**
 * Pure skill-score calculation logic for the Skill Radar.
 *
 * This file has NO Prisma/NestJS dependency on purpose — it only takes plain
 * numbers in and returns plain numbers out, so it can be unit tested without a
 * database and reused from any caller (quiz scoring, chat scoring, lesson
 * scoring, ...).
 *
 * IMPORTANT: AI is only allowed to say *which* skill an activity relates to,
 * and with what confidence/weight. AI must never be allowed to hand the
 * backend a final score number directly — this file is where the backend
 * decides the actual scoreDelta, using AI's confidence/weight only as an
 * input multiplier, never as the output.
 */

export type SkillEventType = "QUESTION" | "QUIZ_CORRECT" | "QUIZ_WRONG" | "LESSON_COMPLETE";

export interface SkillScoreState {
  /** 0-100. What the Radar chart displays for this skill. */
  score: number;
  /** 0-1. How sure the system is that `score` reflects the learner's real level. */
  confidence: number;
  /** How many scoring events have contributed evidence for this skill. */
  evidenceCount: number;
  /** Consecutive wrong answers for this skill, back to back. Resets on a correct answer. */
  wrongStreak: number;
  /** Extra "points" earned once score is already capped at 100, so continued
   *  correct answers still register as progress somewhere instead of just
   *  silently doing nothing once the Radar chart is maxed out. */
  masteryPoint: number;
}

export interface ScoreCalculationResult {
  newScore: number;
  newConfidence: number;
  newEvidenceCount: number;
  newWrongStreak: number;
  newMasteryPoint: number;
  scoreDelta: number;
  confidenceDelta: number;
  reason: string;
}

const POSITIVE_EVENT_TYPES = new Set<SkillEventType>(["QUESTION", "QUIZ_CORRECT", "LESSON_COMPLETE"]);

/** Minimum multiplier applied to a positive delta so the score never fully
 * flatlines before it actually reaches 100 — see calculatePositiveSkillScore. */
const MINIMUM_GAIN_MULTIPLIER = 0.1;

/** Confidence recovers a little on every positive signal, since a correct
 * answer/completed lesson is evidence the current score estimate is trustworthy. */
const POSITIVE_CONFIDENCE_GAIN = 0.05;

/** Confidence lost on the FIRST wrong answer for a skill (no wrongStreak yet). */
const FIRST_MISTAKE_CONFIDENCE_PENALTY = 0.04;
/** Confidence lost once the score itself is also being reduced (streak/repeat). */
const SCORE_REDUCING_CONFIDENCE_PENALTY = 0.08;

/** evidenceCount above this is treated as "very well established" for the
 * purposes of evidence-protection — going higher keeps giving diminishing
 * protection but never below EVIDENCE_PROTECTION_MIN. */
const EVIDENCE_PROTECTION_DIVISOR = 100;
const EVIDENCE_PROTECTION_MIN = 0.25;
const EVIDENCE_PROTECTION_MAX = 1;

const REPEATED_MISTAKE_MULTIPLIER = 1.5;
const STREAK_MULTIPLIER_PER_MISS = 0.5;
const STREAK_MULTIPLIER_MIN = 0.5;
const STREAK_MULTIPLIER_MAX = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Positive scoring: QUESTION, QUIZ_CORRECT, LESSON_COMPLETE.
 *
 * --- What "Diminishing Return" means here ---
 * The same amount of new evidence should move the score less the closer the
 * score already is to 100. A learner going from 20% -> ~28% on one correct
 * answer is believable; a learner going from 90% -> ~98% on one correct
 * answer is not — at that point they've already proven the skill many times,
 * so one more data point should barely move the needle. We model that with
 * `diminishingMultiplier = 1 - currentScore / 100`: it linearly shrinks the
 * delta as currentScore approaches 100, and hits 0 exactly at 100.
 *
 * We still apply a small `minimumGainMultiplier` (10% of baseDelta) below 100
 * so the score doesn't feel "stuck" in the high-80s/low-90s range forever —
 * without it, diminishingMultiplier alone would make gains feel imperceptibly
 * small well before actually reaching 100.
 *
 * Once currentScore is already 100, both multipliers correctly evaluate to 0,
 * so the displayed score never exceeds the Radar's 0-100 cap — but we don't
 * want continued correct answers to just vanish into nothing, so any positive
 * event at the cap instead adds to `masteryPoint`, a separate counter that
 * keeps growing to reflect continued mastery without breaking the display cap.
 */
export function calculatePositiveSkillScore(
  current: SkillScoreState,
  baseDelta: number,
  skillWeight: number,
): ScoreCalculationResult {
  const currentScore = clamp(current.score, 0, 100);
  const isAtCap = currentScore >= 100;

  const diminishingMultiplier = 1 - currentScore / 100;
  const minimumGainMultiplier = isAtCap ? 0 : MINIMUM_GAIN_MULTIPLIER;
  const finalMultiplier = Math.max(diminishingMultiplier, minimumGainMultiplier);

  const adjustedDelta = baseDelta * skillWeight * finalMultiplier;
  const newScore = clamp(currentScore + adjustedDelta, 0, 100);
  const scoreDelta = round2(newScore - currentScore);

  // Score is capped, but keep rewarding continued correct answers as mastery
  // progress instead of silently discarding the signal.
  const masteryGain = isAtCap ? round2(baseDelta * skillWeight * MINIMUM_GAIN_MULTIPLIER) : 0;
  const newMasteryPoint = round2(current.masteryPoint + masteryGain);

  const newConfidence = clamp(current.confidence + POSITIVE_CONFIDENCE_GAIN, 0, 1);
  const confidenceDelta = round2(newConfidence - current.confidence);

  return {
    newScore: round2(newScore),
    newConfidence: round2(newConfidence),
    // Every positive event is reliable evidence, so evidenceCount always grows.
    newEvidenceCount: current.evidenceCount + 1,
    // A correct answer/lesson completion breaks any run of wrong answers.
    newWrongStreak: 0,
    newMasteryPoint,
    scoreDelta,
    confidenceDelta,
    reason: isAtCap
      ? `Score already at cap (100); recorded evidence and +${masteryGain} masteryPoint instead of further score gain`
      : `Diminishing-return gain: baseDelta=${baseDelta} x skillWeight=${skillWeight} x multiplier=${round2(finalMultiplier)} -> +${scoreDelta}`,
  };
}

/**
 * Wrong-answer scoring: QUIZ_WRONG only. Only use this for questions with a
 * clear, confirmed skill mapping (see recordQuizSkillScores/QuizQuestionSkill)
 * — never for free-text chat guesses, and never just for asking a question.
 *
 * --- Why the first mistake only lowers confidence, not score ---
 * One wrong answer is weak evidence on its own — the learner could have
 * misread the question, mis-clicked, or the question itself could be
 * ambiguous. Immediately punishing the displayed score for a single mistake
 * would make the Radar feel unfair and noisy. Instead, the first mistake only
 * lowers `confidence` (how sure we are the current score is right). Only once
 * the learner misses the SAME skill twice in a row (`wrongStreak >= 2`), or
 * the caller has flagged this as a repeat of an already-seen mistake
 * (`isRepeatedMistake`), do we treat it as strong enough evidence to actually
 * reduce the displayed score.
 *
 * --- Why evidenceCount protects against harsh drops ---
 * A learner with 80 pieces of evidence for a skill has proven it many times;
 * a single bad day of quizzes shouldn't crater a well-established score as
 * hard as it would for a learner with only 2 pieces of evidence.evidenceProtection
 * shrinks the penalty multiplier as evidenceCount grows, bottoming out at 0.25x
 * (never fully immune — repeated failure is still real signal).
 */
export function calculateWrongAnswerSkillScore(
  current: SkillScoreState,
  basePenalty: number,
  skillWeight: number,
  isRepeatedMistake: boolean,
): ScoreCalculationResult {
  const currentScore = clamp(current.score, 0, 100);
  const currentConfidence = clamp(current.confidence, 0, 1);

  const newWrongStreak = current.wrongStreak + 1;
  const shouldReduceScore = newWrongStreak >= 2 || isRepeatedMistake;

  const evidenceProtection = clamp(
    1 - current.evidenceCount / EVIDENCE_PROTECTION_DIVISOR,
    EVIDENCE_PROTECTION_MIN,
    EVIDENCE_PROTECTION_MAX,
  );
  const repeatedMistakeMultiplier = isRepeatedMistake ? REPEATED_MISTAKE_MULTIPLIER : 1;
  const streakMultiplier = clamp(
    newWrongStreak * STREAK_MULTIPLIER_PER_MISS,
    STREAK_MULTIPLIER_MIN,
    STREAK_MULTIPLIER_MAX,
  );

  const penalty = shouldReduceScore
    ? basePenalty * skillWeight * evidenceProtection * repeatedMistakeMultiplier * streakMultiplier
    : 0;

  const confidencePenalty = shouldReduceScore
    ? SCORE_REDUCING_CONFIDENCE_PENALTY
    : FIRST_MISTAKE_CONFIDENCE_PENALTY;

  const newScore = clamp(currentScore - penalty, 0, 100);
  const newConfidence = clamp(currentConfidence - confidencePenalty, 0, 1);

  const scoreDelta = round2(newScore - currentScore);
  const confidenceDelta = round2(newConfidence - currentConfidence);

  return {
    newScore: round2(newScore),
    newConfidence: round2(newConfidence),
    // A wrong answer on a skill-mapped question is still reliable evidence
    // of the learner's current level, so it still counts as evidence.
    newEvidenceCount: current.evidenceCount + 1,
    newWrongStreak,
    // Mastery progress is a positive-only counter; wrong answers don't touch it.
    newMasteryPoint: round2(current.masteryPoint),
    scoreDelta,
    confidenceDelta,
    reason: shouldReduceScore
      ? `Wrong streak=${newWrongStreak}${isRepeatedMistake ? " (repeated mistake)" : ""}: score penalty ${scoreDelta} (evidenceProtection=${round2(evidenceProtection)})`
      : `First mistake for this skill: confidence lowered by ${confidencePenalty}, score unchanged`,
  };
}

export interface CalculateSkillScoreInput {
  eventType: SkillEventType;
  current: SkillScoreState;
  skillWeight: number;
  /** Required for QUESTION / QUIZ_CORRECT / LESSON_COMPLETE. */
  baseDelta?: number;
  /** Required for QUIZ_WRONG. */
  basePenalty?: number;
  /** Required for QUIZ_WRONG — whether this is a repeat of an already-seen mistake. */
  isRepeatedMistake?: boolean;
}

/**
 * Single entry point that picks the right calculation based on eventType.
 * Callers (quiz submission, chat scoring, lesson completion) should go
 * through this function rather than calling the two calculators directly,
 * so the "which formula applies to which event" decision lives in one place.
 */
export function calculateSkillScore(input: CalculateSkillScoreInput): ScoreCalculationResult {
  if (POSITIVE_EVENT_TYPES.has(input.eventType)) {
    return calculatePositiveSkillScore(input.current, input.baseDelta ?? 0, input.skillWeight);
  }

  if (input.eventType === "QUIZ_WRONG") {
    return calculateWrongAnswerSkillScore(
      input.current,
      input.basePenalty ?? 0,
      input.skillWeight,
      input.isRepeatedMistake ?? false,
    );
  }

  throw new Error(`Unsupported skill event type: ${input.eventType}`);
}
