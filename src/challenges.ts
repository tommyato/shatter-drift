/**
 * Challenge / Achievement system — persistent mini-objectives
 * that drive replayability. Each challenge has a condition,
 * and completing it unlocks a cosmetic reward.
 */

export interface Challenge {
  id: string;
  name: string;
  description: string;
  /** Reward: trail color, crystal skin, or title */
  reward: { type: "trail" | "crystal" | "title"; value: string };
  /** Whether the challenge is completed */
  completed: boolean;
  /** Progress toward completion (0-1) */
  progress: number;
  /** Maximum value for progress tracking */
  target: number;
  /** Category for grouping */
  category: "distance" | "score" | "skill" | "mastery";
}

const CHALLENGE_DEFS: Omit<Challenge, "completed" | "progress">[] = [
  // Distance challenges
  {
    id: "first_500",
    name: "First Steps",
    description: "Reach 500m",
    reward: { type: "trail", value: "cyan" },
    target: 500,
    category: "distance",
  },
  {
    id: "reach_1000",
    name: "Into the Deep",
    description: "Reach 1000m",
    reward: { type: "trail", value: "emerald" },
    target: 1000,
    category: "distance",
  },
  {
    id: "reach_2000",
    name: "Beyond the Rift",
    description: "Reach 2000m",
    reward: { type: "crystal", value: "prism" },
    target: 2000,
    category: "distance",
  },
  {
    id: "reach_3000",
    name: "Event Horizon",
    description: "Reach 3000m",
    reward: { type: "trail", value: "rainbow" },
    target: 3000,
    category: "distance",
  },
  // Score challenges
  {
    id: "score_10k",
    name: "Warming Up",
    description: "Score 10,000 points",
    reward: { type: "trail", value: "gold" },
    target: 10000,
    category: "score",
  },
  {
    id: "score_50k",
    name: "Point Master",
    description: "Score 50,000 points",
    reward: { type: "crystal", value: "flame" },
    target: 50000,
    category: "score",
  },
  {
    id: "score_100k",
    name: "Legendary",
    description: "Score 100,000 points",
    reward: { type: "trail", value: "plasma" },
    target: 100000,
    category: "score",
  },
  // Skill challenges
  {
    id: "streak_5",
    name: "Phantom",
    description: "Get a 5x phase streak",
    reward: { type: "trail", value: "ghost" },
    target: 5,
    category: "skill",
  },
  {
    id: "streak_10",
    name: "Untouchable",
    description: "Get a 10x phase streak",
    reward: { type: "crystal", value: "phantom" },
    target: 10,
    category: "skill",
  },
  {
    id: "combo_10",
    name: "Perfect Chain",
    description: "Reach 10x combo",
    reward: { type: "trail", value: "electric" },
    target: 10,
    category: "skill",
  },
  {
    id: "close_calls_20",
    name: "Daredevil",
    description: "20 close calls in one run",
    reward: { type: "crystal", value: "blaze" },
    target: 20,
    category: "skill",
  },
  {
    id: "no_phase_500",
    name: "Solid State",
    description: "Reach 500m without phasing",
    reward: { type: "trail", value: "diamond" },
    target: 500,
    category: "skill",
  },
  // Mastery challenges
  {
    id: "all_biomes",
    name: "World Tourist",
    description: "Visit all 5 biomes",
    reward: { type: "crystal", value: "aurora" },
    target: 5,
    category: "mastery",
  },
  {
    id: "s_rank",
    name: "S-Tier",
    description: "Achieve S rank",
    reward: { type: "trail", value: "supernova" },
    target: 1,
    category: "mastery",
  },
  {
    id: "speed_40",
    name: "Lightspeed",
    description: "Reach 40 m/s",
    reward: { type: "trail", value: "warp" },
    target: 40,
    category: "mastery",
  },
  {
    id: "total_runs_10",
    name: "Persistent",
    description: "Complete 10 runs",
    reward: { type: "crystal", value: "veteran" },
    target: 10,
    category: "mastery",
  },
];

