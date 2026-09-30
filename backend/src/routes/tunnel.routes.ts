import { Router } from 'express'
import { startForward, stopForward } from '../controllers/tunnel.controller'

const router = Router()

router.post('/:sessionId/start', startForward)
router.post('/:sessionId/stop', stopForward)

export default router
