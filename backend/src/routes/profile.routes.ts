import { Router } from 'express'
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  connectProfile,
  exportProfiles,
  importProfiles
} from '../controllers/profile.controller'
import {
  listTunnelRules,
  createTunnelRule,
  deleteTunnelRule
} from '../controllers/tunnel-rule.controller'

const router = Router()

router.get('/', listProfiles)
router.post('/', createProfile)
// Export/import must be registered before /:id to avoid collision
router.get('/export', exportProfiles)
router.post('/import', importProfiles)
router.get('/:id', getProfile)
router.put('/:id', updateProfile)
router.delete('/:id', deleteProfile)
router.post('/:id/duplicate', duplicateProfile)
router.post('/:id/connect', connectProfile)
// BL-34: saved port-forwarding rules
router.get('/:id/tunnels', listTunnelRules)
router.post('/:id/tunnels', createTunnelRule)
router.delete('/:id/tunnels/:tunnelId', deleteTunnelRule)

export default router
