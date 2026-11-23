import { Router } from 'express'
import {
  getStatus,
  setup,
  setupSkip,
  unlock,
  lock,
  setupMasterPassword,
  disableLock,
  changeMasterPassword
} from '../controllers/auth.controller'
import { requireAuth } from '../middleware/auth.middleware'

const router = Router()

router.get('/status', getStatus)
router.post('/setup', setup)
router.post('/setup/skip', setupSkip)
router.post('/unlock', unlock)
router.post('/lock', requireAuth, lock)
router.post('/setup-password', requireAuth, setupMasterPassword)
router.post('/disable-lock', requireAuth, disableLock)
router.post('/change-password', requireAuth, changeMasterPassword)

export default router
