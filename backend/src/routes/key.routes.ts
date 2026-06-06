import { Router } from 'express';
import { listKeys, generateKey, importKey, getKeyUsage, deleteKey } from '../controllers/key.controller';

const router = Router();

router.get('/', listKeys);
router.post('/generate', generateKey);
router.post('/import', importKey);
router.get('/:id/usage', getKeyUsage);
router.delete('/:id', deleteKey);

export default router;
