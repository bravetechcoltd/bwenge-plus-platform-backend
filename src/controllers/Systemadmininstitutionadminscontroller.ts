
// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole, InstitutionRole } from "../database/models/User";
import { Institution } from "../database/models/Institution";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { Course } from "../database/models/Course";
import { Enrollment } from "../database/models/Enrollment";
import { In } from "typeorm";
import { subDays } from "date-fns";

export class SystemAdminInstitutionAdminsController {

  // ── GET /system-admin/institution-admins ──────────────────────────────────
  static async getInstitutionAdmins(req: Request, res: Response) {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        is_active,
        institution_id,
        sort_by = "date_joined",
        sort_order = "DESC",
      } = req.query;

      const userRepo       = dbConnection.getRepository(User);
      const memberRepo     = dbConnection.getRepository(InstitutionMember);
      const courseRepo     = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // Fetch all institution admin members
      const adminMemberQuery = memberRepo.createQueryBuilder("m")
        .leftJoinAndSelect("m.user", "u")
        .leftJoinAndSelect("m.institution", "i")
        .where("m.role = :role", { role: InstitutionMemberRole.ADMIN });

      if (institution_id && institution_id !== "all") {
        adminMemberQuery.andWhere("m.institution_id = :institutionId", { institutionId: institution_id });
      }

      if (is_active !== undefined && is_active !== "all") {
        const activeVal = is_active === "true";
        adminMemberQuery.andWhere("m.is_active = :isActive", { isActive: activeVal });
      }

      const allAdminMembers = await adminMemberQuery.getMany();

      // Apply search filter
      let filtered = allAdminMembers.filter(m => m.user && m.institution);

      if (search) {
        const q = (search as string).toLowerCase();
        filtered = filtered.filter(m =>
          `${m.user.first_name} ${m.user.last_name} ${m.user.email} ${m.institution?.name}`
            .toLowerCase().includes(q)
        );
      }

      // Pagination
      const total      = filtered.length;
      const totalPages = Math.ceil(total / Number(limit));
      const offset     = (Number(page) - 1) * Number(limit);
      const paginated  = filtered.slice(offset, offset + Number(limit));

      // Enrich with stats
      const admins = await Promise.all(paginated.map(async m => {
        const instId = m.institution_id;

        const [totalMembers, totalCourses, totalEnrollments, activeMembers] = await Promise.all([
          memberRepo.count({ where: { institution_id: instId } }),
          courseRepo.count({ where: { institution_id: instId } }),
          enrollmentRepo.count({ where: { institution_id: instId } }),
          memberRepo.count({ where: { institution_id: instId, is_active: true } }),
        ]);

        return {
          id:               m.id,
          user_id:          m.user.id,
          first_name:       m.user.first_name || "",
          last_name:        m.user.last_name  || "",
          email:            m.user.email,
          phone_number:     m.user.phone_number,
          profile_picture_url: m.user.profile_picture_url,
          institution_id:   m.institution.id,
          institution_name: m.institution.name,
          institution_type: m.institution.type,
          institution_logo: m.institution.logo_url,
          role:             m.role,
          is_active:        m.is_active,
          date_joined:      m.joined_at,
          last_login:       m.user.last_login,
          stats: { total_members: totalMembers, total_courses: totalCourses, total_enrollments: totalEnrollments, active_members: activeMembers },
        };
      }));

      // Summary stats
      const allAdminUsers = allAdminMembers.filter(m => m.user && m.institution);
      const uniqueInstitutions = new Set(allAdminMembers.map(m => m.institution_id)).size;
      const activeAdmins = allAdminMembers.filter(m => m.is_active).length;
      const avgMembers = admins.length > 0
        ? Math.round(admins.reduce((s, a) => s + a.stats.total_members, 0) / admins.length)
        : 0;

