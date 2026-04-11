/**
 * Run statistics tracker — stores history and calculates personal bests.
 * Drives "beat your best" replayability.
 */

export interface RunRecord {
  score: number;
  distance: number;
  maxCombo: number;
  closeCallCount: number;
  topSpeed: number;
  biomeIndex: number;
  grade: string;
  timestamp: number;
}

const STORAGE_KEY = "shatterDriftRunHistory";
const MAX_HISTORY = 50; // keep last 50 runs

export class RunHistoryTracker {
  private history: RunRecord[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.history = JSON.parse(raw);
      }
    } catch {
      this.history = [];
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      // Storage full — trim old entries
      this.history = this.history.slice(-20);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history)); } catch {}
    }
  }

  /** Record a completed run */
  recordRun(run: RunRecord): RunComparison {
    const comparison = this.compare(run);
    this.history.push(run);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
    this.save();
    return comparison;
  }

  /** Compare a run against history */
  private compare(run: RunRecord): RunComparison {
    if (this.history.length === 0) {
      return {
        isFirstRun: true,
        newBestScore: true,
        newBestDistance: true,
        newBestCombo: true,
        newBestSpeed: true,
        newBestBiome: true,
        improvementPct: 0,
        previousBest: null,
        averageScore: 0,
        runNumber: 1,
        bestStreak: 0,
      };
    }

    const bestScore = Math.max(...this.history.map(r => r.score));
    const bestDistance = Math.max(...this.history.map(r => r.distance));
    const bestCombo = Math.max(...this.history.map(r => r.maxCombo));
    const bestSpeed = Math.max(...this.history.map(r => r.topSpeed));
    const bestBiome = Math.max(...this.history.map(r => r.biomeIndex));
    const avgScore = this.history.reduce((s, r) => s + r.score, 0) / this.history.length;

    // Count how many consecutive runs improved
    let bestStreak = 0;
    for (let i = this.history.length - 1; i > 0; i--) {
      if (this.history[i].score > this.history[i - 1].score) {
        bestStreak++;
      } else break;
    }

    return {
      isFirstRun: false,
      newBestScore: run.score > bestScore,
      newBestDistance: run.distance > bestDistance,
      newBestCombo: run.maxCombo > bestCombo,
      newBestSpeed: run.topSpeed > bestSpeed,
      newBestBiome: run.biomeIndex > bestBiome,
      improvementPct: bestScore > 0 ? Math.round(((run.score - bestScore) / bestScore) * 100) : 0,
      previousBest: bestScore,
      averageScore: Math.round(avgScore),
      runNumber: this.history.length + 1,
      bestStreak: run.score > (this.history[this.history.length - 1]?.score || 0) ? bestStreak + 1 : 0,
    };
  }

  /** Get summary stats for display */
  getSummary(): RunSummary {
    if (this.history.length === 0) {
      return { totalRuns: 0, bestScore: 0, bestDistance: 0, avgScore: 0, bestGrade: "—", recentTrend: "neutral" };
    }

    const bestScore = Math.max(...this.history.map(r => r.score));
    const bestDistance = Math.max(...this.history.map(r => r.distance));
    const avgScore = Math.round(this.history.reduce((s, r) => s + r.score, 0) / this.history.length);
    const gradeRanks = ["E RANK", "D RANK", "C RANK", "B RANK", "A RANK", "S RANK"];
    const bestGradeIdx = Math.max(...this.history.map(r => gradeRanks.indexOf(r.grade)));
    const bestGrade = bestGradeIdx >= 0 ? gradeRanks[bestGradeIdx] : "—";

    // Recent trend: compare last 5 runs avg vs prior 5
    let recentTrend: "up" | "down" | "neutral" = "neutral";
    if (this.history.length >= 6) {
      const recent5 = this.history.slice(-5).reduce((s, r) => s + r.score, 0) / 5;
      const prior5 = this.history.slice(-10, -5).reduce((s, r) => s + r.score, 0) / Math.min(5, this.history.slice(-10, -5).length);
      if (recent5 > prior5 * 1.1) recentTrend = "up";
      else if (recent5 < prior5 * 0.9) recentTrend = "down";
    }

    return { totalRuns: this.history.length, bestScore, bestDistance, avgScore, bestGrade, recentTrend };
  }
}

export interface RunComparison {
  isFirstRun: boolean;
  newBestScore: boolean;
  newBestDistance: boolean;
  newBestCombo: boolean;
  newBestSpeed: boolean;
  newBestBiome: boolean;
  improvementPct: number;
  previousBest: number | null;
  averageScore: number;
  runNumber: number;
  bestStreak: number;
}

export interface RunSummary {
  totalRuns: number;
  bestScore: number;
  bestDistance: number;
  avgScore: number;
  bestGrade: string;
  recentTrend: "up" | "down" | "neutral";
}
