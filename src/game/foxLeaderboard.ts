import type { FoxCloud, LeaderboardEntry } from './foxCloud';

const element = <ElementType extends HTMLElement>(id: string): ElementType => document.getElementById(id) as ElementType;
const invalidNickname = /[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

export class FoxLeaderboard {
  private dialog = element<HTMLDialogElement>('fox-leaderboard');
  private opener = element<HTMLButtonElement>('fox-ranking-open');
  private closeButton = element<HTMLButtonElement>('fox-ranking-close');
  private results = element<HTMLElement>('fox-ranking-results');
  private message = element<HTMLParagraphElement>('fox-ranking-message');
  private table = element<HTMLDivElement>('fox-ranking-table');
  private list = element<HTMLOListElement>('fox-ranking-list');
  private ownPosition = element<HTMLOListElement>('fox-ranking-own');
  private retry = element<HTMLButtonElement>('fox-ranking-retry');
  private form = element<HTMLFormElement>('fox-ranking-form');
  private nicknameInput = element<HTMLInputElement>('fox-ranking-nickname');
  private saveButton = element<HTMLButtonElement>('fox-ranking-save');
  private removeButton = element<HTMLButtonElement>('fox-ranking-remove');
  private formStatus = element<HTMLParagraphElement>('fox-ranking-form-status');
  private cloud: FoxCloud | null = null;
  private nickname: string | null = null;
  private loadVersion = 0;
  private scoresVersion = 0;
  private saving = false;
  private refreshPending = false;

  constructor(private getCloud: () => Promise<FoxCloud | null>) {
    this.opener.addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => {
      this.loadVersion += 1;
      this.scoresVersion += 1;
      this.opener.focus({ preventScroll: true });
    });
    this.retry.addEventListener('click', () => { void this.load(); });
    this.form.addEventListener('submit', (event) => { void this.save(event); });
    this.removeButton.addEventListener('click', () => { void this.remove(); });
  }

  refreshScores(): void {
    if (!this.dialog.open) return;
    if (!this.cloud || this.form.hidden || this.saving) {
      this.refreshPending = true;
      return;
    }
    void this.loadScores();
  }

  private open(): void {
    if (this.dialog.open) return;
    this.dialog.showModal();
    this.closeButton.focus();
    void this.load();
  }

  private async load(): Promise<void> {
    const version = ++this.loadVersion;
    const scoresVersion = ++this.scoresVersion;
    this.results.setAttribute('aria-busy', 'true');
    this.message.textContent = 'Łączymy z rankingiem…';
    this.table.hidden = true;
    this.retry.hidden = true;
    this.form.hidden = true;
    this.formStatus.textContent = '';
    try {
      const cloud = await this.getCloud();
      if (!cloud) throw new Error('Cloud is unavailable');
      this.cloud = cloud;
      await cloud.signIn();
      const [nickname, scores] = await Promise.all([cloud.leaderboardNickname(), cloud.leaderboard()]);
      if (!this.dialog.open || version !== this.loadVersion) return;
      this.nickname = nickname;
      this.updateForm();
      this.form.hidden = false;
      this.showScores(scores);
      if (this.refreshPending && !this.saving) {
        this.refreshPending = false;
        void this.loadScores();
      }
    } catch (error) {
      if (!this.dialog.open || version !== this.loadVersion) return;
      this.message.textContent = this.unavailableMessage(error);
      this.retry.hidden = false;
      console.warn('Fox leaderboard is unavailable:', error);
    } finally {
      if (this.dialog.open && version === this.loadVersion && scoresVersion === this.scoresVersion) {
        this.results.setAttribute('aria-busy', 'false');
      }
    }
  }

  private async loadScores(): Promise<void> {
    const cloud = this.cloud;
    if (!cloud) return;
    const version = ++this.scoresVersion;
    this.results.setAttribute('aria-busy', 'true');
    try {
      const scores = await cloud.leaderboard();
      if (!this.dialog.open || version !== this.scoresVersion) return;
      this.showScores(scores);
      this.retry.hidden = true;
    } catch (error) {
      if (!this.dialog.open || version !== this.scoresVersion) return;
      this.message.textContent = this.unavailableMessage(error);
      this.retry.hidden = false;
      console.warn('Fox leaderboard refresh failed:', error);
    } finally {
      if (this.dialog.open && version === this.scoresVersion) this.results.setAttribute('aria-busy', 'false');
    }
  }

  private showScores(scores: LeaderboardEntry[]): void {
    this.list.replaceChildren();
    this.ownPosition.replaceChildren();
    scores.forEach((score) => {
      const separate = score.isCurrent && score.place > 25;
      const row = document.createElement('li');
      row.classList.toggle('is-current', score.isCurrent);
      row.classList.toggle('is-separated', separate);
      row.setAttribute('aria-label', `Miejsce ${score.place}, ${score.nickname}, ${score.completedLevels} plansz, ${score.totalMoves} najlepszych ruchów łącznie${score.isCurrent ? ', Twój wynik' : ''}`);
      const place = document.createElement('span');
      place.textContent = String(score.place);
      const name = document.createElement('strong');
      name.textContent = score.nickname;
      if (score.isCurrent) {
        const label = document.createElement('small');
        label.textContent = ' · TY';
        name.append(label);
      }
      const levels = document.createElement('span');
      levels.textContent = score.completedLevels.toLocaleString('pl-PL');
      const moves = document.createElement('span');
      moves.textContent = score.totalMoves.toLocaleString('pl-PL');
      row.append(place, name, levels, moves);
      (separate ? this.ownPosition : this.list).append(row);
    });
    this.ownPosition.hidden = this.ownPosition.childElementCount === 0;
    this.message.textContent = scores.length ? '' : 'Jeszcze nikogo tu nie ma. Dołącz jako pierwszy!';
    this.table.hidden = scores.length === 0;
  }

  private async save(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.cloud || this.saving) return;
    const nickname = this.nicknameInput.value.trim();
    const length = Array.from(nickname).length;
    if (length < 2 || length > 24 || invalidNickname.test(nickname)) {
      this.formStatus.textContent = 'Nick musi mieć 2–24 znaki, bez znaków sterujących.';
      this.nicknameInput.focus();
      return;
    }
    const version = this.loadVersion;
    this.setSaving(true);
    this.formStatus.textContent = 'Zapisujemy…';
    try {
      const saved = await this.cloud.setLeaderboardNickname(nickname);
      if (!this.dialog.open || version !== this.loadVersion) {
        if (this.dialog.open) void this.load();
        return;
      }
      this.nickname = saved;
      this.updateForm();
      this.formStatus.textContent = 'Jesteś w rankingu!';
      this.refreshPending = true;
    } catch (error) {
      if (this.dialog.open && version === this.loadVersion) this.formStatus.textContent = 'Nie udało się zapisać nicku. Spróbuj ponownie.';
      console.warn('Could not save fox leaderboard nickname:', error);
    } finally {
      this.finishSaving();
    }
  }

  private async remove(): Promise<void> {
    if (!this.cloud || this.saving) return;
    const version = this.loadVersion;
    this.setSaving(true);
    this.formStatus.textContent = 'Usuwamy z rankingu…';
    try {
      await this.cloud.removeLeaderboardNickname();
      if (!this.dialog.open || version !== this.loadVersion) {
        if (this.dialog.open) void this.load();
        return;
      }
      this.nickname = null;
      this.updateForm();
      this.list.querySelector('.is-current')?.remove();
      this.ownPosition.replaceChildren();
      this.ownPosition.hidden = true;
      if (!this.list.childElementCount) {
        this.table.hidden = true;
        this.message.textContent = 'Jeszcze nikogo tu nie ma. Dołącz jako pierwszy!';
      }
      this.formStatus.textContent = 'Usunięto z rankingu. Twój postęp w grze pozostaje zapisany.';
      this.refreshPending = true;
    } catch (error) {
      if (this.dialog.open && version === this.loadVersion) this.formStatus.textContent = 'Nie udało się usunąć nicku. Spróbuj ponownie.';
      console.warn('Could not remove fox leaderboard nickname:', error);
    } finally {
      this.finishSaving();
    }
  }

  private updateForm(): void {
    this.nicknameInput.value = this.nickname ?? '';
    this.saveButton.textContent = this.nickname ? 'Zapisz' : 'Dołącz';
    this.removeButton.hidden = !this.nickname;
    this.setSaving(this.saving);
  }

  private setSaving(saving: boolean): void {
    this.saving = saving;
    this.nicknameInput.disabled = saving;
    this.saveButton.disabled = saving;
    this.removeButton.disabled = saving;
  }

  private finishSaving(): void {
    this.setSaving(false);
    if (this.refreshPending) {
      this.refreshPending = false;
      this.refreshScores();
    }
  }

  private unavailableMessage(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    return code === 'PGRST202' || code === '42883' || code === '42P01'
      ? 'Ranking nie jest jeszcze skonfigurowany. Spróbuj później.'
      : 'Ranking jest chwilowo niedostępny. Możesz grać dalej.';
  }
}
