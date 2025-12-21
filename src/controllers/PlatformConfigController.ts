// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { PlatformConfiguration, ConfigType, ConfigDataType } from "../database/models/PlatformConfig";
import { User, BwengeRole } from "../database/models/User";
import { cacheService } from "../services/cacheService";
import { encrypt, decrypt } from "../services/encryption";

export class PlatformConfigController {
  
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

  // GET /api/system-settings/platform
  static async getAllConfigs(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      const { type, category, active_only } = req.query;

      const configRepo = dbConnection.getRepository(PlatformConfiguration);
      const queryBuilder = configRepo.createQueryBuilder("config");

      if (type && Object.values(ConfigType).includes(type as ConfigType)) {
        queryBuilder.andWhere("config.type = :type", { type });
      }

      if (category) {
        queryBuilder.andWhere("config.metadata->>'category' = :category", { category });
      }

      if (active_only === "true") {
        queryBuilder.andWhere("config.is_active = :is_active", { is_active: true });
      }

      queryBuilder.orderBy("config.metadata->>'order'", "ASC").addOrderBy("config.display_name", "ASC");

      const configs = await queryBuilder.getMany();

      // Decrypt sensitive values
      const sanitizedConfigs = configs.map(config => {
        const sanitized = { ...config };
        if (config.metadata?.is_encrypted && config.value) {
          try {
            sanitized.value = decrypt(config.value);
          } catch (e) {
            sanitized.value = "[ENCRYPTED]";
          }
        }
        return sanitized;
      });

      res.json({
        success: true,
        data: sanitizedConfigs,
      });
    } catch (error: any) {
      console.error("❌ Get platform configs error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch platform configurations",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/platform/:key
  static async getConfigByKey(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      const { key } = req.params;

      const configRepo = dbConnection.getRepository(PlatformConfiguration);
      const config = await configRepo.findOne({ where: { key } });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Configuration not found",
        });
      }

      // Decrypt if sensitive
      if (config.metadata?.is_encrypted && config.value) {
        try {
          config.value = decrypt(config.value);
        } catch (e) {
          config.value = "[ENCRYPTED]";
        }
      }

      res.json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      console.error("❌ Get platform config error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch platform configuration",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/platform
  static async createConfig(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      const {
        key,
        display_name,
        type,
        data_type,
        value,
        json_value,
        array_value,
        description,
        validation_rules,
        metadata,
        requires_restart,
      } = req.body;

      const userId = req.user?.userId || req.user?.id;

      // Validate
      if (!key || !display_name) {
        return res.status(400).json({
          success: false,
          message: "Key and display_name are required",
        });
      }

      // Check for duplicate key
      const configRepo = dbConnection.getRepository(PlatformConfiguration);
      const existing = await configRepo.findOne({ where: { key } });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Configuration with this key already exists",
        });
      }

      // Encrypt if sensitive
      let finalValue = value;
      if (metadata?.is_encrypted && value) {
        finalValue = encrypt(value);
      }

      const config = configRepo.create({
        key,
        display_name,
        type: type || ConfigType.SYSTEM,
        data_type: data_type || ConfigDataType.STRING,
        value: finalValue,
        json_value,
        array_value,
        description,
        validation_rules,
        metadata: {
          ...metadata,
          created_by: userId,
        },
        requires_restart: requires_restart || false,
        updated_by_user_id: userId,
      });

      await configRepo.save(config);

      // Invalidate cache
      await cacheService.del(`config:${key}`);

      res.status(201).json({
        success: true,
        message: "Configuration created successfully",
        data: config,
      });
    } catch (error: any) {
      console.error("❌ Create platform config error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create platform configuration",
        error: error.message,
      });
    }
  }

  // PUT /api/system-settings/platform/:key
  static async updateConfig(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      const { key } = req.params;
      const {
        display_name,
        type,
        data_type,
        value,
        json_value,
        array_value,
        description,
        validation_rules,
        metadata,
        is_active,
        requires_restart,
      } = req.body;

      const userId = req.user?.userId || req.user?.id;

      const configRepo = dbConnection.getRepository(PlatformConfiguration);
      const config = await configRepo.findOne({ where: { key } });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Configuration not found",
        });
      }

      // Update fields
      if (display_name !== undefined) config.display_name = display_name;
      if (type !== undefined) config.type = type;
      if (data_type !== undefined) config.data_type = data_type;
      if (description !== undefined) config.description = description;
      if (validation_rules !== undefined) config.validation_rules = validation_rules;
      if (is_active !== undefined) config.is_active = is_active;
      if (requires_restart !== undefined) config.requires_restart = requires_restart;

      // Handle value based on data type
      if (value !== undefined) {
        if (config.metadata?.is_encrypted && value) {
          config.value = encrypt(value);
        } else {
          config.value = value;
        }
      }

      if (json_value !== undefined) config.json_value = json_value;
      if (array_value !== undefined) config.array_value = array_value;

      // Merge metadata
      if (metadata) {
        config.metadata = { ...config.metadata, ...metadata, updated_by: userId };
      }

      config.updated_by_user_id = userId;

      await configRepo.save(config);

      // Invalidate cache
      await cacheService.del(`config:${key}`);

      res.json({
        success: true,
        message: "Configuration updated successfully",
        data: config,
      });
    } catch (error: any) {
      console.error("❌ Update platform config error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update platform configuration",
        error: error.message,
      });
    }
  }

  // DELETE /api/system-settings/platform/:key
  static async deleteConfig(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      const { key } = req.params;

      const configRepo = dbConnection.getRepository(PlatformConfiguration);
      const config = await configRepo.findOne({ where: { key } });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Configuration not found",
        });
      }

      await configRepo.remove(config);

      // Invalidate cache
      await cacheService.del(`config:${key}`);

      res.json({
        success: true,
        message: "Configuration deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete platform config error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete platform configuration",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/platform/bulk-update
  static async bulkUpdateConfigs(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      const { configs } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!Array.isArray(configs)) {
        return res.status(400).json({
          success: false,
          message: "configs must be an array",
        });
      }

      const configRepo = dbConnection.getRepository(PlatformConfiguration);
      const updatedConfigs = [];

      for (const item of configs) {
        const { key, value } = item;
        const config = await configRepo.findOne({ where: { key } });

        if (config) {
          if (config.metadata?.is_encrypted && value) {
            config.value = encrypt(value);
          } else {
            config.value = value;
          }
          config.updated_by_user_id = userId;
          await configRepo.save(config);
          updatedConfigs.push(config);
          await cacheService.del(`config:${key}`);
        }
      }

      res.json({
        success: true,
        message: `${updatedConfigs.length} configurations updated successfully`,
        data: updatedConfigs,
      });
    } catch (error: any) {
      console.error("❌ Bulk update platform configs error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to bulk update platform configurations",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/platform/types
  static async getConfigTypes(req: Request, res: Response) {
    try {
      if (!(await PlatformConfigController.verifySystemAdmin(req, res))) return;

      res.json({
        success: true,
        data: {
          config_types: Object.values(ConfigType),
          data_types: Object.values(ConfigDataType),
        },
      });
    } catch (error: any) {
      console.error("❌ Get config types error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch configuration types",
        error: error.message,
      });
    }
  }
}