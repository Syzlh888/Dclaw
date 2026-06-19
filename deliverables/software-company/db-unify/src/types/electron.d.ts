/**
 * TypeScript 类型声明 - Electron API
 */
export {};

declare global {
  interface Window {
    electronAPI?: {
      getMachineInfo: () => Promise<{
        macs: { name: string; mac: string }[];
        hostname: string;
        platform: string;
        fingerprint: string;
      }>;
      validateLicense: (licenseKey: string) => Promise<{ valid: boolean; message: string }>;
      checkLicense: () => Promise<{ activated: boolean; fingerprint?: string; activatedAt?: string }>;
      getLicenseStatus: () => Promise<any>;
      resetLicense: () => Promise<{ success: boolean }>;
      startTrial: () => Promise<{ success: boolean; message: string; trialInfo?: any }>;
      openExternal: (url: string) => Promise<void>;
      getAppPort: () => Promise<number>;
      setAppPort: (port: number) => Promise<{ success: boolean; port?: number; message?: string }>;
    };
  }
}
