import { Router } from "express";
import { authenticate } from "../middlewares/authMiddleware";
import { SystemAdminRolesController } from "../controllers/Systemadminrolescontroller";
import { SystemAdminInstitutionAdminsController } from "../controllers/Systemadmininstitutionadminscontroller";
import { SystemAdminUserAnalyticsController } from "../controllers/Systemadminuseranalyticscontroller";

const router = Router();
router.use(authenticate);

// ════════════════════════════════════════════
// ROLES ROUTES — /system-admin/roles
// ════════════════════════════════════════════
router.get    ("/roles",              SystemAdminRolesController.getRoles);
router.get    ("/roles/permissions",  SystemAdminRolesController.getPermissions);
router.get    ("/roles/:id",          SystemAdminRolesController.getRoleById);
router.post   ("/roles",              SystemAdminRolesController.createRole);
router.put    ("/roles/:id",          SystemAdminRolesController.updateRole);
router.delete ("/roles/:id",          SystemAdminRolesController.deleteRole);

// ════════════════════════════════════════════
// INSTITUTION ADMINS — /system-admin/institution-admins
// ════════════════════════════════════════════
router.get    ("/institution-admins",                              SystemAdminInstitutionAdminsController.getInstitutionAdmins);
router.post   ("/institution-admins/assign",                      SystemAdminInstitutionAdminsController.assignInstitutionAdmin);
router.get    ("/institution-admins/:userId",                     SystemAdminInstitutionAdminsController.getInstitutionAdminDetails);
router.patch  ("/institution-admins/:userId/toggle-status",       SystemAdminInstitutionAdminsController.toggleAdminStatus);
router.delete ("/institution-admins/:userId",                     SystemAdminInstitutionAdminsController.removeInstitutionAdmin);

// ════════════════════════════════════════════
// USER ANALYTICS — /system-admin/users/analytics
// ════════════════════════════════════════════
router.get    ("/users/analytics",         SystemAdminUserAnalyticsController.getUserAnalytics);
router.get    ("/users/analytics/export",  SystemAdminUserAnalyticsController.exportUserAnalytics);

export default router;