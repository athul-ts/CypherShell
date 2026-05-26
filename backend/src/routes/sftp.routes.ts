import { Router } from 'express';
import { listDirectory, uploadFile, downloadFile, deleteFile, progressStream, renameFile, createDirectory, changePermissions } from '../controllers/sftp.controller';

const router = Router();

router.get('/:sessionId/list', listDirectory);
router.post('/:sessionId/upload', uploadFile);
router.post('/:sessionId/download', downloadFile);
router.post('/:sessionId/delete', deleteFile);
router.post('/:sessionId/rename', renameFile);
router.post('/:sessionId/mkdir', createDirectory);
router.post('/:sessionId/chmod', changePermissions);
router.get('/:sessionId/progress/:transferId', progressStream);

export default router;
