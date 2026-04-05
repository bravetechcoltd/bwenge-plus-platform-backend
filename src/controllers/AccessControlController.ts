import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Role } from "../database/models/Role";
import { UserRole } from "../database/models/UserRole";
import { User } from "../database/models/User";
import { Institution } from "../database/models/Institution";
import { PERMISSIONS } from "../database/models/Permission";
import { AccessControlService } from "../services/accessControlService";
import { AuditLogService } from "../services/auditLogService";
import { AuditLogAction } from "../database/models/AuditLog";
import { Not, IsNull } from "typeorm";
import { emitToUser } from "../socket/socketEmitter";

export class AccessControlController {
  // ==================== ROLE MANAGEMENT ====================

  static async getRoles(req: Request, res: Response) {
    try {
      const { institutionId, includeSystem } = req.query;
      const userId = req.user?.userId || req.user?.id;

      const roles = await AccessControlService.getRoles(
        institutionId as string || null,
        includeSystem !== 'false'
      );

      // Get user counts for each role
      const rolesWithCounts = await Promise.all(
        roles.map(async (role) => {
          const userCount = await dbConnection
            .getRepository(UserRole)
            .count({ where: { role_id: role.id } });
          
          return {
            ...role,
            user_count: userCount,
          };
        })
      );

      res.json({
        success: true,
        data: {
          roles: rolesWithCounts,
          all_permissions: PERMISSIONS,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch roles",
        error: error.message,
      });
    }
  }

  static async getRole(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const roleRepo = dbConnection.getRepository(Role);
      const role = await roleRepo.findOne({
        where: { id: id as string },
        relations: ["institution"],
      });

      if (!role) {
        return res.status(404).json({
          success: false,
          message: "Role not found",
        });
      }

      // Get users with this role
      const userRoleRepo = dbConnection.getRepository(UserRole);
      const assignments = await userRoleRepo.find({
        where: { role_id: id as string },
        relations: ["user"],
        take: 100,
      });

      const users = assignments.map(a => ({
        id: a.user.id,
        email: a.user.email,
        first_name: a.user.first_name,
        last_name: a.user.last_name,
        profile_picture_url: a.user.profile_picture_url,
        granted_at: a.granted_at,
        expires_at: a.expires_at,
      }));

      res.json({
        success: true,
        data: {
          ...role,
          users,
          total_users: assignments.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch role",
        error: error.message,
      });
    }
  }

  static async createRole(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { name, display_name, description, permissions, institution_id } = req.body;

      // Validate required fields
      if (!name || !display_name) {
        return res.status(400).json({
          success: false,
          message: "Name and display name are required",
        });
      }

      // Validate permissions
      if (permissions && !Array.isArray(permissions)) {
        return res.status(400).json({
          success: false,
          message: "Permissions must be an array",
        });
      }

      // Check if institution exists if provided
      if (institution_id) {
        const institutionRepo = dbConnection.getRepository(Institution);
        const institution = await institutionRepo.findOne({ where: { id: institution_id } });
        if (!institution) {
          return res.status(404).json({
            success: false,
            message: "Institution not found",
          });
        }
      }

      const role = await AccessControlService.createRole(
        {
          name: name.toUpperCase().replace(/ /g, '_'),
          display_name,
          description,
          permissions: permissions || [],
          institution_id: institution_id || null,
        },
        userId as string,
        req
      );

      res.status(201).json({
        success: true,
        message: "Role created successfully",
        data: role,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create role",
        error: error.message,
      });
    }
  }