      return res.json({
        success: true,
        data: {
          admins,
          pagination:  { page: Number(page), limit: Number(limit), total, totalPages },
          stats: {
            total_admins:         total,
            active_admins:        activeAdmins,
            institutions_managed: uniqueInstitutions,
            avg_members_per_admin: avgMembers,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to fetch institution admins", error: error.message });
    }
  }

  // ── GET /system-admin/institution-admins/:userId ──────────────────────────
  static async getInstitutionAdminDetails(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const userRepo   = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);

      const user = await userRepo.findOne({
        where: { id: userId },
        relations: ["profile", "institution_memberships", "institution_memberships.institution"],
      });

      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const adminMemberships = user.institution_memberships?.filter(
        m => m.role === InstitutionMemberRole.ADMIN
      ) || [];

      return res.json({
        success: true,
        data: {
          user: {
            id:          user.id,
            first_name:  user.first_name,
            last_name:   user.last_name,
            email:       user.email,
            bwenge_role: user.bwenge_role,
            is_active:   user.is_active,
            date_joined: user.date_joined,
            last_login:  user.last_login,
            profile:     user.profile,
          },
          admin_memberships: adminMemberships.map(m => ({
            institution_id:   m.institution_id,
            institution_name: m.institution?.name,
            institution_type: m.institution?.type,
            is_active:        m.is_active,
            joined_at:        m.joined_at,
          })),
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to fetch admin details", error: error.message });
    }
  }

  // ── POST /system-admin/institution-admins/assign ──────────────────────────
  static async assignInstitutionAdmin(req: Request, res: Response) {
    try {
      const { user_id, institution_id } = req.body;

      if (!user_id || !institution_id) {
        return res.status(400).json({ success: false, message: "user_id and institution_id are required" });
      }

      const userRepo   = dbConnection.getRepository(User);
      const instRepo   = dbConnection.getRepository(Institution);
      const memberRepo = dbConnection.getRepository(InstitutionMember);

      // Validate user and institution exist
      const [user, institution] = await Promise.all([
        userRepo.findOne({ where: { id: user_id } }),
        instRepo.findOne({ where: { id: institution_id } }),
      ]);

      if (!user)        return res.status(404).json({ success: false, message: "User not found" });
      if (!institution) return res.status(404).json({ success: false, message: "Institution not found" });

      // Check for existing membership
      const existing = await memberRepo.findOne({ where: { user_id, institution_id } });

      if (existing) {
        if (existing.role === InstitutionMemberRole.ADMIN) {
          return res.status(409).json({ success: false, message: "User is already an admin of this institution" });
        }
        // Upgrade role
        existing.role = InstitutionMemberRole.ADMIN;
        existing.is_active = true;
        await memberRepo.save(existing);
      } else {
        // Create new membership
        const newMember = memberRepo.create({
          user_id,
          institution_id,
          role: InstitutionMemberRole.ADMIN,
          is_active: true,
        });
        await memberRepo.save(newMember);
      }

      // Update user fields
      await userRepo.createQueryBuilder()
        .update(User)
        .set({
          bwenge_role:            BwengeRole.INSTITUTION_ADMIN,
          institution_role:       InstitutionRole.ADMIN,
          primary_institution_id: institution_id,
          is_institution_member:  true,
        })
        .where("id = :id", { id: user_id })
        .execute();

      return res.status(201).json({
        success: true,
        message: `${user.first_name} ${user.last_name} assigned as admin of ${institution.name}`,
        data: { user_id, institution_id, role: InstitutionMemberRole.ADMIN },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to assign admin", error: error.message });
    }
  }

  // ── PATCH /system-admin/institution-admins/:userId/toggle-status ──────────
  static async toggleAdminStatus(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { institution_id } = req.query;

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const query: any = { user_id: userId, role: InstitutionMemberRole.ADMIN };
      if (institution_id) query.institution_id = institution_id;

      const member = await memberRepo.findOne({ where: query });
      if (!member) return res.status(404).json({ success: false, message: "Admin membership not found" });

      member.is_active = !member.is_active;
      await memberRepo.save(member);

      return res.json({
        success: true,
        message: `Admin ${member.is_active ? "activated" : "deactivated"}`,
        data: { is_active: member.is_active },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to toggle status", error: error.message });
    }
  }

  // ── DELETE /system-admin/institution-admins/:userId ───────────────────────
  static async removeInstitutionAdmin(req: Request, res: Response) {
    try {
      const { userId }       = req.params;
      const { institution_id } = req.query;

      if (!institution_id) {
        return res.status(400).json({ success: false, message: "institution_id query param is required" });
      }

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const userRepo   = dbConnection.getRepository(User);

      const member = await memberRepo.findOne({
        where: { user_id: userId, institution_id: institution_id as string, role: InstitutionMemberRole.ADMIN },
      });

      if (!member) return res.status(404).json({ success: false, message: "Admin membership not found" });

      // Downgrade role to MEMBER instead of hard-deleting
      member.role = InstitutionMemberRole.MEMBER;
      await memberRepo.save(member);

      // Check if user still has any admin memberships
      const remainingAdminMemberships = await memberRepo.count({
        where: { user_id: userId, role: InstitutionMemberRole.ADMIN },
      });

      if (remainingAdminMemberships === 0) {
        // Downgrade bwenge_role to LEARNER
        await userRepo.createQueryBuilder()
          .update(User)
          .set({ bwenge_role: BwengeRole.LEARNER, institution_role: InstitutionRole.MEMBER })
          .where("id = :id", { id: userId })
          .execute();
      }

      return res.json({ success: true, message: "Admin privileges removed successfully" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to remove admin", error: error.message });
    }
  }
}