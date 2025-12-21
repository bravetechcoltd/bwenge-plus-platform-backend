// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import {
  GlobalPolicy,
  PolicyType,
  PolicyStatus,
  PolicyAcceptance,
} from "../database/models/GlobalPolicy";
import { User, BwengeRole } from "../database/models/User";
import { generateSlug } from "../utils/slugify";

export class GlobalPolicyController {
  
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

  // GET /api/system-settings/policies
  static async getAllPolicies(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { type, status, active_only } = req.query;

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const queryBuilder = policyRepo.createQueryBuilder("policy");

      if (type && Object.values(PolicyType).includes(type as PolicyType)) {
        queryBuilder.andWhere("policy.type = :type", { type });
      }

      if (status && Object.values(PolicyStatus).includes(status as PolicyStatus)) {
        queryBuilder.andWhere("policy.status = :status", { status });
      }

      if (active_only === "true") {
        queryBuilder.andWhere("policy.is_active = :is_active", { is_active: true });
      }

      queryBuilder.orderBy("policy.type", "ASC").addOrderBy("policy.created_at", "DESC");

      const policies = await queryBuilder.getMany();

      // Get latest version for each type
      const latestVersions = await policyRepo
        .createQueryBuilder("policy")
        .select("DISTINCT ON (policy.type) policy.*")
        .orderBy("policy.type")
        .addOrderBy("policy.created_at", "DESC")
        .getMany();

      res.json({
        success: true,
        data: {
          policies,
          latest_versions: latestVersions,
        },
      });
    } catch (error: any) {
      console.error("❌ Get policies error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch policies",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/policies/:id
  static async getPolicyById(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const policy = await policyRepo.findOne({ where: { id } });

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found",
        });
      }

