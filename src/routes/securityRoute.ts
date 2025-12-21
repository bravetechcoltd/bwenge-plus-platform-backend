import { Router } from "express";
import { SecurityController } from "../controllers/Securitycontroller";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();


router.get("/security/audit", authenticate, SecurityController.getAuditLogs);


router.get("/security/audit/export", authenticate, SecurityController.exportAuditLogs);


router.get("/security/audit/:id", authenticate, SecurityController.getAuditLogById);


router.get("/security/access", authenticate, SecurityController.getAccessControl);


router.put(
  "/security/access/institutions/:institutionId",
  authenticate,
  SecurityController.updateInstitutionSecuritySettings
);


router.get("/security/sessions", authenticate, SecurityController.getActiveSessions);


router.delete(
  "/security/sessions/user/:userId",
  authenticate,
  SecurityController.terminateAllUserSessions
);


router.delete(
  "/security/sessions/:sessionId",
  authenticate,
  SecurityController.terminateSession
);


router.get("/security/health", authenticate, SecurityController.getSystemHealth);


router.post(
  "/security/health/cleanup-sessions",
  authenticate,
  SecurityController.cleanupExpiredSessions
);

export default router;