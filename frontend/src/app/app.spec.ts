import { TestBed } from '@angular/core/testing';

import { App } from './app';

describe('App', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [App] }));

  it('creates the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders Hello World', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Hello World');
  });
});
