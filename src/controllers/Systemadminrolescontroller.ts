import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole } from "../database/models/User";
import { In } from "typeorm";

// ─── Permission definitions (authoritative source for the backend) ──────────
export const ALL_PERMISSIONS = [
  "users.view","users.create","users.edit","users.delete",
  "institutions.view","institutions.create","institutions.edit","institutions.delete",
  "courses.view","courses.create","courses.edit","courses.publish","courses.delete",
  "analytics.view","analytics.export",
  "settings.view","settings.edit",
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SYSTEM_ADMIN:     [...ALL_PERMISSIONS] as Permission[],
  INSTITUTION_ADMIN:["users.view","users.create","users.edit","institutions.view","institutions.edit","courses.view","courses.create","courses.edit","courses.publish","analytics.view","analytics.export"],
  CONTENT_CREATOR:  ["courses.view","courses.create","courses.edit","analytics.view"],
  INSTRUCTOR:       ["courses.view","courses.edit","analytics.view"],
  LEARNER:          ["courses.view"],
};

// In-memory role store (roles are defined in code / DB system settings)
// For a production system you'd have a `roles` table; this implementation
// keeps it compatible with the existing User.bwenge_role enum while
// exposing a CRUD-like interface.

interface RoleEntry {
  id: string;
  name: string;
  display_name: string;
  description: string;
  permissions: string[];
  is_system_role: boolean;
  created_at: string;
  updated_at: string;
}

const systemRoles: RoleEntry[] = Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([name, perms], i) => ({
  id: `sys-role-${i + 1}`,
  name,
  display_name: name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
  description: getRoleDescription(name),
  permissions: perms,
  is_system_role: true,
  created_at: new Date("2024-01-01").toISOString(),
  updated_at: new Date().toISOString(),
}));

// Custom roles persisted in memory (replace with DB table in production)
const customRoles: RoleEntry[] = [];

function getRoleDescription(name: string): string {
  const desc: Record<string, string> = {
    SYSTEM_ADMIN:     "Full platform access. Manages all users, institutions, and settings.",
    INSTITUTION_ADMIN:"Manages a single institution, its members, courses, and analytics.",
    CONTENT_CREATOR:  "Creates and manages course content within their institution.",
    INSTRUCTOR:       "Teaches courses and monitors learner progress.",
    LEARNER:          "Accesses and completes available courses on the platform.",
  };
  return desc[name] || "Custom role with specific permissions.";
}

export class SystemAdminRolesController {

