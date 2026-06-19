declare module '../../server/crypto.mjs' {
  export function encryptPassword(password: string): {
    encrypted: string;
    iv: string;
    authTag: string;
  };
  export function decryptPassword(encrypted: string, iv: string, authTag: string): string;
}
