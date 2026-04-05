import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import dbConnection from "../database/db";
import { User, BwengeRole, AccountType, InstitutionRole, ApplicationStatus } from "../database/models/User";
import { UserSession, SystemType } from "../database/models/UserSession";
import { MoreThan } from "typeorm";
import { UserProfile } from "../database/models/UserProfile";
import { UploadToCloud } from "../services/cloudinary";
import { InstitutionMemberRole } from "../database/models/InstitutionMember";
import {
  generateOTP,
  sendVerificationOTP,
  sendPasswordChangeOTP,
  sendEmailVerifiedNotification,
  sendBwengeWelcomeOTP,
  sendApplicationReceivedEmail,
  sendAdminNewApplicationEmail,
  sendAccountActivatedEmail,
  sendAccountRejectedEmail,
} from "../services/emailTemplates";
import { Otp } from "../database/models/Otp";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX HELPER: Reliably mark a user as logged-in and stamp timestamps.
// Called at the END of every login path so the isUserLogin flag is ALWAYS set.
// ─────────────────────────────────────────────────────────────────────────────
async function markUserLoggedIn(userId: string): Promise<void> {
  const userRepo = dbConnection.getRepository(User);
  await userRepo
    .createQueryBuilder()
    .update(User)
    .set({
      isUserLogin: true,
      last_login: new Date(),
      last_login_bwenge: new Date(),
    })
    .where("id = :id", { id: userId })
    .execute();
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX HELPER: Create or reuse sessions for both BwengePlus and Ongera.
// Prevents duplicate sessions and ensures session table is always consistent.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureSessions(userId: string, req: Request): Promise<void> {
  const sessionRepo = dbConnection.getRepository(UserSession);

  // BwengePlus session
  const existingBwenge = await sessionRepo.findOne({
    where: {
      user_id: userId,
      system: SystemType.BWENGE_PLUS,
      is_active: true,
      expires_at: MoreThan(new Date()),
    },
  });

  if (!existingBwenge) {
    const bwengeSession = sessionRepo.create({
      user_id: userId,
      system: SystemType.BWENGE_PLUS,
      session_token: crypto.randomBytes(32).toString("hex"),
      device_info: req.headers["user-agent"] || "",
      ip_address: req.ip,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      is_active: true,
    });
    await sessionRepo.save(bwengeSession);
  } else {
  }

  // Ongera SSO session
  const existingOngera = await sessionRepo.findOne({
    where: {
      user_id: userId,
      system: SystemType.ONGERA,
      is_active: true,
      expires_at: MoreThan(new Date()),
    },
  });

  if (!existingOngera) {
    const ongeraSession = sessionRepo.create({
      user_id: userId,
      system: SystemType.ONGERA,
      session_token: crypto.randomBytes(32).toString("hex"),
      device_info: req.headers["user-agent"] || "",
      ip_address: req.ip,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      is_active: true,
    });
    await sessionRepo.save(ongeraSession);
  } else {
  }
}

export class BwengePlusAuthController {

  // ===========================================================================
  // GOOGLE ONE TAP LOGIN
  // ===========================================================================
  static async googleOneTapLogin(req: Request, res: Response) {

    try {
      const { credential } = req.body;

      // Validate input
      if (!credential) {
        return res.status(400).json({
          success: false,
          message: "Google credential is required"
        });
      }


      // Verify the Google token
      let ticket;
      try {
        ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
      } catch (verifyError: any) {
        return res.status(400).json({
          success: false,
          message: "Invalid Google token",
          error: process.env.NODE_ENV === 'development' ? verifyError.message : undefined
        });
      }

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return res.status(400).json({
          success: false,
          message: "Invalid Google token - missing email"
        });
      }


      const email = payload.email;
      const googleId = payload.sub;
      const firstName = payload.given_name || "";
      const lastName = payload.family_name || "";
      const profilePicture = payload.picture || "";

      const userRepo = dbConnection.getRepository(User);

      // ==================== CHECK IF USER EXISTS ====================
      let user = await userRepo.findOne({
        where: { email },
        relations: ["profile", "institution_memberships", "institution_memberships.institution"]
      });

      if (user) {

        // ==================== UPDATE EXISTING USER ====================
        const updates: any = {};
        let needsUpdate = false;

        // Update Google auth info if not already set
        if (!user.social_auth_provider) {
          updates.social_auth_provider = "google";
          updates.social_auth_id = googleId;
          needsUpdate = true;
        }

        // Update profile picture if not set
        if (!user.profile_picture_url) {
          updates.profile_picture_url = profilePicture;
          needsUpdate = true;
        }

        // Verify email if not already verified
        if (!user.is_verified) {
          updates.is_verified = true;
          needsUpdate = true;
        }

        // Ensure system identification is set
        if (!user.IsForWhichSystem) {
          updates.IsForWhichSystem = SystemType.BWENGE_PLUS;
          needsUpdate = true;
        }

        // Ensure bwenge role is set
        if (!user.bwenge_role) {
          updates.bwenge_role = BwengeRole.LEARNER;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await userRepo
            .createQueryBuilder()
            .update(User)
            .set(updates)
            .where("id = :id", { id: user.id })
            .execute();
        }

        // Protect the existing role
        if (user.bwenge_role) {
          user.setOriginalBwengeRole(user.bwenge_role);
        }
      } else {
        return res.status(404).json({
          success: false,
          message: "No account found with this Google email. Please apply to join BwengePlus first.",
          code: "NO_ACCOUNT"
        });
      }

      // ==================== CHECK ACCOUNT STATUS ====================
      if (!user.is_active) {
        if (user.application_status === ApplicationStatus.PENDING) {
          return res.status(403).json({
            success: false,
            message: "Your application is pending review by our admin team. You will receive an email once approved.",
            code: "PENDING_APPROVAL"
          });
        }
        if (user.application_status === ApplicationStatus.REJECTED) {
          return res.status(403).json({
            success: false,
            message: "Your application was not approved. Please contact support for more information.",
            code: "APPLICATION_REJECTED",
            rejection_reason: user.rejection_reason || null
          });
        }
        return res.status(403).json({
          success: false,
          message: "Account is deactivated. Please contact support.",
          code: "ACCOUNT_INACTIVE"
        });
      }

      // Protect the existing role
      if (user.bwenge_role) {
        user.setOriginalBwengeRole(user.bwenge_role);
      }

      // ==================== GET INSTITUTION DATA ====================
      let institutionData: any = null;
      let primaryInstitutionId: string | null = null;
      let userInstitutionRole: InstitutionRole | null = null;


      if (user.institution_memberships && user.institution_memberships.length > 0) {
        const activeMemberships = user.institution_memberships.filter(member =>
          member.is_active && member.institution
        );


        if (activeMemberships.length > 0) {
          let primaryMembership: any = null;

          // Priority 1: existing primary_institution_id
          if (user.primary_institution_id) {
            primaryMembership = activeMemberships.find(m =>
              m.institution_id === user.primary_institution_id
            );
          }

          // Priority 2: ADMIN role for INSTITUTION account type
          if (!primaryMembership && user.account_type === AccountType.INSTITUTION) {
            primaryMembership = activeMemberships.find(m =>
              m.role === InstitutionMemberRole.ADMIN
            );
          }

          // Priority 3: first active membership
          if (!primaryMembership) {
            primaryMembership = activeMemberships[0];
          }

          if (primaryMembership && primaryMembership.institution) {
            primaryInstitutionId = primaryMembership.institution.id;

            const roleMapping: Record<InstitutionMemberRole, InstitutionRole> = {
              [InstitutionMemberRole.ADMIN]: InstitutionRole.ADMIN,
              [InstitutionMemberRole.CONTENT_CREATOR]: InstitutionRole.CONTENT_CREATOR,
              [InstitutionMemberRole.INSTRUCTOR]: InstitutionRole.INSTRUCTOR,
              [InstitutionMemberRole.MEMBER]: InstitutionRole.MEMBER,
            };

            const memberRole = primaryMembership.role as InstitutionMemberRole;
            userInstitutionRole = roleMapping[memberRole] || InstitutionRole.MEMBER;

            institutionData = {
              id: primaryMembership.institution.id,
              name: primaryMembership.institution.name,
              slug: primaryMembership.institution.slug,
              type: primaryMembership.institution.type,
              logo_url: primaryMembership.institution.logo_url,
              description: primaryMembership.institution.description,
              is_active: primaryMembership.institution.is_active,
              settings: primaryMembership.institution.settings,
              created_at: primaryMembership.institution.created_at?.toISOString() || null,
              updated_at: primaryMembership.institution.updated_at?.toISOString() || null,
              user_role: userInstitutionRole
            };

          }

          // Update user's institution-related fields
          const institutionIds = activeMemberships.map(m => m.institution_id);

          const updateData: any = {
            is_institution_member: true,
            institution_ids: institutionIds,
          };

          if (primaryInstitutionId !== null) {
            updateData.primary_institution_id = primaryInstitutionId;
          }

          if (userInstitutionRole !== null) {
            updateData.institution_role = userInstitutionRole;
          }

          await userRepo
            .createQueryBuilder()
            .update(User)
            .set(updateData)
            .where("id = :id", { id: user.id })
            .execute();

          user.is_institution_member = true;
          user.institution_ids = institutionIds;

          if (primaryInstitutionId !== null) {
            user.primary_institution_id = primaryInstitutionId;
          }

          if (userInstitutionRole !== null) {
            user.institution_role = userInstitutionRole;
          }

        }
      } else {
      }

      // ==================== CREATE CROSS-SYSTEM SESSIONS ====================

      // ✅ FIX: Use ensureSessions helper — prevents duplicates, guarantees both sessions exist
      await ensureSessions(user.id, req);

      // ✅ FIX: Always call markUserLoggedIn — guarantees isUserLogin=true in DB
      await markUserLoggedIn(user.id);


      // ==================== GENERATE JWT TOKEN ====================
      const tokenPayload: any = {
        userId: user.id,
        email: user.email,
        bwenge_role: user.bwenge_role,
        account_type: user.account_type
      };

      if (primaryInstitutionId) {
        tokenPayload.primary_institution_id = primaryInstitutionId;
        tokenPayload.institution_role = userInstitutionRole;
      }

      const jwtToken = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );


