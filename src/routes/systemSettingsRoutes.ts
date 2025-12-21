import { Router } from "express";
import { PlatformConfigController } from "../controllers/PlatformConfigController";
import { PaymentIntegrationController } from "../controllers/PaymentIntegrationController";
import { GlobalPolicyController } from "../controllers/GlobalPolicyController";
import { SystemAnalyticsController } from "../controllers/SystemAnalyticsController";
import { ApiKeyController } from "../controllers/ApiKeyController";
import { DatabaseController } from "../controllers/DatabaseController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// All routes require authentication and system admin permissions
router.use(authenticate);

// ==================== PLATFORM CONFIGURATION ====================
router.get("/platform", PlatformConfigController.getAllConfigs);
router.get("/platform/types", PlatformConfigController.getConfigTypes);
router.get("/platform/:key", PlatformConfigController.getConfigByKey);
router.post("/platform", PlatformConfigController.createConfig);
router.put("/platform/:key", PlatformConfigController.updateConfig);
router.delete("/platform/:key", PlatformConfigController.deleteConfig);
router.post("/platform/bulk-update", PlatformConfigController.bulkUpdateConfigs);

// ==================== PAYMENT INTEGRATION ====================
router.get("/payments", PaymentIntegrationController.getAllIntegrations);
router.get("/payments/providers", PaymentIntegrationController.getProviders);
router.get("/payments/:id", PaymentIntegrationController.getIntegrationById);
router.get("/payments/:id/transactions", PaymentIntegrationController.getTransactions);
router.post("/payments", PaymentIntegrationController.createIntegration);
router.put("/payments/:id", PaymentIntegrationController.updateIntegration);
router.delete("/payments/:id", PaymentIntegrationController.deleteIntegration);
router.post("/payments/:id/test", PaymentIntegrationController.testIntegration);

// ==================== GLOBAL POLICIES ====================
router.get("/policies", GlobalPolicyController.getAllPolicies);
router.get("/policies/types", GlobalPolicyController.getPolicyTypes);
router.get("/policies/:id", GlobalPolicyController.getPolicyById);
router.get("/policies/:id/acceptances", GlobalPolicyController.getPolicyAcceptances);
router.get("/policies/type/:type/latest", GlobalPolicyController.getLatestPolicyByType);
router.post("/policies", GlobalPolicyController.createPolicy);
router.put("/policies/:id", GlobalPolicyController.updatePolicy);
router.delete("/policies/:id", GlobalPolicyController.deletePolicy);
router.post("/policies/:id/publish", GlobalPolicyController.publishPolicy);
router.post("/policies/:id/archive", GlobalPolicyController.archivePolicy);

// ==================== SYSTEM ANALYTICS ====================
router.get("/analytics/dashboard", SystemAnalyticsController.getDashboardStats);
router.get("/analytics/timeseries", SystemAnalyticsController.getTimeSeriesData);
router.get("/analytics/top-courses", SystemAnalyticsController.getTopCourses);
router.get("/analytics/user-activity", SystemAnalyticsController.getUserActivity);
router.get("/analytics/events", SystemAnalyticsController.getEventTypes);
router.get("/analytics/export", SystemAnalyticsController.exportAnalytics);

// ==================== API MANAGEMENT ====================
router.get("/api-keys", ApiKeyController.getAllApiKeys);
router.get("/api-keys/permissions", ApiKeyController.getPermissions);
router.get("/api-keys/:id", ApiKeyController.getApiKeyById);
router.get("/api-keys/:id/logs", ApiKeyController.getApiKeyLogs);
router.post("/api-keys", ApiKeyController.createApiKey);
router.put("/api-keys/:id", ApiKeyController.updateApiKey);
router.delete("/api-keys/:id", ApiKeyController.deleteApiKey);
router.post("/api-keys/:id/revoke", ApiKeyController.revokeApiKey);
router.post("/api-keys/:id/regenerate", ApiKeyController.regenerateApiKey);

// ==================== DATABASE ====================
router.get("/database/backups", DatabaseController.getBackups);
router.post("/database/backups", DatabaseController.createBackup);
router.post("/database/backups/:id/restore", DatabaseController.restoreBackup);
router.delete("/database/backups/:id", DatabaseController.deleteBackup);
router.get("/database/health", DatabaseController.getHealthStatus);
router.get("/database/status", DatabaseController.getDatabaseStatus);
router.get("/database/queries", DatabaseController.getActiveQueries);
router.get("/database/settings", DatabaseController.getSettings);
router.post("/database/maintenance/vacuum", DatabaseController.runVacuum);
router.post("/database/maintenance/analyze", DatabaseController.runAnalyze);
router.post("/database/queries/:pid/terminate", DatabaseController.terminateQuery);

export default router;