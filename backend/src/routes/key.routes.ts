import { Router } from 'express';
import { listKeys, generateKey, importKey, deleteKey } from '../controllers/key.controller';

const router = Router();

router.get('/', listKeys);
router.post('/generate', generateKey);
router.post('/import', importKey);
router.delete('/:id', deleteKey);

export default router;
