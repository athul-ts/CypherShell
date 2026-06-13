import { Router } from 'express';
import { listKeys, generateKey, importKey, getKeyUsage, deleteKey, exportKeyBundle, importKeyBundle } from '../controllers/key.controller';

const router = Router();

router.get('/', listKeys);
router.post('/generate', generateKey);
router.post('/import', importKey);
router.post('/import-bundle', importKeyBundle);
router.get('/:id/usage', getKeyUsage);
router.post('/:id/export-bundle', exportKeyBundle);
router.delete('/:id', deleteKey);

export default router;
