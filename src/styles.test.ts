import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf-8');

describe('Video element CSS — camera display regression', () => {
  it('#video must use object-fit: cover (not contain) to prevent iOS black screen', () => {
    // Match the #video rule block
    const videoRule = css.match(/#video\s*\{[^}]+\}/);
    expect(videoRule).not.toBeNull();
    expect(videoRule![0]).toContain('object-fit: cover');
    expect(videoRule![0]).not.toContain('object-fit: contain');
  });

  it('.test-camera__view video/canvas must use object-fit: cover (not contain)', () => {
    // The rule is a combined selector: .test-camera__view video, .test-camera__view canvas
    const viewRule = css.match(/\.test-camera__view\s+video[\s\S]*?object-fit:\s*cover/);
    expect(viewRule).not.toBeNull();
    // Ensure no 'contain' override anywhere in camera view styles
    expect(css).not.toMatch(/\.test-camera__view\s+video[^}]*object-fit:\s*contain/);
  });
});
