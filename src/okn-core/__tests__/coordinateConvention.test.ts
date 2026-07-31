import { describe, it, expect } from 'vitest';
import {
  COORDINATE_CONVENTION_VERSION,
  getCoordinateSpaceMetadata,
  type CoordinateSpaceMetadata,
} from '../coordinateConvention';
import { normalizeEyeX } from '../eyeConvention';

describe('coordinateConvention', () => {
  describe('COORDINATE_CONVENTION_VERSION', () => {
    it('is a semver-style string', () => {
      expect(COORDINATE_CONVENTION_VERSION).toMatch(/^\d+\.\d+$/);
    });
  });

  describe('getCoordinateSpaceMetadata', () => {
    it('returns an object with all required fields', () => {
      const meta = getCoordinateSpaceMetadata();
      expect(meta).toHaveProperty('convention_version');
      expect(meta).toHaveProperty('camera_space');
      expect(meta).toHaveProperty('eye_normalized_space');
      expect(meta).toHaveProperty('anatomical_labels');
      expect(meta).toHaveProperty('css_mirror_display_only');
      expect(meta).toHaveProperty('leftward_tracking_slope');
    });

    it('convention_version matches the module constant', () => {
      const meta = getCoordinateSpaceMetadata();
      expect(meta.convention_version).toBe(COORDINATE_CONVENTION_VERSION);
    });

    it('camera_space identifies MediaPipe Face Mesh', () => {
      const meta = getCoordinateSpaceMetadata();
      expect(meta.camera_space).toContain('mediapipe');
      expect(meta.camera_space).toContain('0_1');
    });

    it('leftward tracking slope is negative', () => {
      const meta = getCoordinateSpaceMetadata();
      expect(meta.leftward_tracking_slope).toBe('negative');
    });

    it('anatomical labels are enabled', () => {
      const meta = getCoordinateSpaceMetadata();
      expect(meta.anatomical_labels).toBe(true);
    });

    it('css mirror is display-only', () => {
      const meta = getCoordinateSpaceMetadata();
      expect(meta.css_mirror_display_only).toBe(true);
    });
  });

  describe('cross-module polarity invariant', () => {
    it('normalizeEyeX produces negative values for leftward iris movement', () => {
      // Simulate leftward tracking: iris moves toward the inner (nasal) corner.
      // Eye corners: inner at 0.6, outer at 0.4 (right eye in camera space).
      // Iris at 0.55 (past midpoint, closer to inner corner = leftward gaze).
      // The negation in normalizeEyeX maps this to a negative value,
      // consistent with the convention: leftward tracking = negative slope.
      const result = normalizeEyeX(0.55, 0.6, 0.4);
      // With negation, leftward tracking should produce negative values
      expect(result).toBeLessThan(0);
    });
  });
});
