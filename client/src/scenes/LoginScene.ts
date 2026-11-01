/**
 * The login/register form - a DOM overlay in #ui-root (architecture
 * requirement: "HTML/CSS DOM overlay... needed for backdrop-filter and
 * drag-and-drop"), not a Phaser-rendered form, since Phaser has no real
 * text-input support. Connects NetClient, authenticates, then branches to
 * IntroScene or straight to WorldScene depending on self:state.introSeen
 * (SPEC.md M1: "On later logins the intro is skipped").
 */
import Phaser from 'phaser';
import { WS_URL } from '../config.js';
import { sceneContext } from '../state/sceneContext.js';

type Mode = 'login' | 'register';

export class LoginScene extends Phaser.Scene {
  private root: HTMLDivElement | null = null;
  private mode: Mode = 'login';
  private submitting = false;

  constructor() {
    super('Login');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0710');
    for (let x = 0; x < width; x += 48) {
      for (let y = 0; y < height; y += 48) {
        this.add.image(x, y, 'tile_oakhaven_floor_0').setOrigin(0).setAlpha(0.5);
      }
    }
    this.add
      .text(width / 2, height * 0.2, 'TERAGO ONLINE', { fontFamily: 'Georgia, serif', fontSize: '42px', color: '#e8d9ff' })
      .setOrigin(0.5);

    this.buildForm();
    this.events.once('shutdown', () => this.teardownForm());
  }

  private buildForm(): void {
    const root = document.createElement('div');
    root.className = 'interactive terago-glass terago-login';
    root.innerHTML = this.formHtml();
    document.getElementById('ui-root')!.appendChild(root);
    this.root = root;
    this.wireForm();
  }

  private formHtml(): string {
    const isLogin = this.mode === 'login';
    return `
      <h2>${isLogin ? 'Log In' : 'Create Account'}</h2>
      <form id="terago-auth-form" autocomplete="off">
        <label>Username<input id="terago-username" name="username" type="text" minlength="3" maxlength="20" required /></label>
        <label>Password<input id="terago-password" name="password" type="password" minlength="8" maxlength="100" required /></label>
        <div id="terago-auth-error" class="terago-error" role="alert"></div>
        <button type="submit" id="terago-auth-submit">${isLogin ? 'Log In' : 'Register'}</button>
      </form>
      <button type="button" id="terago-auth-toggle" class="terago-link">
        ${isLogin ? "Need an account? Register" : 'Already have an account? Log in'}
      </button>
    `;
  }

  private wireForm(): void {
    const root = this.root!;
    const form = root.querySelector<HTMLFormElement>('#terago-auth-form')!;
    const toggle = root.querySelector<HTMLButtonElement>('#terago-auth-toggle')!;

    toggle.addEventListener('click', () => {
      this.mode = this.mode === 'login' ? 'register' : 'login';
      root.innerHTML = this.formHtml();
      this.wireForm();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit(form);
    });
  }

  private setError(message: string): void {
    const el = this.root?.querySelector<HTMLDivElement>('#terago-auth-error');
    if (el) el.textContent = message;
  }

  private setSubmitting(submitting: boolean): void {
    this.submitting = submitting;
    const button = this.root?.querySelector<HTMLButtonElement>('#terago-auth-submit');
    if (button) {
      button.disabled = submitting;
      button.textContent = submitting ? 'Please wait...' : this.mode === 'login' ? 'Log In' : 'Register';
    }
  }

  private async submit(form: HTMLFormElement): Promise<void> {
    if (this.submitting) return;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    this.setError('');
    this.setSubmitting(true);

    const { net, gameState } = sceneContext(this);

    try {
      await net.connect(WS_URL);
    } catch {
      this.setError('Could not reach the server. Is it running?');
      this.setSubmitting(false);
      return;
    }

    const unsubscribeAuth = gameState.onAuthResult.on((result) => {
      unsubscribeAuth();
      if (!result.ok) {
        this.setError(result.error ?? 'Login failed.');
        this.setSubmitting(false);
        return;
      }
      // self:state follows auth:result as the very next message the
      // server sends (sim/room.ts's join() sends it synchronously) -
      // waiting for it here is how the client learns introSeen.
      const unsubscribeSelf = gameState.onSelfState.on((self) => {
        unsubscribeSelf();
        this.proceedPastLogin(self.introSeen);
      });
    });

    net.send(this.mode === 'login' ? { t: 'auth:login', username, password } : { t: 'auth:register', username, password });
  }

  private proceedPastLogin(introSeen: boolean): void {
    this.scene.start(introSeen ? 'World' : 'Intro');
  }

  private teardownForm(): void {
    this.root?.remove();
    this.root = null;
  }
}