  static async updateRole(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;
      const { name, display_name, description, permissions, is_active } = req.body;

      const role = await AccessControlService.updateRole(
        id as string,
        {
          name: name?.toUpperCase().replace(/ /g, '_'),
          display_name,
          description,
          permissions,
          is_active,
        },
        userId as string,
        req
      );

      res.json({
        success: true,
        message: "Role updated successfully",
        data: role,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update role",
        error: error.message,
      });
    }
  }

  static async deleteRole(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      await AccessControlService.deleteRole(id as string, userId as string, req);

      res.json({
        success: true,
        message: "Role deleted successfully",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete role",
        error: error.message,
      });
    }
  }

  // ==================== USER ROLE ASSIGNMENTS ====================

  static async getUserRoles(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { institutionId } = req.query;

      const assignments = await AccessControlService.getUserRoles(
        userId as string,
        institutionId as string || null
      );

      res.json({
        success: true,
        data: assignments,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch user roles",
        error: error.message,
      });
    }
  }

  static async assignRoleToUser(req: Request, res: Response) {
    try {
      const { userId, roleId } = req.params;
      const granterId = req.user?.userId || req.user?.id;
      const { institutionId, expiresAt } = req.body;

      const assignment = await AccessControlService.assignRoleToUser(
        userId as string,
        roleId as string,
        institutionId || null,
        granterId as string,
        expiresAt ? new Date(expiresAt) : undefined,
        req
      );

      // ── Real-time: Notify user about role assignment ──────────────────────
      emitToUser(userId as string, "role-assigned", {
        roleId,
        assignmentId: assignment.id,
      });
      emitToUser(userId as string, "permissions-changed", {
        action: "role-assigned",
        roleId,
      });

      res.json({
        success: true,
        message: "Role assigned successfully",
        data: assignment,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to assign role",
        error: error.message,
      });
    }
  }

  static async removeRoleFromUser(req: Request, res: Response) {
    try {
      const { userId, roleId } = req.params;
      const removerId = req.user?.userId || req.user?.id;
      const { institutionId } = req.body;

      await AccessControlService.removeRoleFromUser(
        userId as string,
        roleId as string,
        institutionId || null,
        removerId as string,
        req
      );

      // ── Real-time: Notify user about role revocation ──────────────────────
      emitToUser(userId as string, "role-revoked", { roleId });
      emitToUser(userId as string, "permissions-changed", {
        action: "role-revoked",
        roleId,
      });

      res.json({
        success: true,
        message: "Role removed successfully",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to remove role",
        error: error.message,
      });
    }
  }

  // ==================== PERMISSION CHECKING ====================

  static async checkPermission(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { permission, institutionId } = req.query;

      if (!permission) {
        return res.status(400).json({
          success: false,
          message: "Permission is required",
        });
      }

      const hasPermission = await AccessControlService.hasPermission(
        userId as string,
        permission as string,
        institutionId as string || null
      );

      res.json({
        success: true,
        data: {
          has_permission: hasPermission,
          permission,
          user_id: userId,
          institution_id: institutionId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to check permission",
        error: error.message,
      });
    }
  }

  static async getUserPermissions(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { institutionId } = req.query;

      const assignments = await AccessControlService.getUserRoles(
        userId as string,
        institutionId as string || null
      );

      // Aggregate all permissions
      const permissions = new Set<string>();
      for (const assignment of assignments) {
        if (assignment.role?.permissions) {
          for (const perm of assignment.role.permissions) {
            permissions.add(perm);
          }
        }
      }

      res.json({
        success: true,
        data: {
          user_id: userId,
          institution_id: institutionId || null,
          permissions: Array.from(permissions),
          roles: assignments.map(a => ({
            role_id: a.role_id,
            role_name: a.role?.name,
            role_display_name: a.role?.display_name,
            granted_at: a.granted_at,
            expires_at: a.expires_at,
          })),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to get user permissions",
        error: error.message,
      });
    }
  }

  // ==================== BULK OPERATIONS ====================

  static async bulkAssignRoles(req: Request, res: Response) {
    try {
      const { userIds, roleId, institutionId, expiresAt } = req.body;
      const granterId = req.user?.userId || req.user?.id;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "User IDs array is required",
        });
      }

      const results = [];
      const errors = [];

      for (const userId of userIds) {
        try {
          const assignment = await AccessControlService.assignRoleToUser(
            userId,
            roleId,
            institutionId || null,
            granterId as string,
            expiresAt ? new Date(expiresAt) : undefined,
            req
          );
          results.push({ userId, success: true, assignment });
        } catch (error: any) {
          errors.push({ userId, error: error.message });
        }
      }

      res.json({
        success: true,
        message: `Assigned role to ${results.length} users, ${errors.length} failed`,
        data: {
          successful: results,
          failed: errors,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to bulk assign roles",
        error: error.message,
      });
    }
  }

  // ==================== ROLE STATISTICS ====================

  static async getRoleStatistics(req: Request, res: Response) {
    try {
      const { institutionId } = req.query;

      const roleRepo = dbConnection.getRepository(Role);
      const userRoleRepo = dbConnection.getRepository(UserRole);

      const roles = await AccessControlService.getRoles(
        institutionId as string || null,
        true
      );

      const stats = {
        total_roles: roles.length,
        system_roles: roles.filter(r => r.is_system_role).length,
        custom_roles: roles.filter(r => !r.is_system_role).length,
        total_assignments: await userRoleRepo.count({
          where: institutionId ? { institution_id: institutionId as string } : {},
        }),
        roles_by_institution: await roleRepo
          .createQueryBuilder("role")
          .select("role.institution_id", "institutionId")
          .addSelect("COUNT(*)", "count")
          .groupBy("role.institution_id")
          .getRawMany(),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch role statistics",
        error: error.message,
      });
    }
  }
}