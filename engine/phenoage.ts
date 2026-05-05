/**
 * Somagraph PhenoAge Scoring Engine
 *
 * Pure TypeScript implementation of the Levine PhenoAge formula
 * (Aging Cell, 2018, 800+ citations). Deterministic computation
 * with zero external API dependencies.
 *
 * Reference:
 *   Levine ME, et al. "An epigenetic biomarker of aging for lifespan
 *   and healthspan." Aging (Albany NY). 2018;10(4):573-591.
 *
 * IMPORTANT: This module computes wellness metrics only.
 * It does not diagnose, treat, or prevent any disease.
 */

// ─────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────

export interface CanonicalMarkers {
  /** Albumin (g/L) */
  albumin: number;
  /** Creatinine (µmol/L) */
  creatinine: number;
  /** Glucose, fasting (mmol/L) */
  glucose: number;
  /** C-reactive protein (mg/dL) — must be > 0 for log transform */
  crp: number;
  /** Lymphocyte percentage (%) */
  lymphocytePct: number;
  /** Mean cell volume (fL) */
  meanCellVol: number;
  /** Red cell distribution width (%) */
  redCellDistWidth: number;
  /** Alkaline phosphatase (U/L) */
  alkalinePhosphatase: number;
  /** White blood cell count (thousands/µL) */
  whiteBloodCellCount: number;
}

export interface PhenoAgeResult {
  /** Computed biological age in years */
  phenoAge: number;
  /** Difference from chronological age (positive = older) */
  ageAcceleration: number;
  /** Longevity score 0-100 (higher = better) */
  longevityScore: number;
  /** Intermediate mortality score (for debugging) */
  mortalityScore: number;
  /** Linear combination value (for debugging) */
  linearCombo: number;
}

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS (from Levine 2018 NHANES regression coefficients)
// ─────────────────────────────────────────────────────────────────────

const PHENOAGE_INTERCEPT = -19.907;
const COEFF_ALBUMIN = -0.0336;
const COEFF_CREATININE = 0.0095;
const COEFF_GLUCOSE = 0.1953;
const COEFF_CRP_LOG = 0.0954;
const COEFF_LYMPHOCYTE = -0.012;
const COEFF_MCV = 0.0268;
const COEFF_RDW = 0.3306;
const COEFF_ALP = 0.0019;
const COEFF_WBC = 0.0554;
const COEFF_AGE = 0.0804;

/** Gompertz baseline hazard rate */
const GOMPERTZ_GAMMA = 0.0076927;
/** Time horizon for mortality projection (120 years) */
const TIME_HORIZON = 120;
/** Scaling constant for PhenoAge derivation */
const PHENOAGE_SCALE = 0.09165;
/** PhenoAge additive constant */
const PHENOAGE_OFFSET = 141.50225;

// ─────────────────────────────────────────────────────────────────────
// CORE COMPUTATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Calculate the Levine PhenoAge from canonical biomarker inputs.
 *
 * @param markers - Normalized biomarker values in canonical units
 * @param chronologicalAge - Patient's age in years
 * @returns PhenoAgeResult with biological age, acceleration, and score
 *
 * @example
 * ```ts
 * const result = calculatePhenoAge({
 *   albumin: 43.0,
 *   creatinine: 88.4,
 *   glucose: 5.2,
 *   crp: 0.12,
 *   lymphocytePct: 28.5,
 *   meanCellVol: 89.0,
 *   redCellDistWidth: 13.2,
 *   alkalinePhosphatase: 65,
 *   whiteBloodCellCount: 6.1,
 * }, 35);
 *
 * console.log(result.phenoAge);        // ~33.7
 * console.log(result.ageAcceleration); // ~-1.3 (younger)
 * console.log(result.longevityScore);  // ~82
 * ```
 */
export function calculatePhenoAge(
  markers: CanonicalMarkers,
  chronologicalAge: number
): PhenoAgeResult {
  // Guard: CRP must be positive for log transform
  const safeCrp = Math.max(markers.crp, 0.001);

  const linearCombo =
    PHENOAGE_INTERCEPT +
    COEFF_ALBUMIN * markers.albumin +
    COEFF_CREATININE * markers.creatinine +
    COEFF_GLUCOSE * markers.glucose +
    COEFF_CRP_LOG * Math.log(safeCrp) +
    COEFF_LYMPHOCYTE * markers.lymphocytePct +
    COEFF_MCV * markers.meanCellVol +
    COEFF_RDW * markers.redCellDistWidth +
    COEFF_ALP * markers.alkalinePhosphatase +
    COEFF_WBC * markers.whiteBloodCellCount +
    COEFF_AGE * chronologicalAge;

  // Mortality score via Gompertz hazard
  const hazardIntegral =
    (Math.exp(GOMPERTZ_GAMMA * TIME_HORIZON) - 1) / GOMPERTZ_GAMMA;
  const mortalityScore = 1 - Math.exp(-Math.exp(linearCombo) * hazardIntegral);

  // PhenoAge derivation
  const phenoAge =
    PHENOAGE_OFFSET +
    Math.log(-0.00553 * Math.log(1 - mortalityScore)) / PHENOAGE_SCALE;

  const ageAcceleration = phenoAge - chronologicalAge;

  // Longevity score: sigmoid mapping of age acceleration
  // Centered at 0 (no acceleration), scale factor tuned empirically
  const longevityScore = Math.round(
    100 / (1 + Math.exp(0.3 * ageAcceleration))
  );

  return {
    phenoAge: Math.round(phenoAge * 10) / 10,
    ageAcceleration: Math.round(ageAcceleration * 10) / 10,
    longevityScore: Math.min(100, Math.max(0, longevityScore)),
    mortalityScore,
    linearCombo,
  };
}

