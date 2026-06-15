import { Router } from 'express'
import { getLogs, exportLogs, clearAllLogs } from '../controllers/audit.controller'

const router = Router()

router.get('/', getLogs)
router.get('/export', exportLogs)
router.delete('/', clearAllLogs)

export default router
