import {
  calculatePositiveSkillScore,
  calculateWrongAnswerSkillScore,
  calculateSkillScore,
  type SkillScoreState,
} from "./skill-score-calculator";

function makeState(overrides: Partial<SkillScoreState> = {}): SkillScoreState {
  return {
    score: 0,
    confidence: 0.5,
    evidenceCount: 0,
    wrongStreak: 0,
    masteryPoint: 0,
    ...overrides,
  };
}

describe("calculatePositiveSkillScore", () => {
  it("gives a large gain when the score is still low", () => {
    const result = calculatePositiveSkillScore(makeState({ score: 20 }), 8, 1);

    // diminishingMultiplier = 1 - 20/100 = 0.8 -> delta = 8 * 1 * 0.8 = 6.4
    expect(result.scoreDelta).toBe(6.4);
    expect(result.newScore).toBe(26.4);
  });

  it("gives a much smaller gain when the score is already high (diminishing return)", () => {
    const low = calculatePositiveSkillScore(makeState({ score: 20 }), 8, 1);
    const high = calculatePositiveSkillScore(makeState({ score: 90 }), 8, 1);

    expect(high.scoreDelta).toBeLessThan(low.scoreDelta);
    // diminishingMultiplier = 1 - 90/100 = 0.1 -> delta = 8 * 1 * 0.1 = 0.8
    expect(high.scoreDelta).toBe(0.8);
    expect(high.newScore).toBe(90.8);
  });

  it("applies the minimum-gain floor so score never feels stuck below 100", () => {
    // At score 96, raw diminishingMultiplier (0.04) is below the 0.1 floor,
    // so the floor should win.
    const result = calculatePositiveSkillScore(makeState({ score: 96 }), 8, 1);

    expect(result.scoreDelta).toBe(0.8); // 8 * 1 * 0.1
    expect(result.newScore).toBe(96.8);
  });

  it("never lets score exceed 100 and awards masteryPoint instead once capped", () => {
    const result = calculatePositiveSkillScore(makeState({ score: 100, masteryPoint: 5 }), 8, 1);

    expect(result.newScore).toBe(100);
    expect(result.scoreDelta).toBe(0);
    expect(result.newMasteryPoint).toBeGreaterThan(5);
    expect(result.reason).toContain("cap");
  });

  it("increments evidenceCount and resets wrongStreak on every positive event", () => {
    const result = calculatePositiveSkillScore(makeState({ evidenceCount: 3, wrongStreak: 2 }), 8, 1);

    expect(result.newEvidenceCount).toBe(4);
    expect(result.newWrongStreak).toBe(0);
  });

  it("increases confidence but never above 1", () => {
    const result = calculatePositiveSkillScore(makeState({ confidence: 0.98 }), 8, 1);

    expect(result.newConfidence).toBeLessThanOrEqual(1);
    expect(result.newConfidence).toBe(1);
  });

  it("scales the delta by skillWeight", () => {
    const base = calculatePositiveSkillScore(makeState({ score: 20 }), 8, 1);
    const weighted = calculatePositiveSkillScore(makeState({ score: 20 }), 8, 0.5);

    expect(weighted.scoreDelta).toBeCloseTo(base.scoreDelta / 2, 5);
  });
});

