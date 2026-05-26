import { Router } from 'express';
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  connectProfile,
} from '../controllers/profile.controller';

const router = Router();

router.get('/', listProfiles);
router.post('/', createProfile);
router.get('/:id', getProfile);
router.put('/:id', updateProfile);
router.delete('/:id', deleteProfile);
router.post('/:id/duplicate', duplicateProfile);
router.post('/:id/connect', connectProfile);

export default router;
