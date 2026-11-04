import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 500;
const BATCH_SIZE = 100;
const MAX_SAVED_VALUE = 999_999;
const REQUEST_TIMEOUT = 15_000;

export interface RescueProgress {
  totalCompleted: number;
  goal: number;
}

interface SavedResult {
  level_index: number;
  best_moves: number;
}

export class FoxCloud {
  constructor(private client: SupabaseClient) {}

  async rescueProgress(): Promise<RescueProgress> {
    const { data, error } = await this.client.rpc('fox_rescue_progress').single();
    if (error) throw error;
    const result = data as { total_completed?: number; goal?: number } | null;
    if (!result || !Number.isSafeInteger(result.total_completed) || !Number.isSafeInteger(result.goal)
      || result.total_completed! < 0 || result.goal! < 1) throw new Error('Invalid rescue progress');
    return { totalCompleted: result.total_completed!, goal: result.goal! };
  }

  async signIn(): Promise<void> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    if (data.session) return;
    const result = await this.client.auth.signInAnonymously();
    if (result.error) throw result.error;
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
