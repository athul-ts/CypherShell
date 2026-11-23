import { Router } from 'express'
import { getSessions, getSessionStatus, disconnectSession } from '../controllers/session.controller'

const router = Router()

router.get('/', getSessions)
router.get('/:sessionId', getSessionStatus)
router.delete('/:sessionId', disconnectSession)

export default router
