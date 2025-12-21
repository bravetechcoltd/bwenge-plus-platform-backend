// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { ApiKey, ApiKeyStatus, ApiKeyPermission, ApiKeyLog } from "../database/models/ApiKey";
import { User, BwengeRole } from "../database/models/User";

export class ApiKeyController {
  
  private static async verifySystemAdmin(req: Request, res: Response): Promise<boolean> {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return false;
    }
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      res.status(403).json({ success: false, message: "System admin access required" });
      return false;
    }
    return true;
  }

  // GET /api/system-settings/api-keys
  static async getAllApiKeys(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { status } = req.query;

      const apiKeyRepo = dbConnection.getRepository(ApiKey);
      const queryBuilder = apiKeyRepo.createQueryBuilder("api_key");

      if (status && Object.values(ApiKeyStatus).includes(status as ApiKeyStatus)) {
        queryBuilder.andWhere("api_key.status = :status", { status });
      }

      queryBuilder.orderBy("api_key.created_at", "DESC");

      const apiKeys = await queryBuilder.getMany();

      // Don't return the hash, only preview
      const sanitizedKeys = apiKeys.map(key => ({
        ...key,
        key_hash: undefined,
      }));

      res.json({
        success: true,
        data: sanitizedKeys,
      });
    } catch (error: any) {
      console.error("❌ Get API keys error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch API keys",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/api-keys/:id
  static async getApiKeyById(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const apiKeyRepo = dbConnection.getRepository(ApiKey);
      const apiKey = await apiKeyRepo.findOne({ where: { id } });

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          message: "API key not found",
        });
      }

      // Don't return the hash
      const { key_hash, ...sanitizedKey } = apiKey;

      res.json({
        success: true,
        data: sanitizedKey,
      });
    } catch (error: any) {
      console.error("❌ Get API key error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch API key",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/api-keys
  static async createApiKey(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const {
        name,
        description,
        permissions,
        allowed_ips,
        allowed_domains,
        rate_limits,
        expires_at,
        metadata,
      } = req.body;

      const userId = req.user?.userId || req.user?.id;

      // Validate
      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Name is required",
        });
      }

      const apiKeyRepo = dbConnection.getRepository(ApiKey);

      // Generate key
      const { key, hash, preview } = ApiKey.generateKey();

      const apiKey = apiKeyRepo.create({
        name,
        description,
        key_hash: hash,
        key_preview: preview,
        permissions: permissions || [ApiKeyPermission.READ],
        allowed_ips: allowed_ips || [],
        allowed_domains: allowed_domains || [],
        rate_limits: rate_limits || { window_ms: 3600000, max_requests: 1000 },
        expires_at: expires_at ? new Date(expires_at) : null,
        status: ApiKeyStatus.ACTIVE,
        created_by_user_id: userId,
        metadata: {
          ...metadata,
          created_by: userId,
        },
      });

      await apiKeyRepo.save(apiKey);

      res.status(201).json({
        success: true,
        message: "API key created successfully",
        data: {
          ...apiKey,
          key, // Return the actual key ONLY ONCE
          key_hash: undefined,
        },
      });
    } catch (error: any) {
      console.error("❌ Create API key error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create API key",
        error: error.message,
      });
    }
  }

  // PUT /api/system-settings/api-keys/:id
  static async updateApiKey(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const {
        name,
        description,
        permissions,
        allowed_ips,
        allowed_domains,
        rate_limits,
        status,
        expires_at,
        metadata,
      } = req.body;

      const apiKeyRepo = dbConnection.getRepository(ApiKey);
      const apiKey = await apiKeyRepo.findOne({ where: { id } });

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          message: "API key not found",
        });
      }

      // Update fields
      if (name !== undefined) apiKey.name = name;
      if (description !== undefined) apiKey.description = description;
      if (permissions !== undefined) apiKey.permissions = permissions;
      if (allowed_ips !== undefined) apiKey.allowed_ips = allowed_ips;
      if (allowed_domains !== undefined) apiKey.allowed_domains = allowed_domains;
      if (rate_limits !== undefined) apiKey.rate_limits = rate_limits;
      if (status !== undefined) apiKey.status = status;
      if (expires_at !== undefined) apiKey.expires_at = expires_at ? new Date(expires_at) : null;

      // Merge metadata
      if (metadata) {
        apiKey.metadata = { ...apiKey.metadata, ...metadata };
      }

      await apiKeyRepo.save(apiKey);

      res.json({
        success: true,
        message: "API key updated successfully",
        data: {
          ...apiKey,
          key_hash: undefined,
        },
      });
    } catch (error: any) {
      console.error("❌ Update API key error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update API key",
        error: error.message,
      });
    }
  }

  // DELETE /api/system-settings/api-keys/:id
  static async deleteApiKey(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const apiKeyRepo = dbConnection.getRepository(ApiKey);
      const apiKey = await apiKeyRepo.findOne({ where: { id } });

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          message: "API key not found",
        });
      }

      await apiKeyRepo.remove(apiKey);

      res.json({
        success: true,
        message: "API key deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete API key error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete API key",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/api-keys/:id/revoke
  static async revokeApiKey(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const apiKeyRepo = dbConnection.getRepository(ApiKey);
      const apiKey = await apiKeyRepo.findOne({ where: { id } });

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          message: "API key not found",
        });
      }

      apiKey.status = ApiKeyStatus.REVOKED;
      await apiKeyRepo.save(apiKey);

      res.json({
        success: true,
        message: "API key revoked successfully",
        data: apiKey,
      });
    } catch (error: any) {
      console.error("❌ Revoke API key error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to revoke API key",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/api-keys/:id/regenerate
  static async regenerateApiKey(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const apiKeyRepo = dbConnection.getRepository(ApiKey);
      const apiKey = await apiKeyRepo.findOne({ where: { id } });

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          message: "API key not found",
        });
      }

      // Generate new key
      const { key, hash, preview } = ApiKey.generateKey();

      apiKey.key_hash = hash;
      apiKey.key_preview = preview;

      await apiKeyRepo.save(apiKey);

      res.json({
        success: true,
        message: "API key regenerated successfully",
        data: {
          ...apiKey,
          key, // Return the new key ONLY ONCE
          key_hash: undefined,
        },
      });
    } catch (error: any) {
      console.error("❌ Regenerate API key error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to regenerate API key",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/api-keys/:id/logs
  static async getApiKeyLogs(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const logRepo = dbConnection.getRepository(ApiKeyLog);

      const total = await logRepo.count({ where: { api_key_id: id } });
      const logs = await logRepo.find({
        where: { api_key_id: id },
        order: { timestamp: "DESC" },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      });

      res.json({
        success: true,
        data: {
          logs,
          total,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get API key logs error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch API key logs",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/api-keys/permissions
  static async getPermissions(req: Request, res: Response) {
    try {
      if (!(await ApiKeyController.verifySystemAdmin(req, res))) return;

      res.json({
        success: true,
        data: {
          permissions: Object.values(ApiKeyPermission).map(p => ({
            value: p,
            label: p.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
          })),
          statuses: Object.values(ApiKeyStatus),
        },
      });
    } catch (error: any) {
      console.error("❌ Get permissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch permissions",
        error: error.message,
      });
    }
  }
}