  // ── GET /system-admin/roles ──────────────────────────────────────────────
  static async getRoles(req: Request, res: Response) {
    try {
      const userRepo = dbConnection.getRepository(User);
      const allRoles = [...systemRoles, ...customRoles];

      // Enrich with user counts
      const enriched = await Promise.all(allRoles.map(async role => {
        let userCount = 0;
        try {
          // Count users with matching bwenge_role
          const bwengeRoleValue = Object.values(BwengeRole).find(r => r === role.name);
          if (bwengeRoleValue) {
            userCount = await userRepo.count({ where: { bwenge_role: bwengeRoleValue } });
          }
        } catch {
          userCount = 0;
        }
        return { ...role, user_count: userCount };
      }));

      return res.json({
        success: true,
        data: {
          roles: enriched,
          total: enriched.length,
          system_roles: systemRoles.length,
          custom_roles: customRoles.length,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to fetch roles", error: error.message });
    }
  }

  // ── GET /system-admin/roles/:id ──────────────────────────────────────────
  static async getRoleById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const allRoles = [...systemRoles, ...customRoles];
      const role = allRoles.find(r => r.id === id);

      if (!role) return res.status(404).json({ success: false, message: "Role not found" });

      // Fetch users with this role
      const userRepo = dbConnection.getRepository(User);
      const bwengeRoleValue = Object.values(BwengeRole).find(r => r === role.name);
      let users: any[] = [];

      if (bwengeRoleValue) {
        const rawUsers = await userRepo.find({
          where: { bwenge_role: bwengeRoleValue },
          select: ["id", "first_name", "last_name", "email", "is_active", "date_joined"],
          take: 10,
          order: { date_joined: "DESC" },
        });
        users = rawUsers.map(u => ({
          id: u.id,
          name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || "Unknown",
          email: u.email,
          is_active: u.is_active,
          date_joined: u.date_joined,
        }));
      }

      return res.json({
        success: true,
        data: { role: { ...role, user_count: users.length }, sample_users: users },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to fetch role", error: error.message });
    }
  }

  // ── POST /system-admin/roles ─────────────────────────────────────────────
  static async createRole(req: Request, res: Response) {
    try {
      const { name, display_name, description, permissions } = req.body;

      if (!name || !display_name) {
        return res.status(400).json({ success: false, message: "name and display_name are required" });
      }

      // Prevent duplicates
      const allRoles = [...systemRoles, ...customRoles];
      if (allRoles.find(r => r.name.toUpperCase() === name.toUpperCase())) {
        return res.status(409).json({ success: false, message: "A role with this name already exists" });
      }

      // Validate permissions
      const validPerms = (permissions || []).filter((p: string) =>
        (ALL_PERMISSIONS as readonly string[]).includes(p)
      );

      const newRole: RoleEntry = {
        id: `custom-role-${Date.now()}`,
        name: name.toUpperCase().replace(/ /g, "_"),
        display_name,
        description: description || "",
        permissions: validPerms,
        is_system_role: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      customRoles.push(newRole);

      return res.status(201).json({
        success: true,
        message: "Role created successfully",
        data: { role: { ...newRole, user_count: 0 } },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to create role", error: error.message });
    }
  }

  // ── PUT /system-admin/roles/:id ──────────────────────────────────────────
  static async updateRole(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { display_name, description, permissions } = req.body;

      // System roles: only permissions can be changed (not name)
      const sysIdx = systemRoles.findIndex(r => r.id === id);
      const custIdx = customRoles.findIndex(r => r.id === id);

      if (sysIdx === -1 && custIdx === -1) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      const validPerms = (permissions || []).filter((p: string) =>
        (ALL_PERMISSIONS as readonly string[]).includes(p)
      );

      if (sysIdx !== -1) {
        // Only update permissions and display_name for system roles
        systemRoles[sysIdx] = {
          ...systemRoles[sysIdx],
          ...(display_name !== undefined ? { display_name } : {}),
          ...(description !== undefined ? { description } : {}),
          permissions: validPerms.length > 0 ? validPerms : systemRoles[sysIdx].permissions,
          updated_at: new Date().toISOString(),
        };
        return res.json({ success: true, message: "Role updated", data: { role: systemRoles[sysIdx] } });
      }

      customRoles[custIdx] = {
        ...customRoles[custIdx],
        ...(display_name !== undefined ? { display_name } : {}),
        ...(description !== undefined ? { description } : {}),
        permissions: validPerms.length > 0 ? validPerms : customRoles[custIdx].permissions,
        updated_at: new Date().toISOString(),
      };

      return res.json({ success: true, message: "Role updated", data: { role: customRoles[custIdx] } });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to update role", error: error.message });
    }
  }

  // ── DELETE /system-admin/roles/:id ───────────────────────────────────────
  static async deleteRole(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const sysRole = systemRoles.find(r => r.id === id);
      if (sysRole) {
        return res.status(403).json({ success: false, message: "Cannot delete system roles" });
      }

      const custIdx = customRoles.findIndex(r => r.id === id);
      if (custIdx === -1) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      customRoles.splice(custIdx, 1);
      return res.json({ success: true, message: "Role deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to delete role", error: error.message });
    }
  }

  // ── GET /system-admin/roles/permissions ──────────────────────────────────
  static async getPermissions(_req: Request, res: Response) {
    const groups = [
      { group: "User Management",       permissions: ALL_PERMISSIONS.filter(p => p.startsWith("users.")) },
      { group: "Institution Management",permissions: ALL_PERMISSIONS.filter(p => p.startsWith("institutions.")) },
      { group: "Course Management",     permissions: ALL_PERMISSIONS.filter(p => p.startsWith("courses.")) },
      { group: "Analytics & Reports",   permissions: ALL_PERMISSIONS.filter(p => p.startsWith("analytics.")) },
      { group: "System Settings",       permissions: ALL_PERMISSIONS.filter(p => p.startsWith("settings.")) },
    ];
    return res.json({ success: true, data: { permissions: ALL_PERMISSIONS, groups, total: ALL_PERMISSIONS.length } });
  }
}