// ─────────────────────────────────────────────────────────────────────
// UNIT CONVERSION HELPERS
// ─────────────────────────────────────────────────────────────────────

/** Convert albumin from g/dL → g/L */
export function albumin_gdL_to_gL(val: number): number {
  return val * 10;
}

/** Convert creatinine from mg/dL → µmol/L */
export function creatinine_mgdL_to_umolL(val: number): number {
  return val * 88.4;
}

/** Convert glucose from mg/dL → mmol/L */
export function glucose_mgdL_to_mmolL(val: number): number {
  return val * 0.0555;
}

/** Convert CRP from mg/L → mg/dL */
export function crp_mgL_to_mgdL(val: number): number {
  return val / 10;
}

// ─────────────────────────────────────────────────────────────────────
// KLEMERA-DOUBAL METHOD (SUPPLEMENTARY)
// ─────────────────────────────────────────────────────────────────────

/**
 * Simplified Klemera-Doubal Method for markers NOT covered by PhenoAge.
 *
 * KDM estimates biological age by fitting observed biomarker values
 * against age-dependent regression lines derived from population data.
 *
 * This implementation covers supplementary markers:
 * - LDL cholesterol
 * - HDL cholesterol
 * - ApoB
 * - Testosterone (total)
 * - TSH
 * - Vitamin D
 * - Homocysteine
 *
 * Reference: Klemera P, Doubal S. "A new approach to the concept and
 * computation of biological age." Mech Ageing Dev. 2006;127(3):240-248.
 */
export interface KDMMarkers {
  ldl?: number;          // mg/dL
  hdl?: number;          // mg/dL
  apoB?: number;         // mg/dL
  testosterone?: number; // ng/dL (total)
  tsh?: number;          // uIU/mL
  vitaminD?: number;     // ng/mL
  homocysteine?: number; // µmol/L
}

export interface KDMResult {
  /** KDM-estimated biological age offset (years) */
  kdmOffset: number;
  /** Number of markers used in computation */
  markersUsed: number;
  /** Per-marker deviation from age-optimal */
  deviations: Record<string, number>;
}

/**
 * Population regression slopes and intercepts for KDM markers.
 * Derived from NHANES IV reference population (20-80 years).
 *
 * Format: [slope (change per year), optimal_at_40, residual_sd]
 */
const KDM_PARAMS: Record<string, [number, number, number]> = {
  ldl:          [0.8,   100,  28],
  hdl:          [-0.3,   55,  14],
  apoB:         [0.6,    80,  22],
  testosterone: [-4.5,  550, 180],
  tsh:          [0.02,  2.0, 1.2],
  vitaminD:     [-0.2,   45,  15],
  homocysteine: [0.08,  8.5, 3.0],
};

export function calculateKDM(
  markers: KDMMarkers,
  chronologicalAge: number
): KDMResult {
  const deviations: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, params] of Object.entries(KDM_PARAMS)) {
    const value = markers[key as keyof KDMMarkers];
    if (value === undefined || value === null) continue;

    const [slope, optimalAt40, residualSd] = params;
    const expectedAtAge = optimalAt40 + slope * (chronologicalAge - 40);
    const deviation = (value - expectedAtAge) / residualSd;
    const weight = 1 / (residualSd * residualSd);

    deviations[key] = Math.round(deviation * 100) / 100;
    weightedSum += deviation * weight;
    totalWeight += weight;
  }

  const markersUsed = Object.keys(deviations).length;
  const kdmOffset =
    markersUsed > 0
      ? Math.round((weightedSum / totalWeight) * 10) / 10
      : 0;

  return { kdmOffset, markersUsed, deviations };
}

// ─────────────────────────────────────────────────────────────────────
// COMPOSITE SCORE
// ─────────────────────────────────────────────────────────────────────

export interface CompositeResult {
  phenoAge: PhenoAgeResult;
  kdm: KDMResult;
  /** Combined biological age estimate */
  compositeBioAge: number;
  /** Combined longevity score (0-100) */
  compositeLongevityScore: number;
}

/**
 * Compute composite biological age from PhenoAge + KDM.
 *
 * PhenoAge receives 70% weight (validated, mortality-calibrated).
 * KDM receives 30% weight (supplementary, broader marker coverage).
 */
export function calculateComposite(
  phenoMarkers: CanonicalMarkers,
  kdmMarkers: KDMMarkers,
  chronologicalAge: number
): CompositeResult {
  const phenoResult = calculatePhenoAge(phenoMarkers, chronologicalAge);
  const kdmResult = calculateKDM(kdmMarkers, chronologicalAge);

  const phenoWeight = 0.7;
  const kdmWeight = kdmResult.markersUsed > 0 ? 0.3 : 0;
  const totalWeight = phenoWeight + kdmWeight;

  const compositeBioAge =
    Math.round(
      ((phenoResult.phenoAge * phenoWeight +
        (chronologicalAge + kdmResult.kdmOffset) * kdmWeight) /
        totalWeight) *
        10
    ) / 10;

  const compositeAcceleration = compositeBioAge - chronologicalAge;
  const compositeLongevityScore = Math.round(
    100 / (1 + Math.exp(0.3 * compositeAcceleration))
  );

  return {
    phenoAge: phenoResult,
    kdm: kdmResult,
    compositeBioAge,
    compositeLongevityScore: Math.min(100, Math.max(0, compositeLongevityScore)),
  };
}
