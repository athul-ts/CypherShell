import { Router } from 'express';
import { getLogs, exportLogs } from '../controllers/audit.controller';

const router = Router();

router.get('/', getLogs);
router.get('/export', exportLogs);

export default router;