      // ==================== PREPARE RESPONSE ====================
      const responseData: any = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        phone_number: user.phone_number,
        profile_picture_url: user.profile_picture_url,
        bio: user.bio,
        account_type: user.account_type,
        is_verified: user.is_verified,
        country: user.country,
        city: user.city,
        date_joined: user.date_joined?.toISOString() || null,
        last_login: user.last_login?.toISOString() || null,

        bwenge_role: user.bwenge_role,

        is_institution_member: user.is_institution_member || false,
        institution_ids: user.institution_ids || [],
        primary_institution_id: primaryInstitutionId,
        institution_role: userInstitutionRole,
        institution: institutionData,

        spoc_access_codes_used: user.spoc_access_codes_used || [],
        profile: user.profile || null,

        enrolled_courses_count: user.enrolled_courses_count || 0,
        completed_courses_count: user.completed_courses_count || 0,
        total_learning_hours: user.total_learning_hours || 0,
        certificates_earned: user.certificates_earned || 0,
        learning_preferences: user.learning_preferences || null,
        bwenge_profile_completed: user.bwenge_profile_completed || false,
        last_login_bwenge: user.last_login_bwenge?.toISOString() || null,
        updated_at: user.updated_at?.toISOString() || null,

        current_courses: [],
        total_points: 0,
        is_active: user.is_active,
        isUserLogin: true,
        social_auth_provider: user.social_auth_provider,
        social_auth_id: user.social_auth_id
      };


      res.json({
        success: true,
        message: "Google One Tap login successful",
        data: {
          user: responseData,
          token: jwtToken
        }
      });

    } catch (error: any) {

      res.status(500).json({
        success: false,
        message: "Google One Tap login failed",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

  static async register(req: Request, res: Response) {

    try {
      const {
        first_name,
        last_name,
        email,
        password,
        confirm_password,
        country,
        phone_number,
        date_of_birth,
        gender,
        education_level,
        motivation,
        linkedin_url,
      } = req.body;

      // ── Validate required fields ──────────────────────────────────────
      if (!first_name || !last_name || !email || !password || !confirm_password) {
        return res.status(400).json({
          success: false,
          message: "All required fields must be filled",
        });
      }

      if (!motivation || !motivation.trim()) {
        return res.status(400).json({
          success: false,
          message: "Please tell us why you want to join BwengePlus",
        });
      }

      if (password !== confirm_password) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters",
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
        });
      }

      const userRepo = dbConnection.getRepository(User);

      // ── Check for existing email ──────────────────────────────────────
      const existingUser = await userRepo.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "An application with this email already exists",
        });
      }

      // ── Hash password ─────────────────────────────────────────────────
      const password_hash = await bcrypt.hash(password, 12);

      // ── Build username from email ─────────────────────────────────────
      const baseUsername = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      let username = baseUsername;
      let attempt = 0;
      while (await userRepo.findOne({ where: { username } })) {
        attempt++;
        username = `${baseUsername}${attempt}`;
      }

      // ── Create user (inactive, pending approval) ──────────────────────
      const newUser = userRepo.create({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email.toLowerCase().trim(),
        password_hash,
        username,
        phone_number: phone_number || undefined,
        country: country || undefined,
        account_type: AccountType.STUDENT,
        IsForWhichSystem: SystemType.BWENGE_PLUS,
        bwenge_role: BwengeRole.LEARNER,
        is_verified: false,
        is_active: false,                              // not active until admin approves
        application_status: ApplicationStatus.PENDING, // awaiting admin review
        applied_at: new Date(),
        is_institution_member: false,
        institution_ids: [],
      });

      await userRepo.save(newUser);

      // ── Create profile ────────────────────────────────────────────────
      const profileRepo = dbConnection.getRepository(UserProfile);
      const profile = profileRepo.create({
        user: newUser,
        linkedin_url: linkedin_url || null,
      });
      await profileRepo.save(profile);

      // ── Send applicant confirmation email ─────────────────────────────
      try {
        await sendApplicationReceivedEmail(
          newUser.email,
          newUser.first_name,
          newUser.last_name
        );
      } catch (emailErr: any) {
      }

      // ── Notify system admin(s) ────────────────────────────────────────
      try {
        const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
        if (adminEmail) {
          await sendAdminNewApplicationEmail(adminEmail, {
            first_name: newUser.first_name,
            last_name: newUser.last_name,
            email: newUser.email,
            phone_number: phone_number || undefined,
            country: country || undefined,
            date_of_birth: date_of_birth || undefined,
            gender: gender || undefined,
            education_level: education_level || undefined,
            motivation: motivation || undefined,
            linkedin_url: linkedin_url || undefined,
            applied_at: new Date().toLocaleString(),
            applicationId: newUser.id,
          });
        }
      } catch (emailErr: any) {
      }


      return res.status(201).json({
        success: true,
        message: "Your application has been submitted successfully! Our admin team will review it and you will receive an email notification.",
        data: {
          user: {
            id: newUser.id,
            email: newUser.email,
            first_name: newUser.first_name,
            last_name: newUser.last_name,
            application_status: "pending",
          },
          application_submitted: true,
          email: newUser.email,
        },
      });
    } catch (error: any) {

      res.status(500).json({
        success: false,
        message: "Application submission failed. Please try again.",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  }

  // ===========================================================================
  // ADMIN: APPROVE USER APPLICATION
  // ===========================================================================
  static async approveUser(req: Request, res: Response) {
    try {
      const requestingUserId = req.user?.userId || req.user?.id;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required" });
      }

      const userRepo = dbConnection.getRepository(User);

      // Verify requester is SYSTEM_ADMIN
      const requester = await userRepo.findOne({ where: { id: requestingUserId } });
      if (!requester || requester.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({ success: false, message: "Only system admins can approve applications" });
      }

      const applicant = await userRepo.findOne({ where: { id: userId } });
      if (!applicant) {
        return res.status(404).json({ success: false, message: "Applicant not found" });
      }

      if (applicant.application_status === ApplicationStatus.APPROVED && applicant.is_active) {
        return res.status(400).json({ success: false, message: "Application already approved" });
      }

      await userRepo
        .createQueryBuilder()
        .update(User)
        .set({
          is_active: true,
          is_verified: true,
          application_status: ApplicationStatus.APPROVED,
          rejection_reason: () => "NULL",
        })
        .where("id = :id", { id: userId })
        .execute();

      // Send activation email
      try {
        await sendAccountActivatedEmail(applicant.email, applicant.first_name, applicant.last_name);
      } catch (emailErr: any) {
      }


      return res.json({
        success: true,
        message: `Application approved. ${applicant.first_name} ${applicant.last_name} can now log in.`,
        data: { userId, email: applicant.email, application_status: "approved" }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to approve application", error: error.message });
    }
  }

  // ===========================================================================
  // ADMIN: REJECT USER APPLICATION
  // ===========================================================================
  static async rejectUser(req: Request, res: Response) {
    try {
      const requestingUserId = req.user?.userId || req.user?.id;
      const { userId, reason } = req.body;

      if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required" });
      }

      const userRepo = dbConnection.getRepository(User);

      // Verify requester is SYSTEM_ADMIN
      const requester = await userRepo.findOne({ where: { id: requestingUserId } });
      if (!requester || requester.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({ success: false, message: "Only system admins can reject applications" });
      }

      const applicant = await userRepo.findOne({ where: { id: userId } });
      if (!applicant) {
        return res.status(404).json({ success: false, message: "Applicant not found" });
      }

      await userRepo
        .createQueryBuilder()
        .update(User)
        .set({
          is_active: false,
          application_status: ApplicationStatus.REJECTED,
          rejection_reason: reason || null,
        })
        .where("id = :id", { id: userId })
        .execute();

      // Send rejection email
      try {
        await sendAccountRejectedEmail(applicant.email, applicant.first_name, applicant.last_name, reason);
      } catch (emailErr: any) {
      }


      return res.json({
        success: true,
        message: `Application rejected for ${applicant.first_name} ${applicant.last_name}.`,
        data: { userId, email: applicant.email, application_status: "rejected" }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to reject application", error: error.message });
    }
  }

  // ===========================================================================
  // ADMIN: GET ALL APPLICATIONS
  // ===========================================================================
  static async getApplications(req: Request, res: Response) {
    try {
      const requestingUserId = req.user?.userId || req.user?.id;
      const { status, page = "1", limit = "20" } = req.query;

      const userRepo = dbConnection.getRepository(User);

      // Verify requester is SYSTEM_ADMIN
      const requester = await userRepo.findOne({ where: { id: requestingUserId } });
      if (!requester || requester.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({ success: false, message: "Only system admins can view applications" });
      }

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const qb = userRepo.createQueryBuilder("user")
        .leftJoinAndSelect("user.profile", "profile")
        .orderBy("user.applied_at", "DESC")
        .skip(offset)
        .take(limitNum);

      if (status) {
        qb.where("user.application_status = :status", { status });
      } else {
        // Default: show pending first
        qb.where("user.application_status IS NOT NULL");
      }

      const [applications, total] = await qb.getManyAndCount();

      const data = applications.map(u => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        phone_number: u.phone_number,
        country: u.country,
        application_status: u.application_status,
        applied_at: u.applied_at,
        rejection_reason: u.rejection_reason,
        is_active: u.is_active,
        profile: u.profile ? {
          linkedin_url: u.profile.linkedin_url,
          institution_name: u.profile.institution_name,
        } : null,
      }));

      return res.json({
        success: true,
        data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Failed to fetch applications", error: error.message });
    }
  }

// ============================================================
// ADD TO: routes file (authRoutes.ts)
// Place before the export default router line
// ============================================================

  // ===========================================================================
  // CHECK USER EXISTS
  // ===========================================================================
  static async checkUserExists(req: Request, res: Response) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { email },
        select: [
          "id",
          "email",
          "username",
          "first_name",
          "last_name",
          "profile_picture_url",
          "bwenge_role",
          "institution_role",
          "is_institution_member",
        ],
      });

      if (user) {
        return res.json({
          success: true,
          exists: true,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            profile_picture_url: user.profile_picture_url,
            bwenge_role: user.bwenge_role,
            institution_role: user.institution_role,
            is_institution_member: user.is_institution_member,
          },
        });
      }

      return res.json({
        success: true,
        exists: false,
        user: null,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Failed to check user existence",
        error: error.message,
      });
    }
  }

  // ===========================================================================
  // UPDATE PROFILE
  // ===========================================================================
  static async updateProfile(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const userProfileRepo = dbConnection.getRepository(UserProfile);

      // Find user with profile
      const user = await userRepo.findOne({
        where: { id: userId },
        relations: ["profile"]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }


      // Extract fields from request body
      const {
        // User fields
        first_name,
        last_name,
        username,
        phone_number,
        bio,
        country,
        city,

        // Profile fields
        institution_name,
        department,
        academic_level,
        research_interests,
        orcid_id,
        google_scholar_url,
        linkedin_url,
        website_url,
        cv_file_url,
        current_position,
        home_institution,
        willing_to_mentor,

        // Institution fields
        institution_address,
        institution_phone,
        institution_type,
        institution_website,
        institution_description,
        institution_departments,
        institution_founded_year,
        institution_accreditation,

        // Learning preferences
        learning_preferences,
      } = req.body;

      // Update user fields
      const updates: any = {};

      if (first_name !== undefined) user.first_name = first_name;
      if (last_name !== undefined) user.last_name = last_name;
      if (username !== undefined) user.username = username;
      if (phone_number !== undefined) user.phone_number = phone_number;
      if (bio !== undefined) user.bio = bio;
      if (country !== undefined) user.country = country;
      if (city !== undefined) user.city = city;
      if (learning_preferences !== undefined) user.learning_preferences = learning_preferences;

      // Save user updates
      await userRepo.save(user);

      // Handle profile creation/update
      let profile = user.profile;

      if (!profile) {
        // Create new profile if it doesn't exist
        profile = userProfileRepo.create({ user });
      }

      // Update profile fields
      if (institution_name !== undefined) profile.institution_name = institution_name;
      if (department !== undefined) profile.department = department;
      if (academic_level !== undefined) profile.academic_level = academic_level;
      if (research_interests !== undefined) {
        // Handle array of research interests
        if (Array.isArray(research_interests)) {
          profile.research_interests = research_interests;
        } else if (typeof research_interests === 'string') {
          profile.research_interests = JSON.parse(research_interests);
        }
      }
      if (orcid_id !== undefined) profile.orcid_id = orcid_id;
      if (google_scholar_url !== undefined) profile.google_scholar_url = google_scholar_url;
      if (linkedin_url !== undefined) profile.linkedin_url = linkedin_url;
      if (website_url !== undefined) profile.website_url = website_url;
      if (cv_file_url !== undefined) profile.cv_file_url = cv_file_url;
      if (current_position !== undefined) profile.current_position = current_position;
      if (home_institution !== undefined) profile.home_institution = home_institution;
      if (willing_to_mentor !== undefined) profile.willing_to_mentor = willing_to_mentor;

      // Institution-specific fields
      if (institution_address !== undefined) profile.institution_address = institution_address;
      if (institution_phone !== undefined) profile.institution_phone = institution_phone;
      if (institution_type !== undefined) profile.institution_type = institution_type;
      if (institution_website !== undefined) profile.institution_website = institution_website;
      if (institution_description !== undefined) profile.institution_description = institution_description;
      if (institution_departments !== undefined) {
        if (Array.isArray(institution_departments)) {
          profile.institution_departments = institution_departments;
        } else if (typeof institution_departments === 'string') {
          profile.institution_departments = JSON.parse(institution_departments);
        }
      }
      if (institution_founded_year !== undefined) profile.institution_founded_year = institution_founded_year;
      if (institution_accreditation !== undefined) profile.institution_accreditation = institution_accreditation;

      // Save profile
      await userProfileRepo.save(profile);

      // Mark profile as completed if enough info is provided
      if (!user.bwenge_profile_completed) {
        const hasEnoughInfo = (
          user.first_name &&
          user.last_name &&
          user.country &&
          profile.institution_name
        );

        if (hasEnoughInfo) {
          user.bwenge_profile_completed = true;
          await userRepo.save(user);
        }
      }

      // Fetch updated user with profile
      const updatedUser = await userRepo.findOne({
        where: { id: userId },
        relations: ["profile"]
      });

      // Exclude sensitive data
      const { password_hash, ...userData } = updatedUser!;


      res.json({
        success: true,
        message: "Profile updated successfully",
        data: userData
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to update profile",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // ===========================================================================
  // UPLOAD PROFILE PICTURE
  // ===========================================================================
  static async uploadProfilePicture(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded"
        });
      }


      // Upload to Cloudinary
      let profilePictureUrl = "";
      try {
        const uploadResult = await UploadToCloud(req.file);
        profilePictureUrl = uploadResult.secure_url;
      } catch (uploadError: any) {
        return res.status(500).json({
          success: false,
          message: "Failed to upload image to Cloudinary",
          error: uploadError.message
        });
      }

      // Update user profile picture
      const userRepo = dbConnection.getRepository(User);
      await userRepo.update(userId, {
        profile_picture_url: profilePictureUrl
      });


      res.json({
        success: true,
        message: "Profile picture uploaded successfully",
        data: {
          profile_picture_url: profilePictureUrl
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to upload profile picture",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // ===========================================================================
  // UPLOAD CV FILE
  // ===========================================================================
  static async uploadCV(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded"
        });
      }


      // Upload to Cloudinary
      let cvFileUrl = "";
      try {
        const uploadResult = await UploadToCloud(req.file);
        cvFileUrl = uploadResult.secure_url;
      } catch (uploadError: any) {
        return res.status(500).json({
          success: false,
          message: "Failed to upload CV to Cloudinary",
          error: uploadError.message
        });
      }

      // Update user profile CV
      const userProfileRepo = dbConnection.getRepository(UserProfile);

      // Find or create profile
      let profile = await userProfileRepo.findOne({
        where: { user: { id: userId } }
      });

      if (!profile) {
        profile = userProfileRepo.create({
          user: { id: userId } as User,
          cv_file_url: cvFileUrl
        });
      } else {
        profile.cv_file_url = cvFileUrl;
      }

      await userProfileRepo.save(profile);


      res.json({
        success: true,
        message: "CV uploaded successfully",
        data: {
          cv_file_url: cvFileUrl
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to upload CV",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // ===========================================================================
  // GET PROFILE COMPLETION STATUS
  // ===========================================================================
  static async getProfileCompletionStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId },
        relations: ["profile"]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Calculate completion percentage
      const requiredFields = [
        { field: 'first_name', value: user.first_name },
        { field: 'last_name', value: user.last_name },
        { field: 'country', value: user.country },
        { field: 'profile_picture_url', value: user.profile_picture_url },
        { field: 'bio', value: user.bio },
      ];

      const profileFields = user.profile ? [
        { field: 'institution_name', value: user.profile.institution_name },
        { field: 'academic_level', value: user.profile.academic_level },
        { field: 'research_interests', value: user.profile.research_interests },
        { field: 'orcid_id', value: user.profile.orcid_id },
        { field: 'linkedin_url', value: user.profile.linkedin_url },
      ] : [];

      const allFields = [...requiredFields, ...profileFields];
      const completedFields = allFields.filter(field => field.value).length;
      const totalFields = allFields.length;
      const completionPercentage = Math.round((completedFields / totalFields) * 100);

      // Identify missing fields
      const missingFields = allFields
        .filter(field => !field.value)
        .map(field => field.field);

      res.json({
        success: true,
        data: {
          is_completed: user.bwenge_profile_completed,
          completion_percentage: completionPercentage,
          completed_fields: completedFields,
          total_fields: totalFields,
          missing_fields: missingFields,
          profile_exists: !!user.profile
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to get profile completion status",
        error: error.message
      });
    }
  }

  // ===========================================================================
  // UPDATE ACCOUNT TYPE
  // ===========================================================================
  static async updateAccountType(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;
      const { account_type } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      if (!account_type || !Object.values(AccountType).includes(account_type)) {
        return res.status(400).json({
          success: false,
          message: "Valid account type is required"
        });
      }

      const userRepo = dbConnection.getRepository(User);

      // Update account type
      await userRepo.update(userId, {
        account_type: account_type
      });

      // Update bwenge_role based on account type
      const newBwengeRole = mapAccountTypeToBwengeRole(account_type);
      await userRepo.update(userId, {
        bwenge_role: newBwengeRole
      });


      res.json({
        success: true,
        message: "Account type updated successfully",
        data: {
          account_type,
          bwenge_role: newBwengeRole
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to update account type",
        error: error.message
      });
    }
  }

  // ===========================================================================
  // EMAIL / PASSWORD LOGIN
  // ===========================================================================
  static async login(req: Request, res: Response) {

    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required"
        });
      }

      const userRepo = dbConnection.getRepository(User);

      // Query user with proper error handling
      let user;
      try {
        user = await userRepo.findOne({
          where: { email },
          relations: ["profile", "institution_memberships", "institution_memberships.institution"]
        });
      } catch (queryError: any) {

        if (queryError.message.includes('isUserLogin')) {

          user = await userRepo
            .createQueryBuilder("user")
            .leftJoinAndSelect("user.profile", "profile")
            .leftJoinAndSelect("user.institution_memberships", "institution_memberships")
            .leftJoinAndSelect("institution_memberships.institution", "institution")
            .where("user.email = :email", { email })
            .getOne();
        } else {
          throw queryError;
        }
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      // ==================== ✅ ENHANCED: CHECK EXISTING VALUES BEFORE UPDATES ====================

      // ✅ Protect the existing role from accidental changes
      if (user.bwenge_role) {
        user.setOriginalBwengeRole(user.bwenge_role);
      }

      // Check if account is active (handles pending/rejected applications)
      if (!user.is_active) {
        if (user.application_status === ApplicationStatus.PENDING) {
          return res.status(403).json({
            success: false,
            message: "Your application is pending review by our admin team. Please wait for an approval email before trying to log in.",
            code: "PENDING_APPROVAL"
          });
        }
        if (user.application_status === ApplicationStatus.REJECTED) {
          return res.status(403).json({
            success: false,
            message: "Your application was not approved. Please contact support@bwengeplus.rw for more information.",
            code: "APPLICATION_REJECTED",
            rejection_reason: user.rejection_reason || null
          });
        }
        return res.status(403).json({
          success: false,
          message: "Account is deactivated. Please contact support.",
          code: "ACCOUNT_INACTIVE"
        });
      }

      // Check if email is verified
      if (!user.is_verified) {
        return res.status(403).json({
          success: false,
          message: "Email not verified. Please verify your email first.",
          requires_verification: true,
          email: user.email
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }


      // ==================== ✅ ENHANCED: GET INSTITUTION INFORMATION WITH PROTECTION ====================
      let institutionData: any = null;
      let primaryInstitutionId: string | null = user.primary_institution_id; // Preserve existing
      let userInstitutionRole: InstitutionRole | null = user.institution_role; // Preserve existing


      if (user.institution_memberships && user.institution_memberships.length > 0) {
        const activeMemberships = user.institution_memberships.filter(member =>
          member.is_active && member.institution
        );

        if (activeMemberships.length > 0) {
          let primaryMembership: any = null;

          // Priority 1: Use existing primary_institution_id
          if (user.primary_institution_id) {
            primaryMembership = activeMemberships.find(m =>
              m.institution_id === user.primary_institution_id
            );
          }

          // Priority 2: If no match, use first active
          if (!primaryMembership) {
            primaryMembership = activeMemberships[0];
          }

          if (primaryMembership && primaryMembership.institution) {
            // Only update if not already set
            if (!primaryInstitutionId) {
              primaryInstitutionId = primaryMembership.institution.id;
            }

            // Only update role if not already set
            if (!userInstitutionRole) {
              const roleMapping: Record<InstitutionMemberRole, InstitutionRole> = {
                [InstitutionMemberRole.ADMIN]: InstitutionRole.ADMIN,
                [InstitutionMemberRole.CONTENT_CREATOR]: InstitutionRole.CONTENT_CREATOR,
                [InstitutionMemberRole.INSTRUCTOR]: InstitutionRole.INSTRUCTOR,
                [InstitutionMemberRole.MEMBER]: InstitutionRole.MEMBER,
              };

              const memberRole = primaryMembership.role as InstitutionMemberRole;
              userInstitutionRole = roleMapping[memberRole] || InstitutionRole.MEMBER;
            }

            institutionData = {
              id: primaryMembership.institution.id,
              name: primaryMembership.institution.name,
              slug: primaryMembership.institution.slug,
              type: primaryMembership.institution.type,
              logo_url: primaryMembership.institution.logo_url,
              description: primaryMembership.institution.description,
              is_active: primaryMembership.institution.is_active,
              settings: primaryMembership.institution.settings,
              created_at: primaryMembership.institution.created_at?.toISOString() || null,
              updated_at: primaryMembership.institution.updated_at?.toISOString() || null,
              user_role: userInstitutionRole
            };
          }

          // Update institution IDs - MERGE don't replace
          const institutionIds = activeMemberships.map(m => m.institution_id);
          const existingIds = user.institution_ids || [];
          const mergedIds = [...new Set([...existingIds, ...institutionIds])];

          // ==================== ✅ ENHANCED: SYSTEM-AWARE UPDATE ====================
          // Only update fields that are empty or need merging
          await userRepo
            .createQueryBuilder()
            .update(User)
            .set({
              // Bwenge-specific fields only
              bwenge_profile_completed: user.bwenge_profile_completed,

              // Institution fields - ONLY update if empty or merging arrays
              ...(!user.is_institution_member ? { is_institution_member: true } : {}),
              ...(mergedIds.length > existingIds.length ? { institution_ids: mergedIds } : {}),
              ...((!user.primary_institution_id && primaryInstitutionId) ? { primary_institution_id: primaryInstitutionId } : {}),
              ...((!user.institution_role && userInstitutionRole) ? { institution_role: userInstitutionRole } : {}),

              // ✅ NEVER update: IsForWhichSystem, bwenge_role (these are protected in entity)
            })
            .where("id = :id", { id: user.id })
            .execute();

        }
      }

      // ==================== CREATE/UPDATE SESSIONS ====================
      // ✅ FIX: Use ensureSessions helper — prevents duplicates, guarantees both sessions exist
      await ensureSessions(user.id, req);

      // ==================== GENERATE JWT ====================
      const tokenPayload: any = {
        userId: user.id,
        email: user.email,
        bwenge_role: user.bwenge_role,
        account_type: user.account_type,
        system: SystemType.BWENGE_PLUS // ✅ Include system context
      };

      // Include institution data in JWT if available
      if (primaryInstitutionId) {
        tokenPayload.primary_institution_id = primaryInstitutionId;
        tokenPayload.institution_role = userInstitutionRole;
      }

      const token = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );

      // ✅ FIX: Always call markUserLoggedIn — guarantees isUserLogin=true in DB
      await markUserLoggedIn(user.id);

      // ==================== PREPARE RESPONSE DATA ====================
      const responseData: any = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        phone_number: user.phone_number,
        profile_picture_url: user.profile_picture_url,
        bio: user.bio,
        account_type: user.account_type,
        is_verified: user.is_verified,
        country: user.country,
        city: user.city,
        date_joined: user.date_joined?.toISOString() || null,
        last_login: user.last_login?.toISOString() || null,
        last_login_bwenge: user.last_login_bwenge?.toISOString() || null,

        // System identification
        IsForWhichSystem: user.IsForWhichSystem || SystemType.BWENGE_PLUS,

        // BwengePlus role
        bwenge_role: user.bwenge_role,

        // Institution membership data
        is_institution_member: user.is_institution_member || false,
        institution_ids: user.institution_ids || [],
        primary_institution_id: primaryInstitutionId,
        institution_role: userInstitutionRole,

        // Institution details
        institution: institutionData,

        // Profile
        profile: user.profile || null,

        // BwengePlus stats
        enrolled_courses_count: user.enrolled_courses_count || 0,
        completed_courses_count: user.completed_courses_count || 0,
        total_learning_hours: user.total_learning_hours || 0,
        certificates_earned: user.certificates_earned || 0,
        learning_preferences: user.learning_preferences || null,
        bwenge_profile_completed: user.bwenge_profile_completed || false,
        updated_at: user.updated_at?.toISOString() || null,
      };


      res.json({
        success: true,
        message: "Login successful",
        data: {
          user: responseData,
          token
        }
      });

    } catch (error: any) {

      res.status(500).json({
        success: false,
        message: "Login failed",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

  // ===========================================================================
  // SSO CONSUME
  // ===========================================================================
  static async ssoConsume(req: Request, res: Response) {

    try {
      const { token } = req.query;

      if (!token) {
        return res.redirect(`${process.env.CLIENT_URL}/sso/callback?error=missing_token`);
      }


      // ==================== VALIDATE TOKEN WITH ONGERA ====================

      let ongeraResponse;
      try {
        ongeraResponse = await axios.post(
          `${process.env.ONGERA_API_URL}/auth/sso/validate-token`,
          { sso_token: token },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.SSO_SHARED_SECRET}`
            },
            timeout: 10000
          }
        );
      } catch (axiosError: any) {
        return res.redirect(`${process.env.CLIENT_URL}/sso/callback?error=validation_failed`);
      }

      if (!ongeraResponse.data.success) {
        return res.redirect(`${process.env.CLIENT_URL}/sso/callback?error=invalid_token`);
      }

      const userData = ongeraResponse.data.data;

      // ==================== FIND/CREATE USER ====================
      const userRepo = dbConnection.getRepository(User);
      let user = await userRepo.findOne({
        where: { id: userData.user_id },
        relations: ["profile"]
      });

      if (!user) {
        return res.redirect(`${process.env.CLIENT_URL}/sso/callback?error=user_not_found`);
      }


      // ==================== ✅ ENHANCED: PROTECT EXISTING VALUES ====================

      // ✅ CRITICAL: Preserve ALL existing values, only fill missing ones
      const updates: any = {};
      let needsUpdate = false;

      // Ensure IsForWhichSystem is set (preserve existing)
      if (!user.IsForWhichSystem) {
        updates.IsForWhichSystem = SystemType.BWENGE_PLUS;
        needsUpdate = true;
      }

      // Only set bwenge_role if it doesn't exist
      if (!user.bwenge_role) {
        const defaultRole = mapAccountTypeToBwengeRole(user.account_type);
        updates.bwenge_role = defaultRole;
        needsUpdate = true;
      }

      // Update last login timestamp
      updates.last_login_bwenge = new Date();
      needsUpdate = true;

      if (needsUpdate) {
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set(updates)
          .where("id = :id", { id: user.id })
          .execute();
      }

      // ==================== CONSUME TOKEN WITH ONGERA ====================

      try {
        await axios.post(
          `${process.env.ONGERA_API_URL}/auth/sso/consume-token`,
          { sso_token: token },
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );
      } catch (consumeError: any) {
      }

      // ==================== CREATE BWENGEPLUS SESSION ====================
      // ✅ FIX: Use ensureSessions helper — prevents duplicates, guarantees both sessions exist
      await ensureSessions(user.id, req);

      // ✅ FIX: Always call markUserLoggedIn — guarantees isUserLogin=true in DB
      await markUserLoggedIn(user.id);

      // ==================== GENERATE JWT ====================
      const jwtToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          bwenge_role: user.bwenge_role,
          account_type: user.account_type,
          system: SystemType.BWENGE_PLUS, // ✅ System context
        },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );


      // ==================== SET COOKIE & REDIRECT ====================
      res.cookie('bwenge_token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      });


      res.redirect(`${process.env.CLIENT_URL}/sso/callback?sso=success`);

    } catch (error: any) {

      res.redirect(`${process.env.CLIENT_URL}/sso/callback?error=sso_failed`);
    }
  }

  // ===========================================================================
  // LOGOUT
  // ===========================================================================
  static async logout(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;
      const { logout_all_systems } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }


      const sessionRepo = dbConnection.getRepository(UserSession);
      const userRepo = dbConnection.getRepository(User);

      if (logout_all_systems === 'true') {
        // ==================== LOGOUT FROM ALL SYSTEMS ====================

        // Deactivate ALL sessions
        await sessionRepo.update(
          { user_id: userId },
          { is_active: false }
        );

        // ✅ ENHANCED: Only update isUserLogin, preserve other fields
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set({ isUserLogin: false })
          .where("id = :id", { id: userId })
          .execute();


        // Notify Ongera to logout
        try {
          await axios.post(
            `${process.env.ONGERA_API_URL}/auth/sso/terminate-session`,
            {
              user_id: userId,
              system: SystemType.ONGERA
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.SSO_SHARED_SECRET}`
              },
              timeout: 5000
            }
          );
        } catch (notifyError: any) {
        }

      } else {
        // ==================== LOGOUT FROM BWENGEPLUS ONLY ====================

        // Deactivate BwengePlus sessions only
        await sessionRepo.update(
          {
            user_id: userId,
            system: SystemType.BWENGE_PLUS
          },
          { is_active: false }
        );


        // Check if user has remaining sessions
        const remainingSessions = await sessionRepo.count({
          where: {
            user_id: userId,
            is_active: true,
            expires_at: MoreThan(new Date())
          }
        });

        if (remainingSessions === 0) {
          await userRepo
            .createQueryBuilder()
            .update(User)
            .set({ isUserLogin: false })
            .where("id = :id", { id: userId })
            .execute();
        }
      }

      // Clear cookie
      res.clearCookie('bwenge_token');


      res.json({
        success: true,
        message: "Logout successful",
        data: {
          logged_out_from_all: logout_all_systems === 'true'
        }
      });

    } catch (error: any) {

      res.status(500).json({
        success: false,
        message: "Logout failed",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

  // ===========================================================================
  // CROSS-SYSTEM LOGOUT (Called by Ongera)
  // ===========================================================================
  static async crossSystemLogout(req: Request, res: Response) {

    try {
      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({
          success: false,
          message: "User ID is required"
        });
      }


      const sessionRepo = dbConnection.getRepository(UserSession);

      // Deactivate BwengePlus sessions
      const result = await sessionRepo.update(
        {
          user_id: user_id,
          system: SystemType.BWENGE_PLUS,
          is_active: true
        },
        { is_active: false }
      );


      res.json({
        success: true,
        message: "Cross-system logout successful",
        data: {
          sessions_terminated: result.affected || 0
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Cross-system logout failed",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

  // ===========================================================================
  // CHECK ONGERA SESSION
  // ===========================================================================
  static async checkOngeraSession(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      // Check with Ongera API
      try {
        const response = await axios.get(
          `${process.env.ONGERA_API_URL}/auth/sso/validate-session`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.SSO_SHARED_SECRET}`
            },
            params: { user_id: userId },
            timeout: 5000
          }
        );

        res.json({
          success: true,
          data: response.data.data
        });
      } catch (axiosError: any) {
        // If Ongera is unreachable, assume no session
        res.json({
          success: true,
          data: {
            has_ongera_session: false
          }
        });
      }

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to check Ongera session",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

  // ===========================================================================
  // GET PROFILE
  // ===========================================================================
  static async getProfile(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId },
        relations: ["profile", "enrollments", "certificates"]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // ✅ Protect the role when loading from database
      if (user.bwenge_role) {
        user.setOriginalBwengeRole(user.bwenge_role);
      }

      // Exclude sensitive data
      const { password_hash, ...userData } = user;

      res.json({
        success: true,
        data: userData
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch profile",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

  // ===========================================================================
  // GET USER SETTINGS
  // ===========================================================================
  static async getUserSettings(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId },
        relations: ["profile"]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }


      // Extract settings
      const settings = {
        appearance: {
          theme: user.learning_preferences?.theme || "light",
          language: user.learning_preferences?.preferred_language || "en"
        },
        security: {
          two_factor_enabled: user.learning_preferences?.two_factor_enabled || false,
          email: user.email,
          last_password_change: user.learning_preferences?.last_password_change || null
        },
        profile: {
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          phone_number: user.phone_number,
          bio: user.bio,
          country: user.country,
          city: user.city,
          profile_picture_url: user.profile_picture_url
        }
      };


      res.json({
        success: true,
        message: "Settings retrieved successfully",
        data: settings
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to get user settings",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // ===========================================================================
  // UPDATE APPEARANCE SETTINGS
  // ===========================================================================
  static async updateAppearanceSettings(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;
      const { theme, language } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }


      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Update learning preferences with appearance settings
      const currentPreferences = user.learning_preferences || {};
      user.learning_preferences = {
        ...currentPreferences,
        theme: theme || currentPreferences.theme || "light",
        preferred_language: language || currentPreferences.preferred_language || "en"
      };

      await userRepo.save(user);


      res.json({
        success: true,
        message: "Appearance settings updated successfully",
        data: {
          theme: user.learning_preferences.theme,
          language: user.learning_preferences.preferred_language
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to update appearance settings",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // ===========================================================================
  // TOGGLE TWO-FACTOR AUTHENTICATION
  // ===========================================================================
  static async toggleTwoFactor(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;
      const { enable } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      if (typeof enable !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: "Enable parameter must be a boolean"
        });
      }


      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Update learning preferences with 2FA setting
      const currentPreferences = user.learning_preferences || {};
      user.learning_preferences = {
        ...currentPreferences,
        two_factor_enabled: enable
      };

      await userRepo.save(user);


      res.json({
        success: true,
        message: `Two-factor authentication ${enable ? 'enabled' : 'disabled'} successfully`,
        data: {
          two_factor_enabled: enable
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to toggle two-factor authentication",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // ===========================================================================
  // CHANGE PASSWORD
  // ===========================================================================
  static async changePassword(req: Request, res: Response) {

    try {
      const userId = req.user?.userId || req.user?.id;
      const { current_password, new_password, confirm_password } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      // Validate input
      if (!current_password || !new_password || !confirm_password) {
        return res.status(400).json({
          success: false,
          message: "All password fields are required"
        });
      }

      if (new_password !== confirm_password) {
        return res.status(400).json({
          success: false,
          message: "New passwords do not match"
        });
      }

      if (new_password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters long"
        });
      }


      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect"
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(new_password, 10);
      user.password_hash = hashedPassword;

      // Update last password change date
      const currentPreferences = user.learning_preferences || {};
      user.learning_preferences = {
        ...currentPreferences,
        last_password_change: new Date().toISOString()
      };

      await userRepo.save(user);


      res.json({
        success: true,
        message: "Password changed successfully"
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to change password",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }


  
  static async verifyEmail(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          message: "Email and OTP are required"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const otpRepo = dbConnection.getRepository(Otp);

      const user = await userRepo.findOne({
        where: { email },
        relations: ["profile"]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      if (user.is_verified) {
        return res.status(400).json({
          success: false,
          message: "Email is already verified"
        });
      }

      const otpRecord = await otpRepo.findOne({
        where: {
          user_id: user.id,
          otp_code: otp,
          purpose: 'email_verification',
          used: false,
          expires_at: MoreThan(new Date())
        }
      });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP. Please request a new verification code."
        });
      }

      otpRecord.used = true;
      await otpRepo.save(otpRecord);

      user.is_verified = true;
      await userRepo.save(user);

      try {
        await sendEmailVerifiedNotification(email, user.first_name, user.last_name);
      } catch (emailError: any) {
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email, account_type: user.account_type },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );

      res.json({
        success: true,
        message: "Email verified successfully! You can now login.",
        data: {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            account_type: user.account_type,
            is_verified: user.is_verified,
            profile: user.profile,
          },
          token,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Verification failed",
        error: error.message
      });
    }
  }

  static async resendVerificationOTP(req: Request, res: Response) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { email } });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      if (user.is_verified) {
        return res.status(400).json({
          success: false,
          message: "Email already verified"
        });
      }

      const otp = generateOTP();
      const otpRepo = dbConnection.getRepository(Otp);
      const otpRecord = otpRepo.create({
        user_id: user.id,
        otp_code: otp,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
        purpose: 'email_verification',
        used: false
      });
      await otpRepo.save(otpRecord);

      await sendVerificationOTP(email, user.first_name, user.last_name, otp);

      res.json({
        success: true,
        message: "Verification code resent successfully"
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to resend verification code",
        error: error.message
      });
    }
  }

  static async requestPasswordChange(req: Request, res: Response) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { email } });

      if (!user) {
        return res.json({
          success: true,
          message: "If the email exists, a verification code has been sent"
        });
      }

      const otp = generateOTP();
      const otpRepo = dbConnection.getRepository(Otp);
      const otpRecord = otpRepo.create({
        user_id: user.id,
        otp_code: otp,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
        purpose: 'password_reset',
        used: false
      });
      await otpRepo.save(otpRecord);

      await sendPasswordChangeOTP(email, user.first_name, user.last_name, otp);

      res.json({
        success: true,
        message: "Verification code sent to your email"
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to send verification code",
        error: error.message
      });
    }
  }

  static async changePasswordWithOTP(req: Request, res: Response) {
    try {
      const { email, otp, new_password } = req.body;

      if (!email || !otp || !new_password) {
        return res.status(400).json({
          success: false,
          message: "Email, OTP, and new password are required"
        });
      }

      if (new_password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const otpRepo = dbConnection.getRepository(Otp);

      const user = await userRepo.findOne({ where: { email } });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const otpRecord = await otpRepo.findOne({
        where: {
          user_id: user.id,
          otp_code: otp,
          purpose: 'password_reset',
          used: false,
          expires_at: MoreThan(new Date())
        }
      });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP"
        });
      }

      otpRecord.used = true;
      await otpRepo.save(otpRecord);

      user.password_hash = await bcrypt.hash(new_password, 12);

      if (!user.is_verified) {
        user.is_verified = true;
        try {
          await sendEmailVerifiedNotification(
            email,
            user.first_name,
            user.last_name
          );
        } catch (notifyErr: any) {
        }
      }

      await userRepo.save(user);

      res.json({
        success: true,
        message: user.is_verified
          ? "Password changed successfully (email verified as well)"
          : "Password changed successfully"
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to change password",
        error: error.message
      });
    }
  }
  // ===========================================================================
  // GOOGLE LOGIN (standard token)
  // ===========================================================================
  static async googleLogin(req: Request, res: Response) {

    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Google token is required"
        });
      }


      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return res.status(400).json({
          success: false,
          message: "Invalid Google token"
        });
      }


      const email = payload.email;
      const googleId = payload.sub;
      const firstName = payload.given_name || "";
      const lastName = payload.family_name || "";
      const profilePicture = payload.picture || "";

      const userRepo = dbConnection.getRepository(User);

      // Check if user exists
      let user = await userRepo.findOne({
        where: { email },
        relations: ["profile", "institution_memberships", "institution_memberships.institution"]
      });

      if (user) {

        // ✅ ENHANCED: Preserve existing values
        const updates: any = {};
        let needsUpdate = false;

        if (!user.social_auth_provider) {
          updates.social_auth_provider = "google";
          updates.social_auth_id = googleId;
          needsUpdate = true;
        }

        if (!user.profile_picture_url) {
          updates.profile_picture_url = profilePicture;
          needsUpdate = true;
        }

        // Ensure user is verified
        if (!user.is_verified) {
          updates.is_verified = true;
          needsUpdate = true;
        }

        // Ensure IsForWhichSystem is set for Bwenge
        if (!user.IsForWhichSystem) {
          updates.IsForWhichSystem = SystemType.BWENGE_PLUS;
          needsUpdate = true;
        }

        // Ensure bwenge_role is set
        if (!user.bwenge_role) {
          updates.bwenge_role = BwengeRole.LEARNER;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await userRepo
            .createQueryBuilder()
            .update(User)
            .set(updates)
            .where("id = :id", { id: user.id })
            .execute();
        }

        // Protect the existing role
        if (user.bwenge_role) {
          user.setOriginalBwengeRole(user.bwenge_role);
        }
      } else {
        return res.status(404).json({
          success: false,
          message: "No account found with this Google email. Please apply to join BwengePlus first.",
          code: "NO_ACCOUNT"
        });
      }

      // Check if account is active
      if (!user.is_active) {
        if (user.application_status === ApplicationStatus.PENDING) {
          return res.status(403).json({
            success: false,
            message: "Your application is pending review by our admin team. You will receive an email once approved.",
            code: "PENDING_APPROVAL"
          });
        }
        if (user.application_status === ApplicationStatus.REJECTED) {
          return res.status(403).json({
            success: false,
            message: "Your application was not approved. Please contact support for more information.",
            code: "APPLICATION_REJECTED",
            rejection_reason: user.rejection_reason || null
          });
        }
        return res.status(403).json({
          success: false,
          message: "Account is deactivated. Please contact support.",
          code: "ACCOUNT_INACTIVE"
        });
      }

      // ✅ Protect the existing role
      if (user.bwenge_role) {
        user.setOriginalBwengeRole(user.bwenge_role);
      }

      // ==================== INSTITUTION DATA LOADING ====================
      let institutionData: any = null;
      let primaryInstitutionId: string | null = null;
      let userInstitutionRole: InstitutionRole | null = null;


      if (user.institution_memberships && user.institution_memberships.length > 0) {
        const activeMemberships = user.institution_memberships.filter(member =>
          member.is_active && member.institution
        );

        if (activeMemberships.length > 0) {
          let primaryMembership: any = null;

          // Priority 1: existing primary_institution_id
          if (user.primary_institution_id) {
            primaryMembership = activeMemberships.find(m =>
              m.institution_id === user.primary_institution_id
            );
          }

          // Priority 2: ADMIN role for INSTITUTION account type
          if (!primaryMembership && user.account_type === AccountType.INSTITUTION) {
            primaryMembership = activeMemberships.find(m =>
              m.role === InstitutionMemberRole.ADMIN
            );
          }

          // Priority 3: first active membership
          if (!primaryMembership) {
            primaryMembership = activeMemberships[0];
          }

          if (primaryMembership && primaryMembership.institution) {
            primaryInstitutionId = primaryMembership.institution.id;

            const roleMapping: Record<InstitutionMemberRole, InstitutionRole> = {
              [InstitutionMemberRole.ADMIN]: InstitutionRole.ADMIN,
              [InstitutionMemberRole.CONTENT_CREATOR]: InstitutionRole.CONTENT_CREATOR,
              [InstitutionMemberRole.INSTRUCTOR]: InstitutionRole.INSTRUCTOR,
              [InstitutionMemberRole.MEMBER]: InstitutionRole.MEMBER,
            };

            const memberRole = primaryMembership.role as InstitutionMemberRole;
            userInstitutionRole = roleMapping[memberRole] || InstitutionRole.MEMBER;

            institutionData = {
              id: primaryMembership.institution.id,
              name: primaryMembership.institution.name,
              slug: primaryMembership.institution.slug,
              type: primaryMembership.institution.type,
              logo_url: primaryMembership.institution.logo_url,
              description: primaryMembership.institution.description,
              is_active: primaryMembership.institution.is_active,
              settings: primaryMembership.institution.settings,
              created_at: primaryMembership.institution.created_at?.toISOString() || null,
              updated_at: primaryMembership.institution.updated_at?.toISOString() || null,
              user_role: userInstitutionRole
            };

          }

          // Update user's institution-related fields
          const institutionIds = activeMemberships.map(m => m.institution_id);

          // ✅ FIX: Handle nullable types properly in database update
          const updateData: any = {
            is_institution_member: true,
            institution_ids: institutionIds,
          };

          // Only add primary_institution_id if it's not null
          if (primaryInstitutionId !== null) {
            updateData.primary_institution_id = primaryInstitutionId;
          }

          // Only add institution_role if it's not null
          if (userInstitutionRole !== null) {
            updateData.institution_role = userInstitutionRole;
          }

          await userRepo
            .createQueryBuilder()
            .update(User)
            .set(updateData)
            .where("id = :id", { id: user.id })
            .execute();

          // ✅ FIX: Assign to user object with proper null handling
          user.is_institution_member = true;
          user.institution_ids = institutionIds;

          // Only assign if not null (TypeScript will accept this)
          if (primaryInstitutionId !== null) {
            user.primary_institution_id = primaryInstitutionId;
          }

          if (userInstitutionRole !== null) {
            user.institution_role = userInstitutionRole;
          }
        }
      }

      // ==================== CREATE SESSIONS FOR BOTH SYSTEMS ====================

      // ✅ FIX: Use ensureSessions helper — prevents duplicates, guarantees both sessions exist
      await ensureSessions(user.id, req);

      // ✅ FIX: Always call markUserLoggedIn — guarantees isUserLogin=true in DB
      await markUserLoggedIn(user.id);

      // ==================== GENERATE JWT ====================
      const tokenPayload: any = {
        userId: user.id,
        email: user.email,
        bwenge_role: user.bwenge_role,
        account_type: user.account_type
      };

      if (primaryInstitutionId) {
        tokenPayload.primary_institution_id = primaryInstitutionId;
        tokenPayload.institution_role = userInstitutionRole;
      }

      const jwtToken = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );

      // ==================== PREPARE RESPONSE ====================
      const responseData: any = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        phone_number: user.phone_number,
        profile_picture_url: user.profile_picture_url,
        bio: user.bio,
        account_type: user.account_type,
        is_verified: user.is_verified,
        country: user.country,
        city: user.city,
        date_joined: user.date_joined?.toISOString() || null,
        last_login: user.last_login?.toISOString() || null,

        bwenge_role: user.bwenge_role,

        is_institution_member: user.is_institution_member || false,
        institution_ids: user.institution_ids || [],
        primary_institution_id: primaryInstitutionId,
        institution_role: userInstitutionRole,
        institution: institutionData,

        spoc_access_codes_used: user.spoc_access_codes_used || [],
        profile: user.profile || null,

        enrolled_courses_count: user.enrolled_courses_count || 0,
        completed_courses_count: user.completed_courses_count || 0,
        total_learning_hours: user.total_learning_hours || 0,
        certificates_earned: user.certificates_earned || 0,
        learning_preferences: user.learning_preferences || null,
        bwenge_profile_completed: user.bwenge_profile_completed || false,
        last_login_bwenge: user.last_login_bwenge?.toISOString() || null,
        updated_at: user.updated_at?.toISOString() || null,

        current_courses: [],
        total_points: 0,
        is_active: user.is_active,
        isUserLogin: true,
        social_auth_provider: user.social_auth_provider,
        social_auth_id: user.social_auth_id
      };


      res.json({
        success: true,
        message: "Google login successful",
        data: {
          user: responseData,
          token: jwtToken
        }
      });

    } catch (error: any) {

      res.status(500).json({
        success: false,
        message: "Google login failed",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }

}

// =============================================================================
// UTILITY
// =============================================================================
function mapAccountTypeToBwengeRole(accountType: AccountType): BwengeRole {
  const mapping: Record<AccountType, BwengeRole> = {
    [AccountType.STUDENT]: BwengeRole.LEARNER,
    [AccountType.RESEARCHER]: BwengeRole.LEARNER,
    [AccountType.INSTITUTION]: BwengeRole.LEARNER,
    [AccountType.DIASPORA]: BwengeRole.LEARNER,
    [AccountType.ADMIN]: BwengeRole.SYSTEM_ADMIN
  };

  const role = mapping[accountType];

  if (!role) {
    return BwengeRole.LEARNER;
  }

  return role;
}