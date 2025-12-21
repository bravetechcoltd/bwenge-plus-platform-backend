import dbConnection from "../database/db";
import { Role } from "../database/models/Role";
import { UserRole } from "../database/models/UserRole";
import { User } from "../database/models/User";
import { Institution } from "../database/models/Institution";
import { AuditLogService } from "./auditLogService";
import { AuditLogAction } from "../database/models/AuditLog";
import { Request } from "express";

export class AccessControlService {
  static async getRoles(
    institutionId?: string | null,
    includeSystemRoles: boolean = true
  ): Promise<Role[]> {
    const roleRepo = dbConnection.getRepository(Role);
    
    const where: any[] = [];
    
    if (institutionId) {
      where.push({ institution_id: institutionId });
    }
    
    if (includeSystemRoles) {
      where.push({ is_system_role: true, institution_id: null });
    }

    return await roleRepo.find({
      where: where.length > 0 ? where : undefined,
      order: { display_name: "ASC" },
    });
  }

  static async createRole(
    data: Partial<Role>,
    createdBy: string,
    req?: Request
  ): Promise<Role> {
    const roleRepo = dbConnection.getRepository(Role);
    
    // Check if role with same name exists in institution
    const where: any = { name: data.name };
    if (data.institution_id) {
      where.institution_id = data.institution_id;
    } else {
      where.institution_id = null;
    }
    
    const existing = await roleRepo.findOne({ where });

    if (existing) {
      throw new Error("Role with this name already exists");
    }

    const role = roleRepo.create({
      ...data,
      is_system_role: false,
      user_count: 0,
    });

    const saved = await roleRepo.save(role);

    // Audit log
    if (req) {
      await AuditLogService.logWithRequest(req, AuditLogAction.ROLE_CREATED, {
        institutionId: data.institution_id,
        action: AuditLogAction.ROLE_CREATED,
        metadata: {
          role_id: saved.id,
          role_name: saved.name,
          permissions_count: saved.permissions.length,
        },
      });
    }

    return saved;
  }

  static async updateRole(
    roleId: string,
    data: Partial<Role>,
    updatedBy: string,
    req?: Request
  ): Promise<Role> {
    const roleRepo = dbConnection.getRepository(Role);
    
    const role = await roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new Error("Role not found");
    }

    if (role.is_system_role) {
      throw new Error("Cannot modify system roles");
    }

    // Store old values for audit
    const oldValues = {
      name: role.name,
      display_name: role.display_name,
      description: role.description,
      permissions: [...role.permissions],
      is_active: role.is_active,
    };

    // Update
    Object.assign(role, data);
    const updated = await roleRepo.save(role);

    // Audit log
    if (req) {
      await AuditLogService.logWithRequest(req, AuditLogAction.ROLE_UPDATED, {
        institutionId: role.institution_id,
        action: AuditLogAction.ROLE_UPDATED,
        metadata: {
          role_id: role.id,
          role_name: role.name,
          changes: {
            name: { old: oldValues.name, new: updated.name },
            display_name: { old: oldValues.display_name, new: updated.display_name },
            permissions_added: updated.permissions.filter(p => !oldValues.permissions.includes(p)),
            permissions_removed: oldValues.permissions.filter(p => !updated.permissions.includes(p)),
          },
        },
      });
    }

