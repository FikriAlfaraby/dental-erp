/**
 * AI model configuration.
 * Tier presets primarily control token and temperature settings.
 * The actual model can be overridden globally with AI_MODEL, or by cost class
 * via AI_FAST_MODEL and AI_REASONING_MODEL.
 */

const MINIMAX_M27 = 'minimaxai/minimax-m2.7'
const MISTRAL_SMALL_31 = 'mistralai/mistral-small-3.1-24b-instruct-2503'

const FAST_TIERS = new Set(['fast', 'chat', 'query', 'scheduling', 'command'])
const REASONING_TIERS = new Set(['default', 'reports', 'billing', 'insights', 'clinical'])

function resolveModelForTier(tier: string, fallbackModel: string): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL
  if (FAST_TIERS.has(tier) && process.env.AI_FAST_MODEL) return process.env.AI_FAST_MODEL
  if (REASONING_TIERS.has(tier) && process.env.AI_REASONING_MODEL)
    return process.env.AI_REASONING_MODEL
  return fallbackModel
}

function withModelOverride(tier: string, config: ModelConfig): ModelConfig {
  return {
    ...config,
    model: resolveModelForTier(tier, config.model),
  }
}

export interface ModelConfig {
  model: string
  maxTokens: number
  temperature: number
}

export const AI_MODELS: Record<string, ModelConfig> = {
  /** Intent detection, command parsing — structured JSON output */
  fast: { model: MISTRAL_SMALL_31, maxTokens: 1024, temperature: 0.1 },
  /** Simple chat: greetings, FAQs, basic lookups, confirmations */
  chat: { model: MISTRAL_SMALL_31, maxTokens: 1024, temperature: 0.4 },

  /** General-purpose: complex reasoning, multi-step conversations */
  default: { model: MINIMAX_M27, maxTokens: 4096, temperature: 0.7 },
  /** Long-form reports and analytics */
  reports: { model: MINIMAX_M27, maxTokens: 8192, temperature: 0.3 },
  /** Natural language → Prisma query translation */
  query: { model: MISTRAL_SMALL_31, maxTokens: 2048, temperature: 0.1 },
  /** Appointment scheduling with conflict resolution */
  scheduling: { model: MISTRAL_SMALL_31, maxTokens: 2048, temperature: 0.2 },
  /** Financial calculations, GST, billing */
  billing: { model: MINIMAX_M27, maxTokens: 4096, temperature: 0.1 },
  /** Analytics, forecasting, segmentation */
  insights: { model: MINIMAX_M27, maxTokens: 4096, temperature: 0.3 },

  /** Safety-critical: treatment planning, contraindication checks, consent */
  clinical: { model: MINIMAX_M27, maxTokens: 8192, temperature: 0.2 },

  command: { model: MISTRAL_SMALL_31, maxTokens: 1024, temperature: 0.1 },
}

/** Skill name → model tier */
/**
 * Skill → model tier mapping.
 *
 * Cost-optimization strategy (Feb 2026):
 *   - Flash Lite (chat)  → simple conversational skills that collect/relay info
 *   - Pro (default/billing/insights/scheduling/reports) → analysis & reasoning
 *   - Opus (clinical)    → safety-critical tasks (treatment, consent)
 *
 * Only escalate when the skill genuinely needs deeper reasoning.
 */
export const SKILL_MODEL_MAP: Record<string, string> = {
  // ── Flash Lite tier — conversational / relay skills ──────────────────
  'patient-intake': 'chat', // collects info, no analysis
  'lab-coordinator': 'chat', // routes orders, no reasoning
  'whatsapp-receptionist': 'chat', // FAQ + appointment relay
  'smart-scheduler': 'chat', // slot lookup, simple conflict check

  // ── Pro tier — requires analysis / reasoning ─────────────────────────
  'billing-agent': 'billing', // GST calc, multi-step invoicing
  'inventory-manager': 'insights', // demand prediction, anomaly detection
  'clinic-analyst': 'reports', // trend analysis, executive summaries
  'no-show-predictor': 'insights', // pattern analysis, risk scoring
  'inventory-forecaster': 'insights', // 30/60/90-day demand forecast
  'cashflow-forecaster': 'billing', // cash flow projection
  'patient-segmentation': 'insights', // RFM analysis, churn prediction
  'claim-analyzer': 'billing', // denial analysis, appeal drafting
  'dynamic-pricing': 'billing', // demand/utilization analysis

  // ── Opus tier — safety-critical ──────────────────────────────────────
  'treatment-advisor': 'clinical', // contraindication checks
  'consent-generator': 'clinical', // legal/clinical document generation
}

export function getModelForSkill(skillName: string): ModelConfig {
  const tier = SKILL_MODEL_MAP[skillName] || 'default'
  return withModelOverride(tier, AI_MODELS[tier])
}

export function getModelByTier(tier: string): ModelConfig {
  const resolvedTier = AI_MODELS[tier] ? tier : 'default'
  return withModelOverride(resolvedTier, AI_MODELS[resolvedTier])
}
