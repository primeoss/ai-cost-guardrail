// src/pricing.ts

export type MetricType = 'token_input' | 'token_output' | 'image_per_unit' | 'compute_second';

export interface RateCard {
  provider: string;
  type: MetricType;
  costPerUnit: number; // e.g., cost per 1 token, cost per 1 image, cost per 1 second
}

// Universal Registry mapping distinct system endpoints and models to explicit unit costs
export const GLOBAL_PRICE_REGISTRY: Record<string, RateCard> = {
  // Text Models
  'gpt-4o': { provider: 'openai', type: 'token_input', costPerUnit: 0.0025 / 1000 },
  'claude-3-5-sonnet': { provider: 'anthropic', type: 'token_input', costPerUnit: 0.0030 / 1000 },

  // Image Generation Models
  'dall-e-3': { provider: 'openai', type: 'image_per_unit', costPerUnit: 0.040 },
  'stable-diffusion-xl': { provider: 'stability', type: 'image_per_unit', costPerUnit: 0.020 },

  // Audio / Speech-to-Text / Custom Compute Models
  'whisper-1': { provider: 'openai', type: 'compute_second', costPerUnit: 0.006 / 60 }, // $0.006 per minute -> converted to seconds
};

export function calculateGenericCost(modelId: string, metric: MetricType, units: number): number {
  const rateCard = GLOBAL_PRICE_REGISTRY[modelId];
  if (!rateCard) {
    // Standard default safe-fallback charge if a new/untracked model is deployed in CI
    return units * (0.0015 / 1000);
  }
  return units * rateCard.costPerUnit;
}