    return updated;
  }

  static async deleteRole(roleId: string, deletedBy: string, req?: Request): Promise<void> {
    const roleRepo = dbConnection.getRepository(Role);
    const userRoleRepo = dbConnection.getRepository(UserRole);
    
    const role = await roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new Error("Role not found");
    }

    if (role.is_system_role) {
      throw new Error("Cannot delete system roles");
    }

    if (role.user_count && role.user_count > 0) {
      throw new Error(`Cannot delete role with ${role.user_count} assigned users`);
    }

    // Delete all user role assignments
    await userRoleRepo.delete({ role_id: roleId });

    // Delete role
    await roleRepo.remove(role);

    // Audit log
    if (req) {
      await AuditLogService.logWithRequest(req, AuditLogAction.ROLE_DELETED, {
        institutionId: role.institution_id,
        action: AuditLogAction.ROLE_DELETED,
        metadata: {
          role_id: role.id,
          role_name: role.name,
        },
      });
    }
  }

  static async assignRoleToUser(
    userId: string,
    roleId: string,
    institutionId: string | null,
    grantedBy: string,
    expiresAt?: Date,
    req?: Request
  ): Promise<UserRole> {
    const userRoleRepo = dbConnection.getRepository(UserRole);
    const roleRepo = dbConnection.getRepository(Role);
    const userRepo = dbConnection.getRepository(User);

    // Check if assignment already exists
    const where: any = { user_id: userId, role_id: roleId };
    if (institutionId !== null) {
      where.institution_id = institutionId;
    } else {
      where.institution_id = null;
    }
    
    const existing = await userRoleRepo.findOne({ where });

    if (existing) {
      throw new Error("User already has this role");
    }

    // Get role for metadata
    const role = await roleRepo.findOne({ where: { id: roleId } });
    const user = await userRepo.findOne({ where: { id: userId } });

    // Create assignment
    const assignment = userRoleRepo.create({
      user_id: userId,
      role_id: roleId,
      institution_id: institutionId,
      granted_by: {
        user_id: grantedBy,
        user_email: (req?.user as any)?.email || grantedBy,
      },
      expires_at: expiresAt || null,
    });

    const saved = await userRoleRepo.save(assignment);

    // Update user count on role
    if (role) {
      role.user_count = (role.user_count || 0) + 1;
      await roleRepo.save(role);
    }

    // Audit log
    if (req) {
      await AuditLogService.logWithRequest(req, AuditLogAction.ROLE_ASSIGNED, {
        institutionId,
        action: AuditLogAction.ROLE_ASSIGNED,
        metadata: {
          user_id: userId,
          user_email: user?.email,
          role_id: roleId,
          role_name: role?.name,
          expires_at: expiresAt,
        },
      });
    }

    return saved;
  }

  static async removeRoleFromUser(
    userId: string,
    roleId: string,
    institutionId: string | null,
    removedBy: string,
    req?: Request
  ): Promise<void> {
    const userRoleRepo = dbConnection.getRepository(UserRole);
    const roleRepo = dbConnection.getRepository(Role);

    const where: any = { user_id: userId, role_id: roleId };
    if (institutionId !== null) {
      where.institution_id = institutionId;
    } else {
      where.institution_id = null;
    }

    const assignment = await userRoleRepo.findOne({ where });

    if (!assignment) {
      throw new Error("Role assignment not found");
    }

    // Get role for metadata
    const role = await roleRepo.findOne({ where: { id: roleId } });

    await userRoleRepo.remove(assignment);

    // Update user count on role
    if (role) {
      role.user_count = Math.max(0, (role.user_count || 0) - 1);
      await roleRepo.save(role);
    }

    // Audit log
    if (req) {
      await AuditLogService.logWithRequest(req, AuditLogAction.ROLE_REVOKED, {
        institutionId,
        action: AuditLogAction.ROLE_REVOKED,
        metadata: {
          user_id: userId,
          role_id: roleId,
          role_name: role?.name,
        },
      });
    }
  }

  static async getUserRoles(
    userId: string,
    institutionId?: string | null
  ): Promise<UserRole[]> {
    const userRoleRepo = dbConnection.getRepository(UserRole);
    
    const where: any = { user_id: userId };
    
    if (institutionId !== undefined) {
      where.institution_id = institutionId;
    }

    return await userRoleRepo.find({
      where,
      relations: ["role"],
      order: { granted_at: "DESC" },
    });
  }

  static async hasPermission(
    userId: string,
    permission: string,
    institutionId?: string | null
  ): Promise<boolean> {
    const userRoleRepo = dbConnection.getRepository(UserRole);
    
    // Get all user roles (system-wide and institution-specific)
    const where: any[] = [{ user_id: userId }];
    
    if (institutionId) {
      where.push({ user_id: userId, institution_id: institutionId });
      where.push({ user_id: userId, institution_id: null }); // System roles
    }

    const assignments = await userRoleRepo.find({
      where,
      relations: ["role"],
    });

    // Check each role's permissions
    for (const assignment of assignments) {
      if (assignment.role?.permissions?.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  static async getUsersWithRole(
    roleId: string,
    institutionId?: string | null
  ): Promise<User[]> {
    const userRoleRepo = dbConnection.getRepository(UserRole);
    
    const where: any = { role_id: roleId };
    if (institutionId) {
      where.institution_id = institutionId;
    } else {
      where.institution_id = null;
    }
    
    const assignments = await userRoleRepo.find({
      where,
      relations: ["user"],
    });

    return assignments.map(a => a.user).filter(Boolean);
  }
}