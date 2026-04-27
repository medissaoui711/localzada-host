/**
 * Shared type definitions for Localzada
 * تعريفات الأنواع المشتركة
 */

export interface ProcessRecord {
  id: string;              // unique session id
  name: string;            // friendly name
  port: number;            // local port
  command: string;         // raw command
  args: string[];          // command args
  pid: number;             // OS process id
  startedAt: string;       // ISO timestamp
  cwd: string;             // working directory
  logFile: string;         // path to log file
  status: 'running' | 'stopped' | 'crashed';
  tunnel?: TunnelInfo;     // optional tunnel info
}

export interface TunnelInfo {
  provider: 'cloudflare';
  publicUrl: string;
  startedAt: string;
  pid: number;             // pid of cloudflared process
  logFile: string;
}

export interface LocalzadaConfig {
  /** plan: free | pro | enterprise */
  plan: 'free' | 'pro' | 'enterprise';
  /** license key (for paid plans) */
  licenseKey?: string;
  /** preferred tunnel provider */
  tunnelProvider: 'cloudflare';
  /** show banners on start */
  banner: boolean;
  /** language for messages */
  lang: 'en' | 'ar';
  /** anonymous telemetry (off by default) */
  telemetry: boolean;
}

export interface FeatureGate {
  /** can the current plan use this feature? */
  allowed: boolean;
  /** reason if not allowed */
  reason?: string;
  /** required plan to unlock */
  requiredPlan?: 'pro' | 'enterprise';
}

/** Plan-based limits (open core gating) */
export interface PlanLimits {
  maxConcurrentSessions: number;
  maxConcurrentTunnels: number;
  customSubdomains: boolean;
  persistentTunnels: boolean;       // requires CF account
  teamFeatures: boolean;
  prioritySupport: boolean;
}
