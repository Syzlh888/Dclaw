import { Router } from 'express';
import { PERMISSION_META, MODULES } from '../permissions/registry.mjs';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    permissions: PERMISSION_META,
    modules: MODULES,
  });
});

export default router;
