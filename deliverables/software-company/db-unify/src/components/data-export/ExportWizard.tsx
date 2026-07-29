/**
 * 数据导出向导主组件
 *
 * 三步式：DBeaver 风格
 * - 步骤 1: 选择源（表 / SQL）
 * - 步骤 2: 选择目标（文件 / 数据库）
 * - 步骤 3: 选项 + 预览
 *
 * 执行模式通过 SSE 推送，进度组件共享同一对话框。
 */
import React, { useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stepper,
  Step,
  StepLabel,
  Box,
  Typography,
  Alert,
} from '@mui/material';
import {
  buildExportConfig,
  useExportStore,
} from '../../stores/exportStore';
import { ExportStepSource } from './ExportStepSource';
import { ExportStepTarget } from './ExportStepTarget';
import { ExportStepOptions } from './ExportStepOptions';
import { ExportProgress } from './ExportProgress';
import { executeExportStream } from '../../services/exportService';
import type { ExportSource } from '../../services/exportService';

const STEPS = ['选择源', '选择目标', '选项 & 预览'];

export interface ExportWizardProps {
  /** 触发时预填的源（如已选中表） */
  initialSource?: Partial<ExportSource>;
  /** 显式控制（默认用 store） */
  open?: boolean;
  onClose?: () => void;
}

export const ExportWizard: React.FC<ExportWizardProps> = ({
  initialSource,
  open: openProp,
  onClose: onCloseProp,
}) => {
  const store = useExportStore();
  const abortRef = useRef<AbortController | null>(null);

  const open = openProp ?? store.open;
  const close = () => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }
    if (onCloseProp) onCloseProp();
    else store.closeWizard();
  };

  const openWithInitial = () => {
    store.openWizard(initialSource);
  };

  // 触发入口：父组件可以传 initialSource
  React.useEffect(() => {
    if (openProp && initialSource) {
      openWithInitial();
    }
  }, [openProp, initialSource]);

  const next = () => {
    if (store.step === 0) {
      const ready =
        store.sourceType === 'sql'
          ? !!store.sql
          : store.selectedTables.length > 0;
      if (!ready) return;
    }
    if (store.step === 1) {
      if (!store.target) return;
    }
    store.next();
  };

  const prev = () => store.prev();

  const sourceReady =
    store.sourceType === 'sql'
      ? !!store.sql
      : store.selectedTables.length > 0;

  const targetReady = !!store.target;

  const canNext =
    (store.step === 0 && sourceReady) ||
    (store.step === 1 && targetReady) ||
    store.step === 2;

  const canSubmit =
    sourceReady &&
    targetReady &&
    (store.target?.type === 'database'
      ? !!(store.target.connectionId && store.target.tableName)
      : true);

  const startExport = async () => {
    if (!canSubmit) return;
    store.startExecution('exporting-' + Date.now());

    const controller = await executeExportStream(
      buildExportConfig(store),
      (evt) => {
        store.handleProgress(evt);
        if (evt.event === 'done') {
          store.finishExecution(true, {
            success: true,
            durationMs: (evt as any).durationMs || 0,
            totalRows: (evt as any).totalRows || 0,
            filePath: (evt as any).filePath,
            tableName: (evt as any).tableName,
          });
        }
        if (evt.event === 'error') {
          store.setError((evt as any).message || '导出失败');
        }
      },
      (err) => {
        store.setError(err?.message || String(err));
      },
      () => {
        // 无 done/error 但流结束，默认成功
        if (store.mode === 'executing' && !store.result) {
          store.finishExecution(true, {
            success: true,
            durationMs: store.progress.elapsedMs,
            totalRows: store.progress.processedRows,
          });
        }
      }
    );

    abortRef.current = controller;
  };

  const cancelExport = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    store.finishExecution(false, {
      success: false,
      durationMs: 0,
      totalRows: 0,
      message: '已取消',
    });
  };

  const isRunning = store.mode === 'executing';
  const isDone = store.mode === 'done' || store.mode === 'error';

  return (
    <Dialog
      open={open}
      onClose={isRunning ? undefined : close}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#2B2B2B', color: '#FFFFFF', minHeight: 480 } }}
    >
      <DialogTitle sx={{ color: '#FFFFFF', borderBottom: '1px solid #4B4B4B' }}>
        📤 数据导出向导
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        {!isDone && !isRunning && (
          <>
            <Stepper
              activeStep={store.step}
              alternativeLabel
              sx={{
                mb: 3,
                '& .MuiStepIcon-root': { color: '#5A5A5A' },
                '& .MuiStepIcon-active': { color: '#DAAA4E' },
                '& .MuiStepIcon-completed': { color: '#4CAF50' },
                '& .MuiStepLabel-label': { color: '#BBBBBB' },
              }}
            >
              {STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            <Box sx={{ minHeight: 320 }}>
              {store.step === 0 && <ExportStepSource />}
              {store.step === 1 && <ExportStepTarget />}
              {store.step === 2 && <ExportStepOptions />}
            </Box>

            {!sourceReady && store.step === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                请先在步骤 1 中完成数据源选择
              </Alert>
            )}
            {!targetReady && store.step === 1 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                请先在步骤 2 中完成目标选择
              </Alert>
            )}
          </>
        )}

        {(isRunning || isDone) && (
          <ExportProgress
            onClose={close}
            onCancel={cancelExport}
          />
        )}
      </DialogContent>

      {!isRunning && !isDone && (
        <DialogActions sx={{ borderTop: '1px solid #4B4B4B', px: 3, py: 2 }}>
          <Button onClick={close} color="inherit">
            取消
          </Button>
          <Box sx={{ flex: 1 }}>
            {store.step > 0 && (
              <Button onClick={prev} sx={{ mr: 1 }}>
                上一步
              </Button>
            )}
            {store.step < 2 && (
              <Button
                variant="contained"
                onClick={next}
                disabled={!canNext}
              >
                下一步
              </Button>
            )}
            {store.step === 2 && (
              <Button
                variant="contained"
                color="primary"
                onClick={startExport}
                disabled={!canSubmit}
              >
                ▶ 开始导出
              </Button>
            )}
          </Box>
        </DialogActions>
      )}

      {isDone && (
        <DialogActions sx={{ borderTop: '1px solid #4B4B4B', px: 3, py: 2 }}>
          <Button onClick={close} color="inherit">
            关闭
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

export default ExportWizard;
