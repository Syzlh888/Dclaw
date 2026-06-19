/**
 * Electron 预加载脚本
 * 安全地暴露 IPC 通信接口给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /** 获取机器信息（MAC 地址、指纹等） */
  getMachineInfo: () => ipcRenderer.invoke('get-machine-info'),

  /** 验证激活码 */
  validateLicense: (licenseKey) => ipcRenderer.invoke('validate-license', licenseKey),

  /** 检查本地是否已激活 */
  checkLicense: () => ipcRenderer.invoke('check-license'),

  /** 重置授权（调试用） */
  resetLicense: () => ipcRenderer.invoke('reset-license'),

  /** 打开外部链接 */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /** 获取当前应用端口 */
  getAppPort: () => ipcRenderer.invoke('get-app-port'),

  /** 设置应用端口（需重启生效） */
  setAppPort: (port) => ipcRenderer.invoke('set-app-port', port),
});
