/**
 * Plan-based feature gating (open core)
 * منطق التحكم بالميزات حسب الخطة
 *
 * NOTE: This is a *client-side* gate for UX. For real protection of paid
 * features (e.g. relay servers, custom domains), enforcement must also
 * happen server-side. Client-side gates alone are bypassable.
 */

import { PLAN_LIMITS } from './constants.js';
import { getConfig } from './config.js';
import type { FeatureGate, PlanLimits } from './types.js';

export function getCurrentPlan(): 'free' | 'pro' | 'enterprise' {
  return getConfig().plan;
}

export function getCurrentLimits(): PlanLimits {
  return PLAN_LIMITS[getCurrentPlan()];
}

export function checkFeature(
  feature: keyof PlanLimits,
): FeatureGate {
  const plan = getCurrentPlan();
  const limits = PLAN_LIMITS[plan];
  const value = limits[feature];

  // Boolean features
  if (typeof value === 'boolean') {
    if (value) return { allowed: true };
    return {
      allowed: false,
      reason: `Feature "${feature}" requires Pro plan`,
      requiredPlan: 'pro',
    };
  }

  // Numeric features (limits) — caller checks against current usage
  return { allowed: true };
}

export function checkLimit(
  feature: 'maxConcurrentSessions' | 'maxConcurrentTunnels',
  currentUsage: number,
): FeatureGate {
  const plan = getCurrentPlan();
  const limit = PLAN_LIMITS[plan][feature];

  if (currentUsage < limit) return { allowed: true };

  return {
    allowed: false,
    reason: `Plan "${plan}" limit reached: ${currentUsage}/${limit} ${feature}`,
    requiredPlan: plan === 'free' ? 'pro' : 'enterprise',
  };
}