      res.json({
        success: true,
        data: policy,
      });
    } catch (error: any) {
      console.error("❌ Get policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch policy",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/policies/type/:type/latest
  static async getLatestPolicyByType(req: Request, res: Response) {
    try {
      const { type } = req.params;

      if (!Object.values(PolicyType).includes(type as PolicyType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid policy type",
        });
      }

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const policy = await policyRepo.findOne({
        where: {
          type: type as PolicyType,
          status: PolicyStatus.PUBLISHED,
          is_active: true,
        },
        order: { created_at: "DESC" },
      });

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "No published policy found for this type",
        });
      }

      res.json({
        success: true,
        data: policy,
      });
    } catch (error: any) {
      console.error("❌ Get latest policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch latest policy",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/policies
  static async createPolicy(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const {
        type,
        title,
        content,
        summary,
        sections,
        effective_date,
        expiry_date,
        requires_acceptance,
        metadata,
      } = req.body;

      const userId = req.user?.userId || req.user?.id;

      // Validate
      if (!type || !title || !content) {
        return res.status(400).json({
          success: false,
          message: "Type, title, and content are required",
        });
      }

      const policyRepo = dbConnection.getRepository(GlobalPolicy);

      // Get latest version for this type
      const latestPolicy = await policyRepo.findOne({
        where: { type },
        order: { created_at: "DESC" },
      });

      const nextVersion = latestPolicy
        ? incrementVersion(latestPolicy.version)
        : "1.0.0";

      const policy = policyRepo.create({
        type,
        title,
        slug: generateSlug(title),
        version: nextVersion,
        content,
        summary,
        sections: sections || [],
        status: PolicyStatus.DRAFT,
        effective_date: effective_date || new Date(),
        expiry_date,
        requires_acceptance: requires_acceptance !== undefined ? requires_acceptance : true,
        metadata: {
          ...metadata,
          created_by: userId,
        },
        change_log: [
          {
            version: nextVersion,
            date: new Date(),
            changes: ["Initial version"],
            author: userId,
          },
        ],
      });

      await policyRepo.save(policy);

      res.status(201).json({
        success: true,
        message: "Policy created successfully",
        data: policy,
      });
    } catch (error: any) {
      console.error("❌ Create policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create policy",
        error: error.message,
      });
    }
  }

  // PUT /api/system-settings/policies/:id
  static async updatePolicy(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const {
        title,
        content,
        summary,
        sections,
        status,
        effective_date,
        expiry_date,
        requires_acceptance,
        metadata,
        is_active,
      } = req.body;

      const userId = req.user?.userId || req.user?.id;

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const policy = await policyRepo.findOne({ where: { id } });

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found",
        });
      }

      // Update fields
      if (title !== undefined) policy.title = title;
      if (content !== undefined) policy.content = content;
      if (summary !== undefined) policy.summary = summary;
      if (sections !== undefined) policy.sections = sections;
      if (effective_date !== undefined) policy.effective_date = effective_date;
      if (expiry_date !== undefined) policy.expiry_date = expiry_date;
      if (requires_acceptance !== undefined) policy.requires_acceptance = requires_acceptance;
      if (is_active !== undefined) policy.is_active = is_active;

      // Handle status change
      if (status !== undefined && status !== policy.status) {
        policy.status = status;
        if (status === PolicyStatus.PUBLISHED) {
          policy.published_at = new Date();
          policy.published_by_user_id = userId;
        }
      }

      // Add to change log if content changed
      if (content !== policy.content) {
        if (!policy.change_log) policy.change_log = [];
        policy.change_log.push({
          version: incrementPatchVersion(policy.version),
          date: new Date(),
          changes: ["Content updated"],
          author: userId,
        });
      }

      // Merge metadata
      if (metadata) {
        policy.metadata = { ...policy.metadata, ...metadata, updated_by: userId };
      }

      await policyRepo.save(policy);

      res.json({
        success: true,
        message: "Policy updated successfully",
        data: policy,
      });
    } catch (error: any) {
      console.error("❌ Update policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update policy",
        error: error.message,
      });
    }
  }

  // DELETE /api/system-settings/policies/:id
  static async deletePolicy(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const policy = await policyRepo.findOne({ where: { id } });

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found",
        });
      }

      // Check if policy has acceptances
      const acceptanceRepo = dbConnection.getRepository(PolicyAcceptance);
      const acceptanceCount = await acceptanceRepo.count({ where: { policy_id: id } });

      if (acceptanceCount > 0) {
        // Soft delete - just archive
        policy.is_active = false;
        policy.status = PolicyStatus.ARCHIVED;
        await policyRepo.save(policy);

        return res.json({
          success: true,
          message: "Policy archived (has acceptance records)",
          data: policy,
        });
      }

      // Hard delete if no acceptances
      await policyRepo.remove(policy);

      res.json({
        success: true,
        message: "Policy deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete policy",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/policies/:id/publish
  static async publishPolicy(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const { effective_date } = req.body;

      const userId = req.user?.userId || req.user?.id;

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const policy = await policyRepo.findOne({ where: { id } });

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found",
        });
      }

      if (policy.status === PolicyStatus.PUBLISHED) {
        return res.status(400).json({
          success: false,
          message: "Policy is already published",
        });
      }

      policy.status = PolicyStatus.PUBLISHED;
      policy.published_at = new Date();
      policy.published_by_user_id = userId;
      if (effective_date) {
        policy.effective_date = new Date(effective_date);
      }

      await policyRepo.save(policy);

      res.json({
        success: true,
        message: "Policy published successfully",
        data: policy,
      });
    } catch (error: any) {
      console.error("❌ Publish policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to publish policy",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/policies/:id/archive
  static async archivePolicy(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const policyRepo = dbConnection.getRepository(GlobalPolicy);
      const policy = await policyRepo.findOne({ where: { id } });

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found",
        });
      }

      policy.status = PolicyStatus.ARCHIVED;
      policy.is_active = false;

      await policyRepo.save(policy);

      res.json({
        success: true,
        message: "Policy archived successfully",
        data: policy,
      });
    } catch (error: any) {
      console.error("❌ Archive policy error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to archive policy",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/policies/:id/acceptances
  static async getPolicyAcceptances(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const acceptanceRepo = dbConnection.getRepository(PolicyAcceptance);

      const total = await acceptanceRepo.count({ where: { policy_id: id } });
      const acceptances = await acceptanceRepo
        .createQueryBuilder("acceptance")
        .leftJoinAndSelect("acceptance.policy", "policy")
        .where("acceptance.policy_id = :id", { id })
        .orderBy("acceptance.accepted_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      res.json({
        success: true,
        data: {
          acceptances,
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
      console.error("❌ Get policy acceptances error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch policy acceptances",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/policies/types
  static async getPolicyTypes(req: Request, res: Response) {
    try {
      if (!(await GlobalPolicyController.verifySystemAdmin(req, res))) return;

      res.json({
        success: true,
        data: {
          types: Object.values(PolicyType).map(type => ({
            value: type,
            label: type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
          })),
          statuses: Object.values(PolicyStatus),
        },
      });
    } catch (error: any) {
      console.error("❌ Get policy types error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch policy types",
        error: error.message,
      });
    }
  }
}

// Helper functions
function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

function incrementPatchVersion(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}