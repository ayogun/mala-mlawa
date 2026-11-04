import { Quaternion } from 'three';
import { BoardRenderer, fallEdge, turnFor, turnPivot, type FallEdge } from './board';
import { createFoxCloud, type FoxCloud, type RescueProgress } from './foxCloud';
import { FoxLeaderboard } from './foxLeaderboard';
import { getLevel, getLevelName } from './generatedLevels';
import { isGoal, moveBlock, startingPosition, type BlockPosition, type Direction } from './logic';
import { createScoreImage, downloadScoreImage, type ScoreImage } from './scoreShare';

const STORAGE_KEY = 'mala-mlawa-fox-game-v2';
const LEGACY_STORAGE_KEY = 'mala-mlawa-fox-game-v1';
const LEVELS_PER_PAGE = 5;
const RESCUE_REFRESH_INTERVAL = 60_000;

type Phase = 'playing' | 'rolling' | 'falling' | 'celebrating' | 'failed' | 'won';
type RescueStatus = 'loading' | 'ready' | 'offline';
type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline';

interface Snapshot {
  position: BlockPosition;
  rotation: Quaternion;
  moves: number;
  bridgesOpen: boolean;
}

interface PointerStart {
  horizontal: number;
  vertical: number;
  id: number;
}

const element = <ElementType extends HTMLElement>(id: string): ElementType => document.getElementById(id) as ElementType;

export class FoxGame {
  private dialog = element<HTMLDialogElement>('fox-game');
  private opener = element<HTMLButtonElement>('btn-fox-game');
  private mapScene = element<HTMLButtonElement>('fox-map-scene');
  private lastOpener: HTMLButtonElement | null = null;
  private closeButton = element<HTMLButtonElement>('fox-close');
  private help = element<HTMLDetailsElement>('fox-help');
  private svg = document.getElementById('fox-board') as unknown as SVGSVGElement;
  private result = element<HTMLDivElement>('fox-result');
  private resultIcon = element<HTMLSpanElement>('fox-result-icon');
  private resultTitle = element<HTMLElement>('fox-result-title');
  private resultText = element<HTMLParagraphElement>('fox-result-text');
  private resultPrimary = element<HTMLButtonElement>('fox-result-primary');
  private resultSecondary = element<HTMLButtonElement>('fox-result-secondary');
  private resultShare = element<HTMLButtonElement>('fox-result-share');
  private resultDownload = element<HTMLButtonElement>('fox-result-download');
  private shareStatus = element<HTMLParagraphElement>('fox-share-status');
  private undoButton = element<HTMLButtonElement>('fox-undo');
  private restartButton = element<HTMLButtonElement>('fox-restart');
  private previousLevelsButton = element<HTMLButtonElement>('fox-levels-previous');
  private nextLevelsButton = element<HTMLButtonElement>('fox-levels-next');
  private levelButtons: HTMLButtonElement[] = [];
  private board: BoardRenderer;
  private levelIndex = 0;
  private levelPageStart = 0;
  private level = getLevel(0);
  private position = startingPosition(this.level);
  private rotation = new Quaternion();
  private moves = 0;
  private bridgesOpen = false;
  private phase: Phase = 'playing';
  private history: Snapshot[] = [];
  private best = new Map<number, number>();
  private storageAvailable = true;
  private cloud: FoxCloud | null = null;
  private cloudReady: Promise<FoxCloud | null>;
  private leaderboard: FoxLeaderboard;
  private rescueProgress: RescueProgress | null = null;
  private rescueStatus: RescueStatus = 'loading';
  private syncStatus: SyncStatus = 'local';
  private syncStarted = false;
  private syncRequested = false;
  private syncing = false;
  private rescueRequest = 0;
  private animationFrame: number | null = null;
  private pointerStart: PointerStart | null = null;
  private shareImage: ScoreImage | null = null;
  private shareVersion = 0;