export class ChallengeManager {
  challenges: Challenge[] = [];
  private newCompletions: Challenge[] = [];
  private noPhaseDistance = 0;
  private hasPhased = false;

  constructor() {
    this.loadProgress();
  }

  private loadProgress() {
    const saved = localStorage.getItem("shatterDriftChallenges");
    const completedIds: Set<string> = new Set();
    if (saved) {
      try {
        const data = JSON.parse(saved) as { id: string; progress: number; completed: boolean }[];
        for (const entry of data) {
          completedIds.add(entry.id);
        }
      } catch (e) {
        // ignore
      }
    }

    this.challenges = CHALLENGE_DEFS.map((def) => {
      const savedData = saved ? JSON.parse(saved).find((s: any) => s.id === def.id) : null;
      return {
        ...def,
        completed: savedData?.completed ?? false,
        progress: savedData?.progress ?? 0,
      };
    });
  }

  private saveProgress() {
    const data = this.challenges.map((c) => ({
      id: c.id,
      progress: c.progress,
      completed: c.completed,
    }));
    localStorage.setItem("shatterDriftChallenges", JSON.stringify(data));
  }

  /** Called at the start of each run */
  resetRun() {
    this.newCompletions = [];
    this.noPhaseDistance = 0;
    this.hasPhased = false;
  }

  /** Update challenge progress mid-run */
  updateRun(stats: {
    distance: number;
    score: number;
    phaseStreak: number;
    maxCombo: number;
    closeCallCount: number;
    biomeIndex: number;
    speed: number;
    isPhasing: boolean;
  }) {
    // Track no-phase distance
    if (stats.isPhasing) {
      this.hasPhased = true;
    }
    if (!this.hasPhased) {
      this.noPhaseDistance = stats.distance;
    }

    this.updateChallenge("first_500", stats.distance);
    this.updateChallenge("reach_1000", stats.distance);
    this.updateChallenge("reach_2000", stats.distance);
    this.updateChallenge("reach_3000", stats.distance);
    this.updateChallenge("score_10k", stats.score);
    this.updateChallenge("score_50k", stats.score);
    this.updateChallenge("score_100k", stats.score);
    this.updateChallenge("streak_5", stats.phaseStreak);
    this.updateChallenge("streak_10", stats.phaseStreak);
    this.updateChallenge("combo_10", stats.maxCombo);
    this.updateChallenge("close_calls_20", stats.closeCallCount);
    this.updateChallenge("no_phase_500", this.noPhaseDistance);
    this.updateChallenge("all_biomes", stats.biomeIndex + 1);
    this.updateChallenge("speed_40", stats.speed);
  }

  /** Call at end of run with final stats */
  endRun(totalRuns: number, gotSRank: boolean) {
    this.updateChallenge("total_runs_10", totalRuns);
    if (gotSRank) {
      this.updateChallenge("s_rank", 1);
    }
    this.saveProgress();
  }

  private updateChallenge(id: string, value: number) {
    const challenge = this.challenges.find((c) => c.id === id);
    if (!challenge || challenge.completed) return;

    challenge.progress = Math.max(challenge.progress, value);
    if (challenge.progress >= challenge.target) {
      challenge.completed = true;
      this.newCompletions.push(challenge);
    }
  }

  /** Get newly completed challenges this run (for announcements) */
  popCompletions(): Challenge[] {
    const completions = [...this.newCompletions];
    this.newCompletions = [];
    return completions;
  }

  /** Get all unlocked rewards */
  getUnlockedRewards(): { type: string; value: string }[] {
    return this.challenges
      .filter((c) => c.completed)
      .map((c) => c.reward);
  }

  /** Get completion stats */
  getStats(): { completed: number; total: number } {
    return {
      completed: this.challenges.filter((c) => c.completed).length,
      total: this.challenges.length,
    };
  }
}
