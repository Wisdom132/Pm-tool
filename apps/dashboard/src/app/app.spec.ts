import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { App } from './app';

/**
 * The root component.
 *
 * What it asserts is deliberately narrow: `app.html` is one
 * `<router-outlet />`, so there is nothing else here to test. The dashboard's
 * screens are covered by `tests/e2e/dashboard.e2e.test.js`, which renders
 * each route in a real browser against the real API.
 *
 * This replaced the CLI's generated assertion, which looked for an `<h1>`
 * containing "Hello, dashboard" — the placeholder from `ng new`. That `h1`
 * was replaced by the router outlet on the first day and the test had been
 * failing ever since, unnoticed because nothing ran `ng test`.
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // The root component constructs Theme, which injects nothing, but the
      // router outlet needs a router and the shell's services need HTTP.
      providers: [provideRouter([]), provideHttpClient()],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the router outlet the whole app hangs off', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
  });

  it('applies the saved theme at the root, not in a layout', async () => {
    // Regression: Theme is providedIn root but was only *injected* by
    // DashboardLayout, so it was never constructed when someone loaded
    // /sign-in or an invitation URL directly — and the saved theme did not
    // apply. Constructing App must be enough.
    localStorage.setItem('inline-edit.theme', 'dark');
    document.documentElement.classList.remove('dark');

    const fixture = TestBed.createComponent(App);
    // Theme applies the class from an effect, and effects run on change
    // detection — not on construction.
    await fixture.whenStable();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    localStorage.removeItem('inline-edit.theme');
    document.documentElement.classList.remove('dark');
  });
});
