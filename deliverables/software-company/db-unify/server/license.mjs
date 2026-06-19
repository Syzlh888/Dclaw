/**
 * 软件授权系统 - RSA 签名验证 + MAC 地址绑定 + 时效校验 + 1天试用
 *
 * 工作原理：
 * 1. 作者持私钥，软件内嵌公钥
 * 2. 用户提供 MAC 地址 → 作者用私钥签名 → 生成激活码
 * 3. 软件用公钥验签 → 验证通过则激活
 * 4. 激活码内嵌有效期（fingerprint|expiryTimestamp），0=永久
 * 5. 未激活可试用 1 天
 */

import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 内嵌公钥（由 keygen 工具生成后替换此处）
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA63BeFbbhMjjlb6gxZy2h
lxpdYdF8l9Y8EYtMPK77TAMTMFVVEl5YIPrnPRiJ8xlHWdG517nzzsnK3mZKbVWX
s9MM/Dl2xhNCpfLGoF+iO+X3XujllbL60Ze8L0F6ETnQcU42ScSAtKnCRaXqDa6T
D/eNk70CuWY74ZeYHTAFGmQgHwqkYiI8JvfKcs1dx2Qw2ecQFGW2x4fyziHtnAhZ
JQFovi3INDWqtzGHfLLDCyk7l5YJsmcPpMxGofpzmvMymBsBUPU3azVpZEEsVn7m
i3gym6KYDZCyxpKSCe5fYTlEIo4lYU94pOcjG1OlV5rlNxKctZqUQKf7ZJHcncU8
sARSR0w6C5lFhehrECuZydm4JSHHMwKRUUNig78iex4MNdsujR5aq+SaIxeXdMm8
8Fl6km/bCRTuTUNraTEh2qsw+agi+l2ef9gdecmFfpjn2PCwtSV2DjLvGT7wTaxN
iADwAngn+cu/VLuT4e1QEdJIHS+zip75oW2BljDteTRL+whAxl27nUepK0qc8zME
yfJxE767p7LP7TPy0DD4maXk2I4PQWOA3IhB0e0qIUxOvylhQZa+D8eJ5DAUZO0L
hVh46TyojHex8fZ33QxQvW13YeLrsE9Lbb10B6yf2UUDpyBwQATrTi1n3lMsZA57
kb5R5DI0+POSnHjrFhMbElsCAwEAAQ==
-----END PUBLIC KEY-----`;

// 授权存储路径
const LICENSE_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), '.config'),
  'db-unify'
);
const LICENSE_FILE = path.join(LICENSE_DIR, 'license.dat');
const TRIAL_FILE = path.join(LICENSE_DIR, 'trial.dat');

/** 试用时长（毫秒）：1 天 */
const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * 获取机器指纹（优先物理网卡 MAC + 主机名）
 */
export function getMachineFingerprint() {
  const interfaces = os.networkInterfaces();
  const macs = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal || addr.mac === '00:00:00:00:00:00') continue;
      if (/Loopback|Virtual|VMware|VirtualBox|Hyper-V|WSL|vEthernet|Bluetooth/i.test(name)) continue;
      macs.push(addr.mac.toUpperCase().replace(/[:-]/g, ''));
    }
  }

  const unique = [...new Set(macs)].sort();
  const primaryMac = unique[0] || 'UNKNOWN';
  const hostname = os.hostname();

  return crypto
    .createHash('sha256')
    .update(`${primaryMac}:${hostname}`)
    .digest('hex')
    .substring(0, 16)
    .toUpperCase();
}

/**
 * 获取原始机器信息（用于展示给用户）
 */
export function getMachineInfo() {
  const interfaces = os.networkInterfaces();
  const info = { macs: [], hostname: os.hostname(), platform: os.platform(), fingerprint: '' };

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal || addr.mac === '00:00:00:00:00:00') continue;
      if (/Loopback|Virtual|VMware|VirtualBox|Hyper-V|WSL|vEthernet|Bluetooth/i.test(name)) continue;
      info.macs.push({ name, mac: addr.mac.toUpperCase() });
    }
  }

  info.fingerprint = getMachineFingerprint();
  return info;
}

/**
 * 验证授权码
 * 
 * 激活码格式（新）：expiryTimestamp|signature_base64_groups
 *   例：0|XXXX-XXXX-...     → 永久
 *   例：1718230400|XXXX-... → 有期限
 * 
 * 激活码格式（旧，向后兼容）：signature_base64_groups（视为永久）
 * 
 * @param {string} licenseKey - 用户输入的激活码
 * @param {string} fingerprint - 机器指纹（可选，默认自动获取）
 * @returns {{ valid: boolean, message: string, expiryDate?: string, isPermanent?: boolean }}
 */
export function validateLicense(licenseKey, fingerprint) {
  const fp = fingerprint || getMachineFingerprint();

  if (!licenseKey || typeof licenseKey !== 'string') {
    return { valid: false, message: '请输入激活码' };
  }

  // 保留分隔符用于解析 expiry，其余清理
  const parts = licenseKey.split('|');
  let expiryTs = 0;
  let cleanKey;

  if (parts.length === 2 && /^\d+$/.test(parts[0].trim())) {
    // 新格式：expiryTimestamp|signature
    expiryTs = parseInt(parts[0].trim(), 10);
    cleanKey = parts[1].replace(/[^A-Za-z0-9+/=]/g, '');
  } else {
    // 旧格式（向后兼容）：只有签名，视为永久
    cleanKey = licenseKey.replace(/[^A-Za-z0-9+/=]/g, '');
  }

  try {
    const signature = Buffer.from(cleanKey, 'base64');
    const payload = `${fp}|${expiryTs}`;
    const isValid = verifySignature(signature, payload);

    if (!isValid) {
      // 回退：尝试旧格式（仅 fingerprint，无 expiry）
      const oldPayload = fp;
      if (verifySignature(signature, oldPayload)) {
        expiryTs = 0; // 旧格式视为永久
      } else {
        return { valid: false, message: '❌ 激活码无效，请检查机器码和激活码是否匹配' };
      }
    }

    // 检查是否过期
    if (expiryTs > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (now > expiryTs) {
        return {
          valid: false,
          message: '❌ 激活码已过期，请联系作者续期',
          isExpired: true,
        };
      }
    }

    const isPermanent = expiryTs === 0;
    const expiryDate = isPermanent ? null : new Date(expiryTs * 1000);

    return {
      valid: true,
      message: '✅ 激活成功',
      isPermanent,
      expiryDate: expiryDate ? expiryDate.toISOString() : null,
    };
  } catch (err) {
    return { valid: false, message: '❌ 激活码格式错误' };
  }
}

/**
 * RSA-SHA256 PSS 签名验证
 */
function verifySignature(signature, payload) {
  try {
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(payload),
      {
        key: PUBLIC_KEY_PEM,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      signature
    );
  } catch {
    return false;
  }
}

/**
 * 保存授权到本地文件
 */
export function saveLicense(licenseKey) {
  try {
    if (!fs.existsSync(LICENSE_DIR)) {
      fs.mkdirSync(LICENSE_DIR, { recursive: true });
    }
    const fp = getMachineFingerprint();
    const result = validateLicense(licenseKey, fp);
    if (!result.valid) return false;

    const data = JSON.stringify({
      license: licenseKey,
      fingerprint: fp,
      activatedAt: new Date().toISOString(),
      isPermanent: result.isPermanent,
      expiryDate: result.expiryDate,
    });
    fs.writeFileSync(LICENSE_FILE, data, 'utf8');

    // 激活成功后删除试用记录
    removeTrial();
    return true;
  } catch (err) {
    console.error('保存授权文件失败:', err.message);
    return false;
  }
}

/**
 * 读取本地授权（仅验证激活状态，不含试用）
 * @returns {{ activated: boolean, fingerprint?: string, activatedAt?: string, isPermanent?: boolean, expiryDate?: string }}
 */
export function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) {
      return { activated: false };
    }
    const data = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    if (data.license && data.fingerprint) {
      const result = validateLicense(data.license, data.fingerprint);
      if (!result.valid) {
        return { activated: false, message: result.message };
      }
      return {
        activated: true,
        fingerprint: data.fingerprint,
        activatedAt: data.activatedAt,
        isPermanent: result.isPermanent || data.isPermanent || false,
        expiryDate: result.expiryDate || data.expiryDate || null,
      };
    }
    return { activated: false };
  } catch {
    return { activated: false };
  }
}

/**
 * 删除授权（用于重置）
 */
export function removeLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      fs.unlinkSync(LICENSE_FILE);
    }
  } catch { /* ignore */ }
}

// ==================== 试用模式 ====================

/**
 * 读取试用信息（不会自动创建试用）
 * @returns 试用状态，noTrialYet 表示从未试用过
 */
export function getTrialInfo() {
  // 如果已激活，不显示试用信息
  const license = loadLicense();
  if (license.activated) {
    return { active: false, noTrialYet: false, message: '已激活' };
  }

  try {
    if (!fs.existsSync(LICENSE_DIR)) {
      fs.mkdirSync(LICENSE_DIR, { recursive: true });
    }

    if (fs.existsSync(TRIAL_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRIAL_FILE, 'utf8'));
      const startTime = data.startTime || 0;
      const endTime = startTime + TRIAL_DURATION_MS;
      const now = Date.now();
      const remaining = endTime - now;

      if (remaining <= 0) {
        return {
          active: false,
          expired: true,
          noTrialYet: false,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          remainingMs: 0,
          message: '试用已过期，请联系作者获取激活码',
        };
      }

      return {
        active: true,
        expired: false,
        noTrialYet: false,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        remainingMs: remaining,
        message: '试用中',
      };
    }

    // 无试用记录 → 返回"未曾试用"状态，不自动创建
    return {
      active: false,
      expired: false,
      noTrialYet: true,
      message: '尚未开始试用',
    };
  } catch (err) {
    console.error('试用管理失败:', err.message);
    return { active: false, expired: true, noTrialYet: false, message: `读取试用状态失败: ${err.message}` };
  }
}

/**
 * 显式开始试用（由前端"暂不注册，试用24h"按钮触发）
 * @returns {{ success: boolean, message: string, trialInfo?: object }}
 */
export function startTrial() {
  // 已激活则不创建试用
  const license = loadLicense();
  if (license.activated) {
    return { success: false, message: '已激活，无需试用' };
  }

  try {
    if (!fs.existsSync(LICENSE_DIR)) {
      fs.mkdirSync(LICENSE_DIR, { recursive: true });
    }

    // 如果已有试用记录且未过期，直接返回成功
    if (fs.existsSync(TRIAL_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRIAL_FILE, 'utf8'));
      const startTime = data.startTime || 0;
      const endTime = startTime + TRIAL_DURATION_MS;
      if (Date.now() < endTime) {
        return {
          success: true,
          message: '试用已在进行中',
          trialInfo: {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            remainingMs: endTime - Date.now(),
          },
        };
      }
    }

    // 创建或覆盖试用记录
    const startTime = Date.now();
    const trialData = JSON.stringify({
      startTime,
      fingerprint: getMachineFingerprint(),
    });
    fs.writeFileSync(TRIAL_FILE, trialData, 'utf8');

    return {
      success: true,
      message: '试用已开始（24小时）',
      trialInfo: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(startTime + TRIAL_DURATION_MS).toISOString(),
        remainingMs: TRIAL_DURATION_MS,
      },
    };
  } catch (err) {
    console.error('开始试用失败:', err.message);
    return { success: false, message: `试用启动失败: ${err.message}` };
  }
}

/**
 * 删除试用记录
 */
function removeTrial() {
  try {
    if (fs.existsSync(TRIAL_FILE)) {
      fs.unlinkSync(TRIAL_FILE);
    }
  } catch { /* ignore */ }
}

/**
 * 获取完整授权状态（激活 + 试用）
 * @returns 前端所需的完整状态信息
 */
export function getLicenseStatus() {
  const license = loadLicense();
  const trial = getTrialInfo();

  // 已激活：返回激活信息
  if (license.activated) {
    const now = new Date();
    let daysLeft = null;
    let statusText = '已激活 · 永久有效';

    if (license.expiryDate) {
      const expiryMs = new Date(license.expiryDate).getTime();
      const remainMs = expiryMs - now.getTime();
      daysLeft = Math.max(0, Math.ceil(remainMs / 86400000));
      statusText = `已激活 · 剩余 ${daysLeft} 天`;
      if (daysLeft <= 7 && daysLeft > 0) {
        statusText = `已激活 · ⚠️ 即将过期（${daysLeft}天）`;
      }
    }

    return {
      status: 'activated',
      activated: true,
      isPermanent: !!license.isPermanent,
      expiryDate: license.expiryDate || null,
      activatedAt: license.activatedAt,
      daysLeft,
      statusText,
    };
  }

  // 试用中
  if (trial.active && !trial.expired) {
    const hoursLeft = Math.max(0, Math.ceil(trial.remainingMs / 3600000));
    const minsLeft = Math.max(0, Math.ceil(trial.remainingMs / 60000));
    let statusText;
    if (hoursLeft > 0) {
      statusText = `试用中 · 剩余 ${hoursLeft} 小时`;
    } else {
      statusText = `试用中 · 剩余 ${minsLeft} 分钟`;
    }
    return {
      status: 'trial',
      activated: false,
      isPermanent: false,
      expiryDate: trial.endTime,
      trialStart: trial.startTime,
      trialEnd: trial.endTime,
      remainingMs: trial.remainingMs,
      hoursLeft,
      minsLeft,
      statusText,
    };
  }

  // 未曾试用（首次启动，需展示激活页让用户选择试用或激活）
  if (trial.noTrialYet) {
    return {
      status: 'trial_available',
      activated: false,
      isPermanent: false,
      statusText: '未激活 · 可试用24小时',
    };
  }

  // 试用过期
  return {
    status: 'trial_expired',
    activated: false,
    isPermanent: false,
    statusText: '试用已过期 · 请激活',
  };
}
