import { Router } from 'express';
import { getSessions, disconnectSession } from '../controllers/session.controller';

const router = Router();

router.get('/', getSessions);
router.delete('/:sessionId', disconnectSession);

export default router;
