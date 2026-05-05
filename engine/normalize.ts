/**
 * Biomarker Normalization & Canonical Mapping
 *
 * Converts raw OCR-extracted marker names and units to the canonical
 * format expected by the PhenoAge and KDM scoring engines.
 *
 * Handles aliases (e.g., "WBC" → "whiteBloodCellCount"), unit
 * conversions (mg/dL → mmol/L), and validation of ranges.
 */

import type { CanonicalMarkers, KDMMarkers } from './phenoage';
import {
  albumin_gdL_to_gL,
  creatinine_mgdL_to_umolL,
  glucose_mgdL_to_mmolL,
  crp_mgL_to_mgdL,
} from './phenoage';

// ─────────────────────────────────────────────────────────────────────
// RAW MARKER FORMAT (from OCR / manual entry)
// ─────────────────────────────────────────────────────────────────────

export interface RawMarker {
  name: string;
  value: number;
  unit: string;
  referenceRange?: string;
}

export interface NormalizationResult {
  canonical: Partial<CanonicalMarkers>;
  kdm: Partial<KDMMarkers>;
  unmapped: RawMarker[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────
// ALIAS MAP
// ─────────────────────────────────────────────────────────────────────

type CanonicalKey = keyof CanonicalMarkers | keyof KDMMarkers;

const ALIAS_MAP: Record<string, CanonicalKey> = {
  // PhenoAge markers
  'albumin': 'albumin',
  'alb': 'albumin',
  'creatinine': 'creatinine',
  'creat': 'creatinine',
  'glucose': 'glucose',
  'glucose, fasting': 'glucose',
  'fasting glucose': 'glucose',
  'gluc': 'glucose',
  'crp': 'crp',
  'hs-crp': 'crp',
  'hscrp': 'crp',
  'c-reactive protein': 'crp',
  'high-sensitivity crp': 'crp',
  'lymphocyte': 'lymphocytePct',
  'lymphocyte %': 'lymphocytePct',
  'lymph %': 'lymphocytePct',
  'lymphocytes': 'lymphocytePct',
  'mcv': 'meanCellVol',
  'mean cell volume': 'meanCellVol',
  'mean corpuscular volume': 'meanCellVol',
  'rdw': 'redCellDistWidth',
  'red cell distribution width': 'redCellDistWidth',
  'rdw-cv': 'redCellDistWidth',
  'alp': 'alkalinePhosphatase',
  'alkaline phosphatase': 'alkalinePhosphatase',
  'alk phos': 'alkalinePhosphatase',
  'wbc': 'whiteBloodCellCount',
  'white blood cell': 'whiteBloodCellCount',
  'white blood cell count': 'whiteBloodCellCount',
  'white blood cells': 'whiteBloodCellCount',
  'leukocytes': 'whiteBloodCellCount',

  // KDM markers
  'ldl': 'ldl',
  'ldl cholesterol': 'ldl',
  'ldl-c': 'ldl',
  'hdl': 'hdl',
  'hdl cholesterol': 'hdl',
  'hdl-c': 'hdl',
  'apob': 'apoB',
  'apolipoprotein b': 'apoB',
  'apo b': 'apoB',
  'testosterone': 'testosterone',
  'testosterone, total': 'testosterone',
  'total testosterone': 'testosterone',
  'tsh': 'tsh',
  'thyroid stimulating hormone': 'tsh',
  'vitamin d': 'vitaminD',
  'vit d': 'vitaminD',
  '25-oh vitamin d': 'vitaminD',
  '25-hydroxyvitamin d': 'vitaminD',
  'homocysteine': 'homocysteine',
  'hcy': 'homocysteine',
};

const PHENOAGE_KEYS = new Set<string>([
  'albumin', 'creatinine', 'glucose', 'crp', 'lymphocytePct',
  'meanCellVol', 'redCellDistWidth', 'alkalinePhosphatase',
  'whiteBloodCellCount',
]);

// ─────────────────────────────────────────────────────────────────────
// UNIT CONVERSION DISPATCH
// ─────────────────────────────────────────────────────────────────────

function convertToCanonical(
  key: CanonicalKey,
  value: number,
  unit: string,
): { converted: number; warning?: string } {
  const u = unit.toLowerCase().replace(/\s+/g, '');

  switch (key) {
    case 'albumin':
      if (u.includes('g/dl')) return { converted: albumin_gdL_to_gL(value) };
      if (u.includes('g/l')) return { converted: value };
      return { converted: value, warning: `albumin: unknown unit "${unit}", assuming g/L` };

    case 'creatinine':
      if (u.includes('mg/dl')) return { converted: creatinine_mgdL_to_umolL(value) };
      if (u.includes('umol/l') || u.includes('µmol/l')) return { converted: value };
      return { converted: value, warning: `creatinine: unknown unit "${unit}", assuming µmol/L` };

    case 'glucose':
      if (u.includes('mg/dl')) return { converted: glucose_mgdL_to_mmolL(value) };
      if (u.includes('mmol/l')) return { converted: value };
      return { converted: value, warning: `glucose: unknown unit "${unit}", assuming mmol/L` };

    case 'crp':
      if (u.includes('mg/l')) return { converted: crp_mgL_to_mgdL(value) };
      if (u.includes('mg/dl')) return { converted: value };
      return { converted: value, warning: `CRP: unknown unit "${unit}", assuming mg/dL` };

    case 'whiteBloodCellCount':
      // Convert absolute count (cells/µL) to thousands
      if (value > 100) return { converted: value / 1000 };
      return { converted: value };

    default:
      return { converted: value };
  }
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize an array of raw OCR-extracted markers into canonical
 * PhenoAge and KDM formats.
 *
 * @param rawMarkers - Array of markers with name, value, unit
 * @returns NormalizationResult with canonical markers, KDM markers,
 *          unmapped items, and conversion warnings
 */
export function normalizeMarkers(rawMarkers: RawMarker[]): NormalizationResult {
  const canonical: Partial<CanonicalMarkers> = {};
  const kdm: Partial<KDMMarkers> = {};
  const unmapped: RawMarker[] = [];
  const warnings: string[] = [];

  for (const raw of rawMarkers) {
    const normalizedName = raw.name.toLowerCase().trim();
    const key = ALIAS_MAP[normalizedName];

    if (!key) {
      unmapped.push(raw);
      continue;
    }

    const { converted, warning } = convertToCanonical(key, raw.value, raw.unit);
    if (warning) warnings.push(warning);

    if (PHENOAGE_KEYS.has(key)) {
      (canonical as Record<string, number>)[key] = converted;
    } else {
      (kdm as Record<string, number>)[key] = converted;
    }
  }

  return { canonical, kdm, unmapped, warnings };
}

/**
 * Check whether enough PhenoAge markers are present for computation.
 * All 9 markers are required for a valid PhenoAge score.
 */
export function hasSufficientPhenoAgeMarkers(
  markers: Partial<CanonicalMarkers>
): boolean {
  const required: (keyof CanonicalMarkers)[] = [
    'albumin', 'creatinine', 'glucose', 'crp', 'lymphocytePct',
    'meanCellVol', 'redCellDistWidth', 'alkalinePhosphatase',
    'whiteBloodCellCount',
  ];
  return required.every((k) => markers[k] !== undefined && markers[k] !== null);
}

/**
 * Generate a SHA-256 hash of the canonical marker set for on-chain attestation.
 * Uses Web Crypto API (available in Edge runtimes and Node 18+).
 */
export async function hashCanonicalMarkers(
  markers: CanonicalMarkers,
  kdmMarkers: KDMMarkers,
  chronologicalAge: number
): Promise<Uint8Array> {
  const payload = JSON.stringify({
    pheno: markers,
    kdm: kdmMarkers,
    age: chronologicalAge,
  });

  const encoded = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hashBuffer);
}
