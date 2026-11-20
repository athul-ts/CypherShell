import { Router } from 'express'
import { listKnownHosts, deleteKnownHost } from '../controllers/known-host.controller'

const router = Router()

router.get('/', listKnownHosts)
router.delete('/:id', deleteKnownHost)

export default router