describe("calculateWrongAnswerSkillScore", () => {
  it("does not touch score on the first mistake, only lowers confidence", () => {
    const result = calculateWrongAnswerSkillScore(makeState({ score: 50, confidence: 0.6 }), 10, 1, false);

    expect(result.scoreDelta).toBe(0);
    expect(result.newScore).toBe(50);
    expect(result.confidenceDelta).toBeLessThan(0);
    expect(result.newWrongStreak).toBe(1);
    expect(result.reason).toContain("First mistake");
  });

  it("reduces score once the same skill is missed twice in a row", () => {
    const afterFirstMiss = calculateWrongAnswerSkillScore(makeState({ score: 50, confidence: 0.6 }), 10, 1, false);
    const stateAfterFirstMiss: SkillScoreState = {
      score: afterFirstMiss.newScore,
      confidence: afterFirstMiss.newConfidence,
      evidenceCount: afterFirstMiss.newEvidenceCount,
      wrongStreak: afterFirstMiss.newWrongStreak,
      masteryPoint: afterFirstMiss.newMasteryPoint,
    };

    const afterSecondMiss = calculateWrongAnswerSkillScore(stateAfterFirstMiss, 10, 1, false);

    expect(afterSecondMiss.newWrongStreak).toBe(2);
    expect(afterSecondMiss.scoreDelta).toBeLessThan(0);
    expect(afterSecondMiss.newScore).toBeLessThan(stateAfterFirstMiss.score);
  });

  it("reduces score immediately when the caller flags a repeated mistake, even on the first streak count", () => {
    const result = calculateWrongAnswerSkillScore(makeState({ score: 50 }), 10, 1, true);

    expect(result.newWrongStreak).toBe(1);
    expect(result.scoreDelta).toBeLessThan(0);
    expect(result.reason).toContain("repeated mistake");
  });

  it("applies a larger confidence penalty once the score itself is being reduced", () => {
    const firstMiss = calculateWrongAnswerSkillScore(makeState({ score: 50 }), 10, 1, false);
    const repeatedMiss = calculateWrongAnswerSkillScore(makeState({ score: 50 }), 10, 1, true);

    expect(Math.abs(repeatedMiss.confidenceDelta)).toBeGreaterThan(Math.abs(firstMiss.confidenceDelta));
  });

  it("protects learners with a lot of evidence from a harsh score drop", () => {
    const lowEvidence = calculateWrongAnswerSkillScore(
      makeState({ score: 50, wrongStreak: 1, evidenceCount: 2 }),
      10,
      1,
      false,
    );
    const highEvidence = calculateWrongAnswerSkillScore(
      makeState({ score: 50, wrongStreak: 1, evidenceCount: 90 }),
      10,
      1,
      false,
    );

    expect(Math.abs(highEvidence.scoreDelta)).toBeLessThan(Math.abs(lowEvidence.scoreDelta));
  });

  it("never drops the evidence-protection multiplier below the 0.25 floor even with huge evidenceCount", () => {
    const massiveEvidence = calculateWrongAnswerSkillScore(
      makeState({ score: 80, wrongStreak: 1, evidenceCount: 10000 }),
      10,
      1,
      false,
    );

    // basePenalty(10) * skillWeight(1) * evidenceProtection(0.25 floor) * repeatedMultiplier(1) * streakMultiplier(1 for wrongStreak=2)
    expect(massiveEvidence.scoreDelta).toBe(-2.5);
  });

  it("never lets score go below 0", () => {
    const result = calculateWrongAnswerSkillScore(makeState({ score: 1, wrongStreak: 3 }), 50, 1, true);

    expect(result.newScore).toBe(0);
  });

  it("never lets confidence go below 0", () => {
    const result = calculateWrongAnswerSkillScore(makeState({ score: 50, confidence: 0.01 }), 10, 1, true);

    expect(result.newConfidence).toBe(0);
  });

  it("still counts a wrong answer as evidence and never touches masteryPoint", () => {
    const result = calculateWrongAnswerSkillScore(makeState({ evidenceCount: 5, masteryPoint: 12 }), 10, 1, false);

    expect(result.newEvidenceCount).toBe(6);
    expect(result.newMasteryPoint).toBe(12);
  });
});

describe("calculateSkillScore (dispatcher)", () => {
  it.each<[import("./skill-score-calculator").SkillEventType]>([["QUESTION"], ["QUIZ_CORRECT"], ["LESSON_COMPLETE"]])(
    "routes %s to the positive calculator",
    (eventType) => {
      const result = calculateSkillScore({
        eventType,
        current: makeState({ score: 20 }),
        skillWeight: 1,
        baseDelta: 8,
      });

      expect(result.scoreDelta).toBeGreaterThan(0);
    },
  );

  it("routes QUIZ_WRONG to the wrong-answer calculator", () => {
    const result = calculateSkillScore({
      eventType: "QUIZ_WRONG",
      current: makeState({ score: 50, wrongStreak: 1 }),
      skillWeight: 1,
      basePenalty: 10,
      isRepeatedMistake: false,
    });

    expect(result.scoreDelta).toBeLessThanOrEqual(0);
  });
});
