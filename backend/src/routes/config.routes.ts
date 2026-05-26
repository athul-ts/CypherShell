import { Router } from 'express';
import { getConfig, updateConfig } from '../controllers/config.controller';

const router = Router();

router.get('/', getConfig);
router.put('/', updateConfig);

export default router;
