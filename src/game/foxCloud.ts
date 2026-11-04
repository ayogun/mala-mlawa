import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 500;
const BATCH_SIZE = 100;
const MAX_SAVED_VALUE = 999_999;
const REQUEST_TIMEOUT = 15_000;

export interface RescueProgress {
  totalCompleted: number;
  goal: number;
}

export interface LeaderboardEntry {
  place: number;
  nickname: string;
  completedLevels: number;
  totalMoves: number;
  isCurrent: boolean;
}

interface SavedResult {
  level_index: number;
  best_moves: number;
}

export class FoxCloud {
  private signInPromise: Promise<void> | null = null;

  constructor(private client: SupabaseClient) {}

  async rescueProgress(): Promise<RescueProgress> {
    const { data, error } = await this.client.rpc('fox_rescue_progress').single();
    if (error) throw error;
    const result = data as { total_completed?: number; goal?: number } | null;
    if (!result || !Number.isSafeInteger(result.total_completed) || !Number.isSafeInteger(result.goal)
      || result.total_completed! < 0 || result.goal! < 1) throw new Error('Invalid rescue progress');
    return { totalCompleted: result.total_completed!, goal: result.goal! };
  }

  signIn(): Promise<void> {
    if (!this.signInPromise) {
      this.signInPromise = this.ensureSession().finally(() => { this.signInPromise = null; });
    }
    return this.signInPromise;
  }

  private async ensureSession(): Promise<void> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    if (data.session) return;
    const result = await this.client.auth.signInAnonymously();
    if (result.error) throw result.error;
  }

  async leaderboard(): Promise<LeaderboardEntry[]> {
    const { data, error } = await this.client.rpc('fox_leaderboard', { p_limit: 25 });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid leaderboard');
    return data.map((entry: Record<string, unknown>) => {
      if (!Number.isSafeInteger(entry.place) || (entry.place as number) < 1
        || typeof entry.nickname !== 'string'
        || !Number.isSafeInteger(entry.completed_levels) || (entry.completed_levels as number) < 0
        || !Number.isSafeInteger(entry.total_moves) || (entry.total_moves as number) < 0
        || typeof entry.is_current !== 'boolean') throw new Error('Invalid leaderboard entry');
      return {
        place: entry.place as number,
        nickname: entry.nickname,
        completedLevels: entry.completed_levels as number,
        totalMoves: entry.total_moves as number,
        isCurrent: entry.is_current,
      };
    });
  }

  async leaderboardNickname(): Promise<string | null> {
    const { data, error } = await this.client.rpc('fox_leaderboard_nickname');
    if (error) throw error;
    if (data !== null && typeof data !== 'string') throw new Error('Invalid leaderboard nickname');
    return data;
  }

  async setLeaderboardNickname(nickname: string): Promise<string> {
    const { data, error } = await this.client.rpc('fox_set_leaderboard_nickname', { p_nickname: nickname });
    if (error) throw error;
    if (typeof data !== 'string') throw new Error('Invalid leaderboard nickname');
    return data;
  }

  async removeLeaderboardNickname(): Promise<void> {
    const { error } = await this.client.rpc('fox_remove_leaderboard_nickname');
    if (error) throw error;
  }

  async playerResults(): Promise<Map<number, number>> {
    const results = new Map<number, number>();
    let afterLevel = -1;
    for (;;) {
      const { data, error } = await this.client.from('fox_level_results')
        .select('level_index, best_moves')
        .gt('level_index', afterLevel)
        .order('level_index')
        .limit(PAGE_SIZE);
      if (error) throw error;
      const page = data as SavedResult[];
      if (page.length === 0) break;
      page.forEach(({ level_index: levelIndex, best_moves: bestMoves }) => {
        results.set(levelIndex, bestMoves);
      });
      afterLevel = page[page.length - 1].level_index;
    }
    return results;
  }

  async recordResults(results: Map<number, number>, saved: Map<number, number>, completed: number): Promise<void> {
    const pending: SavedResult[] = [...results]
      .filter(([levelIndex, moves]) => levelIndex < completed && levelIndex <= MAX_SAVED_VALUE
        && moves <= MAX_SAVED_VALUE && (saved.get(levelIndex) === undefined || moves < saved.get(levelIndex)!))
      .sort(([first], [second]) => first - second)
      .map(([level_index, best_moves]) => ({ level_index, best_moves }));

    for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
      const { error } = await this.client.rpc('fox_record_results', { p_results: pending.slice(offset, offset + BATCH_SIZE) });
      if (error) throw error;
    }
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function createFoxCloud(): Promise<FoxCloud | null> {
  const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!projectUrl || !publishableKey) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    return new FoxCloud(createClient(projectUrl, publishableKey, { global: { fetch: fetchWithTimeout } }));
  } catch (error) {
    console.warn('Fox cloud connection is unavailable:', error);
    return null;
  }
}
