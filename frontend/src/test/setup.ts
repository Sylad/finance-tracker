import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup the DOM between every test so React Testing Library
// queries do not bleed across cases.
afterEach(() => {
  cleanup();
});