  constructor() {
    this.loadProgress();
    this.levelIndex = this.completedLevels();
    this.level = getLevel(this.levelIndex);
    this.position = startingPosition(this.level);
    this.levelPageStart = Math.floor(this.levelIndex / LEVELS_PER_PAGE) * LEVELS_PER_PAGE;
    this.board = new BoardRenderer(this.svg, this.level);
    this.createLevelButtons();
    this.board.render(this.position, this.rotation);
    this.updateHud();

    this.opener.addEventListener('click', () => this.open(this.opener));
    this.mapScene.addEventListener('click', () => this.open(this.mapScene));
    this.closeButton.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.onClose());
    this.dialog.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.undoButton.addEventListener('click', () => this.undo());
    this.restartButton.addEventListener('click', () => this.startLevel(this.levelIndex));
    this.resultShare.addEventListener('click', () => this.shareResult());
    this.resultDownload.addEventListener('click', () => this.downloadResult());
    this.previousLevelsButton.addEventListener('click', () => this.changeLevelPage(-1));
    this.nextLevelsButton.addEventListener('click', () => this.changeLevelPage(1));
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-fox-direction]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = button.dataset.foxDirection;
        if (direction === 'up' || direction === 'right' || direction === 'down' || direction === 'left') this.move(direction);
      });
    });
    this.svg.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.svg.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.svg.addEventListener('pointercancel', () => { this.pointerStart = null; });
    window.addEventListener('storage', (event) => {
      if ((event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) || !event.newValue) return;
      this.readSavedProgress(event.newValue);
      this.requestSync();
      this.updateHud();
    });

    this.cloudReady = this.connectCloud();
    this.leaderboard = new FoxLeaderboard(() => this.cloudReady);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  private open(opener: HTMLButtonElement): void {
    if (this.dialog.open) return;
    this.lastOpener = opener;
    this.dialog.showModal();
    this.closeButton.focus();
    this.syncStarted = true;
    this.requestSync();
    void this.refreshRescue();
  }

  private onClose(): void {
    if (this.phase === 'rolling' || this.phase === 'falling' || this.phase === 'celebrating') {
      this.stopAnimation();
      this.restoreLastMove();
    }
    this.pointerStart = null;
    this.help.open = false;
    (this.lastOpener && !this.lastOpener.hidden ? this.lastOpener : this.opener).focus();
  }

  private createLevelButtons(): void {
    const container = element<HTMLDivElement>('fox-levels');
    this.levelButtons = Array.from({ length: LEVELS_PER_PAGE }, (_, offset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => {
        const index = this.levelPageStart + offset;
        if (index !== this.levelIndex || this.phase !== 'playing') this.startLevel(index);
      });
      container.append(button);
      return button;
    });
  }

  private changeLevelPage(direction: -1 | 1): void {
    const lastPage = Math.floor(this.completedLevels() / LEVELS_PER_PAGE) * LEVELS_PER_PAGE;
    const nextPage = Math.max(0, Math.min(lastPage, this.levelPageStart + direction * LEVELS_PER_PAGE));
    if (nextPage === this.levelPageStart) return;
    this.levelPageStart = nextPage;
    this.updateHud();
    const lastVisible = Math.min(this.levelPageStart + LEVELS_PER_PAGE, this.completedLevels() + 1);
    this.announce(`Plansze od ${this.levelPageStart + 1} do ${lastVisible}.`);
  }

  private startLevel(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.completedLevels()) return;
    const focusWasInResult = this.result.contains(document.activeElement);
    this.stopAnimation();
    this.levelIndex = index;
    this.levelPageStart = Math.floor(index / LEVELS_PER_PAGE) * LEVELS_PER_PAGE;
    this.level = getLevel(index);
    this.position = startingPosition(this.level);
    this.rotation = new Quaternion();
    this.moves = 0;
    this.bridgesOpen = false;
    this.history = [];
    this.phase = 'playing';
    this.result.hidden = true;
    this.hideShare();
    this.board.setLevel(this.level);
    this.board.render(this.position, this.rotation);
    this.updateHud();
    this.announce(`Plansza ${index + 1}: ${this.level.name}. Postaw prezent pionowo na polu z łapką.`);
    if (focusWasInResult) this.focusDirections();
  }

  private move(direction: Direction): void {
    if (this.phase !== 'playing') return;
    const before: Snapshot = { position: { ...this.position }, rotation: this.rotation.clone(), moves: this.moves, bridgesOpen: this.bridgesOpen };
    const outcome = moveBlock(this.level, before.position, direction, before.bridgesOpen);
    const destination = outcome.position;
    const pivot = turnPivot(before.position, direction);
    this.history.push(before);
    this.moves += 1;
    this.phase = 'rolling';
    this.updateHud();

    this.animate(220, (progress) => {
      const eased = progress * progress * (3 - 2 * progress);
      this.board.render(before.position, before.rotation, { pivot, rotation: turnFor(direction, eased * Math.PI / 2) });
    }, () => {
      this.position = destination;
      this.rotation = turnFor(direction, Math.PI / 2).multiply(before.rotation).normalize();
      this.bridgesOpen = outcome.bridgesOpen;
      if (outcome.switchPressed) this.board.setBridgesOpen(this.bridgesOpen);
      if (!outcome.supported) this.drop(fallEdge(this.level, before.position, destination, direction, this.bridgesOpen));
      else if (isGoal(this.level, destination)) this.celebrate();
      else {
        this.phase = 'playing';
        this.board.render(this.position, this.rotation);
        this.updateHud();
        const posture = this.position.axis === 'upright' ? 'stoi pionowo' : 'leży';
        const bridge = outcome.switchPressed ? ` Most ${this.bridgesOpen ? 'otwarty' : 'zamknięty'}.` : '';
        this.announce(`Ruch ${this.moves}. Prezent ${posture}, kolumna ${this.position.column + 1}, rząd ${this.position.row + 1}.${bridge}`);
      }
    });
  }

  private drop(edge: FallEdge): void {
    this.phase = 'falling';
    this.updateHud();
    this.animate(560, (progress) => {
      const tilt = progress * progress * Math.PI * 0.55;
      const freeFall = Math.max(0, (progress - 0.35) / 0.65);
      this.board.render(this.position, this.rotation, { pivot: edge.pivot, rotation: turnFor(edge.direction, tilt) }, freeFall * freeFall * 3);
    }, () => {
      this.phase = 'failed';
      this.showFailure();
      this.updateHud();
    });
  }

  private celebrate(): void {
    this.phase = 'celebrating';
    this.updateHud();
    this.animate(720, (progress) => {
      const press = Math.sin(Math.min(progress / 0.58, 1) * Math.PI) * 0.13;
      const liftProgress = Math.max(0, (progress - 0.22) / 0.78);
      const lift = 0.8 * liftProgress * liftProgress * (3 - 2 * liftProgress);
      this.board.setGoalPress(press);
      this.board.render(this.position, this.rotation, undefined, 0, lift - press);
    }, () => {
      this.phase = 'won';
      this.completeLevel();
      this.updateHud();
    });
  }

  private showFailure(): void {
    this.hideShare();
    this.resultIcon.textContent = '↶';
    this.resultTitle.textContent = 'Ups, prezent spadł!';
    this.resultText.textContent = 'Cofnij ruch albo zacznij od nowa.';
    this.resultPrimary.textContent = 'Cofnij ruch';
    this.resultSecondary.textContent = 'Od początku';
    this.resultPrimary.onclick = () => this.undo();
    this.resultSecondary.onclick = () => this.startLevel(this.levelIndex);
    this.revealResult();
    this.announce('Prezent spadł. Cofnij ruch albo zacznij planszę od początku.');
  }

  private completeLevel(): void {
    const previousBest = this.best.get(this.levelIndex);
    if (previousBest === undefined || this.moves < previousBest) {
      this.best.set(this.levelIndex, this.moves);
      this.saveProgress();
    }
    this.requestSync();
    this.resultIcon.textContent = '✦';
    this.resultTitle.textContent = 'Udało się!';
    this.resultText.textContent = previousBest !== undefined
      ? `Ukończono w ${this.moves} ${this.moves === 1 ? 'ruchu' : 'ruchach'}.`
      : `Ukończono w ${this.moves} ${this.moves === 1 ? 'ruchu' : 'ruchach'}. Pomagasz ratować liska!`;

    this.resultPrimary.textContent = 'Następna plansza';
    this.resultSecondary.textContent = 'Powtórz planszę';
    this.resultPrimary.onclick = () => this.startLevel(this.levelIndex + 1);
    this.resultSecondary.onclick = () => this.startLevel(this.levelIndex);
    this.prepareShare();
    this.revealResult();
    this.announce(`${this.resultTitle.textContent} ${this.resultText.textContent}`);
  }

  private revealResult(): void {
    this.result.hidden = false;
    this.resultPrimary.focus({ preventScroll: true });
  }

  private prepareShare(): void {
    const version = ++this.shareVersion;
    const level = this.levelIndex + 1;
    const moves = this.moves;
    this.shareImage = null;
    this.resultShare.hidden = true;
    this.resultShare.disabled = true;
    this.resultDownload.hidden = false;
    this.resultDownload.disabled = true;
    this.shareStatus.textContent = 'Przygotowujemy obrazek…';
    void createScoreImage(level, moves).then((image) => {
      if (version !== this.shareVersion) return;
      this.shareImage = image;
      this.resultShare.disabled = false;
      this.resultShare.hidden = !this.canShareImage(image);
      this.resultDownload.disabled = false;
      this.shareStatus.textContent = '';
    }).catch((error: unknown) => {
      if (version !== this.shareVersion) return;
      this.shareStatus.textContent = 'Nie udało się przygotować obrazka.';
      console.warn('Could not create score image:', error);
    });
  }

  private hideShare(): void {
    this.shareVersion += 1;
    this.shareImage = null;
    this.resultShare.hidden = true;
    this.resultDownload.hidden = true;
    this.shareStatus.textContent = '';
  }

  private canShareImage(image: ScoreImage): boolean {
    try {
      return !!image.file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [image.file], title: 'Droga do liska', text: image.text });
    } catch {
      return false;
    }
  }

  private shareResult(): void {
    const image = this.shareImage;
    if (!image) return;
    const version = this.shareVersion;
    if (image.file && this.canShareImage(image)) {
      try {
        void navigator.share({ files: [image.file], title: 'Droga do liska', text: image.text }).catch((error: unknown) => {
          const cancelled = error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
          if (version !== this.shareVersion || cancelled) return;
          this.shareStatus.textContent = 'Nie udało się udostępnić. Pobierz obrazek i dodaj go do posta.';
        });
        return;
      } catch {
        this.shareStatus.textContent = 'Nie udało się udostępnić. Pobierz obrazek i dodaj go do posta.';
        return;
      }
    }
    this.shareStatus.textContent = 'Udostępnianie jest niedostępne. Pobierz obrazek i dodaj go do posta.';
  }

  private downloadResult(): void {
    const image = this.shareImage;
    if (!image) return;
    try {
      downloadScoreImage(image);
      this.shareStatus.textContent = 'Obrazek pobrany. Możesz dodać go do posta.';
    } catch (error) {
      this.shareStatus.textContent = 'Nie udało się pobrać obrazka. Spróbuj ponownie.';
      console.warn('Could not download score image:', error);
    }
  }

  private undo(): void {
    if (this.phase === 'rolling' || this.phase === 'falling' || this.phase === 'celebrating' || this.phase === 'won') return;
    const focusWasInResult = this.result.contains(document.activeElement);
    this.restoreLastMove();
    if (focusWasInResult) this.focusDirections();
  }

  private restoreLastMove(): void {
    this.board.setGoalPress(0);
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.position = snapshot.position;
    this.rotation = snapshot.rotation;
    this.moves = snapshot.moves;
    this.bridgesOpen = snapshot.bridgesOpen;
    this.phase = 'playing';
    this.result.hidden = true;
    this.board.setBridgesOpen(this.bridgesOpen);
    this.board.render(this.position, this.rotation);
    this.updateHud();
    this.announce('Ruch cofnięty. Spróbuj innej drogi.');
  }

  private focusDirections(): void {
    this.dialog.querySelector<HTMLButtonElement>('[data-fox-direction="up"]')?.focus({ preventScroll: true });
  }

  private completedLevels(): number {
    let completed = 0;
    while (this.best.has(completed)) completed += 1;
    return completed;
  }

  private async connectCloud(): Promise<FoxCloud | null> {
    this.cloud = await createFoxCloud();
    if (!this.cloud) {
      this.rescueStatus = 'offline';
      this.updateHud();
      return null;
    }
    void this.refreshRescue();
    if (this.syncStarted) this.requestSync();
    window.addEventListener('online', () => this.refreshOnlineState());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refreshOnlineState();
    });
    window.setInterval(() => {
      if (document.visibilityState === 'visible') this.refreshOnlineState();
    }, RESCUE_REFRESH_INTERVAL);
    return this.cloud;
  }

  private refreshOnlineState(): void {
    void this.refreshRescue();
    if (this.syncStatus === 'offline' || this.syncRequested) this.requestSync();
  }

  private async refreshRescue(): Promise<void> {
    if (!this.cloud) return;
    const request = ++this.rescueRequest;
    try {
      const progress = await this.cloud.rescueProgress();
      if (request !== this.rescueRequest) return;
      const previous = this.rescueProgress;
      this.rescueProgress = progress;
      this.rescueStatus = 'ready';
      if (previous && previous.totalCompleted < previous.goal && progress.totalCompleted >= progress.goal) {
        if (this.phase === 'won') {
          this.resultTitle.textContent = 'Lisek jest wolny!';
          this.resultText.textContent = 'Razem udało nam się uwolnić liska. Możesz grać dalej!';
        }
        this.announce('Razem udało nam się uwolnić liska!');
      }
    } catch (error) {
      if (request !== this.rescueRequest) return;
      this.rescueStatus = 'offline';
      console.warn('Fox rescue progress is unavailable:', error);
    }
    this.updateHud();
  }

  private requestSync(): void {
    if (!this.cloud || !this.syncStarted) return;
    this.syncRequested = true;
    if (this.syncing) return;
    this.syncing = true;
    void this.syncProgress();
  }

  private async syncProgress(): Promise<void> {
    const cloud = this.cloud;
    if (!cloud) return;
    this.syncStatus = 'syncing';
    this.updateHud();
    try {
      await cloud.signIn();
      while (this.syncRequested) {
        this.syncRequested = false;
        const saved = await cloud.playerResults();
        const previouslyCompleted = this.completedLevels();
        saved.forEach((moves, index) => {
          const previousBest = this.best.get(index);
          if (previousBest === undefined || moves < previousBest) this.best.set(index, moves);
        });
        this.saveProgress();
        const completed = this.completedLevels();
        if (completed > previouslyCompleted && this.levelIndex === previouslyCompleted
          && this.phase === 'playing' && this.moves === 0) this.startLevel(completed);
        await cloud.recordResults(this.best, saved, completed);
        void this.refreshRescue();
      }
      this.syncStatus = 'synced';
    } catch (error) {
      this.syncStatus = 'offline';
      console.warn('Fox progress sync is unavailable:', error);
    } finally {
      this.syncing = false;
      this.updateHud();
      if (this.syncStatus === 'synced') this.leaderboard.refreshScores();
    }
  }

  private updateHud(): void {
    const completed = this.completedLevels();
    const hasSwitch = this.level.rows.some((row) => row.includes('T'));
    const introRow = this.levelIndex === 0 && this.position.row === this.level.start.row;
    const introStart = introRow && this.position.axis === 'upright' && this.position.column === this.level.start.column;
    const introMiddle = introRow && this.position.axis === 'column' && this.position.column === this.level.start.column + 1;
    const rescue = this.rescueProgress;
    const progress = rescue ? Math.min(100, Math.floor(rescue.totalCompleted / rescue.goal * 1000) / 10) : null;
    const progressLabel = progress === null ? '' : progress.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
    const rescued = rescue !== null && rescue.totalCompleted >= rescue.goal;
    const progressText = rescue
      ? `${progressLabel} procent, wspólnie ukończono ${rescue.totalCompleted} z ${rescue.goal} plansz${this.rescueStatus === 'offline' ? ', ostatni znany wynik' : ''}`
      : this.rescueStatus === 'loading' ? 'Wczytywanie wspólnego postępu' : 'Wspólny postęp jest niedostępny';
    element('fox-level-number').textContent = String(this.levelIndex + 1).padStart(2, '0');
    element('fox-level-name').textContent = this.level.name;
    element('fox-tip').textContent = introStart ? 'Naciśnij ↘ dwa razy, by dojść do łapki.'
      : introMiddle ? 'Świetnie! Naciśnij ↘ jeszcze raz.'
        : this.levelIndex === 0 && this.phase === 'playing' ? 'Cofnij ↶, aby wrócić na ścieżkę.'
          : hasSwitch ? 'Stań pionowo na przycisku, by zmienić most.' : 'Postaw prezent pionowo na łapce.';
    this.dialog.querySelector<HTMLButtonElement>('[data-fox-direction="down"]')?.classList.toggle('is-intro-hint', introStart || introMiddle);
    this.svg.setAttribute('aria-label', hasSwitch
      ? `Plansza z przyciskiem. Most jest ${this.bridgesOpen ? 'otwarty' : 'zamknięty'}. Postaw prezent pionowo na przycisku, by zmienić most. Przetocz prezent na pole z łapką.`
      : 'Izometryczna plansza. Przetocz prezent na pole z łapką.');
    element('fox-moves').textContent = String(this.moves);
    const record = this.best.get(this.levelIndex);
    element('fox-best').textContent = record === undefined ? 'GRAJ ILE CHCESZ' : `Twój rekord: ${record} ruchów`;
    element('fox-progress-count').textContent = String(completed);
    element('fox-map-percent').textContent = progress === null ? '—' : `${progressLabel}%`;
    element('fox-rescue-percent').textContent = progress === null ? '—' : `${progressLabel}%`;
    element('fox-map-progress-fill').style.width = `${progress ?? 0}%`;
    element('fox-rescue-progress-fill').style.width = `${progress ?? 0}%`;
    element('fox-map-status').textContent = this.rescueStatus === 'loading' ? 'Łączenie z misją…'
      : this.rescueStatus === 'offline' ? rescue ? 'Ostatni znany wynik' : 'Wspólny postęp niedostępny' : '';
    for (const id of ['fox-map-progress', 'fox-rescue-progress']) {
      if (progress === null) element(id).removeAttribute('aria-valuenow');
      else element(id).setAttribute('aria-valuenow', String(progress));
      element(id).setAttribute('aria-valuetext', progressText);
    }
    element('fox-rescue-count').textContent = rescue
      ? `${rescue.totalCompleted.toLocaleString('pl-PL')} / ${rescue.goal.toLocaleString('pl-PL')} plansz${rescued ? ' — lisek uwolniony!' : ''}${this.rescueStatus === 'offline' ? ' (ostatni wynik)' : ''}`
      : this.rescueStatus === 'loading' ? 'Łączymy z misją ratunkową…' : 'Wspólny postęp jest niedostępny. Możesz grać dalej.';
    element('fox-story-title').textContent = rescued ? 'Lisek jest wolny!' : 'Lisek czeka na pomoc!';
    element('fox-story-text').textContent = rescued
      ? 'Razem udało nam się otworzyć klatkę! Graj dalej i odkrywaj kolejne plansze.'
      : 'Leśni przyjaciele próbują otworzyć klatkę. Każda nowa plansza przybliża całą Mławę do uratowania liska!';
    element('fox-invite-title').textContent = rescued ? 'Lisek jest wolny ↗' : 'Uratuj liska ↗';
    element('fox-scene-label').textContent = rescued ? 'LISEK JEST WOLNY ↗' : 'POMÓŻ LISKOWI ↗';
    this.mapScene.classList.toggle('is-rescued', rescued);
    this.mapScene.setAttribute('aria-label', rescued
      ? 'Lisek został uwolniony. Otwórz grę i graj dalej.'
      : `Lisek czeka w leśnej klatce. ${progressText}. Otwórz grę.`);
    const storageNote = element('fox-storage-note');
    storageNote.dataset.status = this.storageAvailable ? this.syncStatus : 'storage-unavailable';
    storageNote.textContent = !this.storageAvailable
      ? 'Bez rejestracji. Postęp jest dostępny tylko w tej sesji.'
      : this.syncStatus === 'synced' ? 'Bez rejestracji. Postęp zapisany tutaj i zsynchronizowany anonimowo.'
        : this.syncStatus === 'syncing' ? 'Bez rejestracji. Postęp zapisany tutaj; synchronizacja w toku…'
          : this.syncStatus === 'offline' ? 'Postęp zapisany tutaj. Synchronizacja jest chwilowo niedostępna.'
            : 'Bez rejestracji. Postęp jest zapisywany w tej przeglądarce.';
    this.undoButton.disabled = this.history.length === 0 || this.phase === 'rolling' || this.phase === 'falling' || this.phase === 'celebrating' || this.phase === 'won';
    this.previousLevelsButton.disabled = this.levelPageStart === 0;
    this.nextLevelsButton.disabled = this.levelPageStart + LEVELS_PER_PAGE > completed;
    this.levelButtons.forEach((button, offset) => {
      const index = this.levelPageStart + offset;
      const unlocked = index <= completed;
      button.hidden = !unlocked;
      button.disabled = !unlocked;
      if (!unlocked) {
        button.textContent = '';
        button.removeAttribute('aria-current');
        button.removeAttribute('aria-label');
        button.classList.remove('completed');
        return;
      }
      const wasCompleted = this.best.has(index);
      button.textContent = String(index + 1).padStart(2, '0');
      button.classList.toggle('completed', wasCompleted);
      button.setAttribute('aria-current', index === this.levelIndex ? 'step' : 'false');
      button.setAttribute('aria-label', `Plansza ${index + 1}: ${getLevelName(index)}${wasCompleted ? ', ukończona' : ''}`);
    });
  }

  private announce(message: string): void {
    element('fox-status').textContent = message;
  }

  private loadProgress(): void {
    try {
      this.readSavedProgress(localStorage.getItem(LEGACY_STORAGE_KEY));
      this.readSavedProgress(localStorage.getItem(STORAGE_KEY));
    } catch {
      this.storageAvailable = false;
    }
  }

  private readSavedProgress(saved: string | null): void {
    if (!saved) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return;
      Object.entries(parsed).forEach(([key, score]) => {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key
          || typeof score !== 'number' || !Number.isSafeInteger(score) || score <= 0) return;
        const previousBest = this.best.get(index);
        if (previousBest === undefined || score < previousBest) this.best.set(index, score);
      });
    } catch {
      return;
    }
  }

  private saveProgress(): void {
    try {
      this.readSavedProgress(localStorage.getItem(LEGACY_STORAGE_KEY));
      this.readSavedProgress(localStorage.getItem(STORAGE_KEY));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.best)));
    } catch {
      this.storageAvailable = false;
    }
  }

  private animate(duration: number, update: (progress: number) => void, finish: () => void): void {
    this.stopAnimation();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update(1);
      finish();
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / duration));
      update(progress);
      if (progress < 1) this.animationFrame = requestAnimationFrame(tick);
      else {
        this.animationFrame = null;
        finish();
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dialog.close();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const directions: Record<string, Direction> = {
      arrowup: 'up', w: 'up', arrowright: 'right', d: 'right',
      arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left',
    };
    const direction = directions[key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    this.move(direction);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointerStart = { horizontal: event.clientX, vertical: event.clientY, id: event.pointerId };
    this.svg.setPointerCapture(event.pointerId);
  }

  private onPointerUp(event: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const horizontal = event.clientX - start.horizontal;
    const vertical = event.clientY - start.vertical;
    if (Math.hypot(horizontal, vertical) < 24) return;
    const horizontalDistance = Math.abs(horizontal);
    const verticalDistance = Math.abs(vertical);
    if (Math.min(horizontalDistance, verticalDistance) > Math.max(horizontalDistance, verticalDistance) * 0.35) {
      if (vertical < 0) this.move(horizontal > 0 ? 'right' : 'up');
      else this.move(horizontal > 0 ? 'down' : 'left');
    } else if (horizontalDistance > verticalDistance) this.move(horizontal > 0 ? 'right' : 'left');
    else this.move(vertical > 0 ? 'down' : 'up');
  }
}
