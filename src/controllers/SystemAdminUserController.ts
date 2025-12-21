// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User, SystemType, BwengeRole, AccountType, InstitutionRole } from "../database/models/User";
import { UserProfile } from "../database/models/UserProfile";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { Institution } from "../database/models/Institution";
import { Course } from "../database/models/Course";
import { Enrollment } from "../database/models/Enrollment";
import { Certificate } from "../database/models/Certificate";
import { UserSession } from "../database/models/UserSession";
import bcrypt from "bcryptjs";
import { sendEmail } from "../services/emailService";
import { MoreThan } from "typeorm";

export class SystemAdminUserController {



static async getUserDetails(req: Request, res: Response) {
  try {
    console.log("\n👤 [GET USER DETAILS] Starting...");

    const { userId } = req.params;

    // STEP 1: Verify System Admin
    const currentUser = await dbConnection.getRepository(User).findOne({
      where: { id: req.user?.userId }
    });

    if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: "System administrator access required"
      });
    }

    // STEP 2: Fetch User
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      relations: ["profile", "institution_memberships", "institution_memberships.institution"]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // STEP 3: Calculate Statistics
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const certificateRepo = dbConnection.getRepository(Certificate);
    const courseRepo = dbConnection.getRepository(Course);

    const enrollments = await enrollmentRepo.find({
      where: { user_id: userId },
      relations: ["course"]
    });

    const certificates = await certificateRepo.find({
      where: { user_id: userId },
      relations: ["course"]
    });

    const coursesTaught = await courseRepo.find({
      where: { instructor_id: userId }
    });

    // STEP 4: Get Activity Timeline
    const recentEnrollments = enrollments
      .filter(e => new Date(e.enrolled_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000)
      .map(e => ({
        type: "enrollment",
        description: `Enrolled in ${e.course.title}`,
        timestamp: e.enrolled_at
      }));
    
    const recentCertificates = certificates
      .filter(c => new Date(c.issue_date).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000)
      .map(c => ({
        type: "completion",
        description: `Completed ${c.course.title}`,
        timestamp: c.issue_date
      }));

    const recent_activity = [...recentEnrollments, ...recentCertificates]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    // STEP 5: Get User Sessions
    const sessionRepo = dbConnection.getRepository(UserSession);
    const sessions = await sessionRepo.find({
      where: {
        user_id: userId,
        expires_at: MoreThan(new Date())
      },
      order: { last_activity: 'DESC' },
      take: 5
    });

    const formattedSessions = sessions.map(s => ({
      id: s.id,
      system: s.system,
      device_info: s.device_info,
      ip_address: s.ip_address,
      last_active: s.last_activity,
      is_active: s.is_active,
      expires_at: s.expires_at
    }));

    // STEP 6: Format Comprehensive Response
    const { password_hash, ...userData } = user;

    const detailed_statistics = {
      learning: {
        total_courses_enrolled: enrollments.length,
        completed_courses: certificates.length,
        in_progress_courses: enrollments.filter(e => !certificates.find(c => c.course_id === e.course_id)).length,
        dropped_courses: 0,
        total_hours: user.total_learning_hours || 0,
        certificates: certificates.length,
        average_completion_rate: 0,
        current_streak_days: 0
      },
      teaching: {
        courses_as_primary_instructor: coursesTaught.length,
        courses_as_additional_instructor: 0,
        total_students_taught: 0,
        average_course_rating: 0,
        total_reviews: 0
      },
      institutions: {
        total_institutions: user.institution_ids?.length || 0,
        institutions_as_admin: user.institution_memberships?.filter(m => m.role === InstitutionMemberRole.ADMIN).length || 0,
        institutions_as_instructor: user.institution_memberships?.filter(m => m.role === InstitutionMemberRole.INSTRUCTOR).length || 0,
        institutions_as_member: user.institution_memberships?.filter(m => m.role === InstitutionMemberRole.MEMBER).length || 0
      }
    };

    return res.json({
      success: true,
      data: {
        user: userData,
        detailed_statistics,
        enrollments: enrollments.map(e => ({
          id: e.id,
          course: {
            id: e.course.id,
            title: e.course.title,
            thumbnail_url: e.course.thumbnail_url
          },
          status: e.status,
          enrolled_at: e.enrolled_at,
          // ✅ FIX: Use actual property name or calculate from progress
          completion_percentage: (e as any).completion_percentage || 0,
          last_accessed: (e as any).last_accessed_at || e.enrolled_at
        })),
        courses_taught: coursesTaught.map(c => ({
          id: c.id,
          title: c.title,
          role: "primary",
          enrollment_count: c.enrollment_count,
          average_rating: c.average_rating
        })),
        certificates: certificates.map(c => ({
          id: c.id,
          course_title: c.course.title,
          issued_at: c.issue_date,
          certificate_url: c.certificate_url
        })),
        recent_activity,
        sessions: formattedSessions
      }
    });

  } catch (error: any) {
    console.error("❌ Get user details error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user details",
      error: error.message
    });
  }
}

static async createUser(req: Request, res: Response) {
  try {
    console.log("\n➕ [CREATE USER] Starting...");

    // STEP 1: Verify System Admin
    const currentUser = await dbConnection.getRepository(User).findOne({
      where: { id: req.user?.userId }
    });

    if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: "System administrator access required"
      });
    }

    const {
      email,
      password,
      first_name,
      last_name,
      username,
      phone_number,
      bio,
      country,
      city,
      profile_picture_url,
      account_type,
      bwenge_role,
      institution_role,
      is_active = true,
      is_verified = false,
      assign_to_institution,
      profile,
      send_welcome_email = true,
      require_password_change = false,
      IsForWhichSystem = SystemType.BWENGEPLUS,
    } = req.body;

    // STEP 2: Validate Input
    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: "Email, password, first name, and last name are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long"
      });
    }

    // ✅ ENHANCED: Validate IsForWhichSystem
    if (!IsForWhichSystem || !Object.values(SystemType).includes(IsForWhichSystem)) {
      return res.status(400).json({
        success: false,
        message: `IsForWhichSystem must be one of: ${Object.values(SystemType).join(', ')}`
      });
    }

    const userRepo = dbConnection.getRepository(User);

    // Check email uniqueness
    const existingEmail = await userRepo.findOne({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already in use"
      });
    }

    // STEP 3: Generate Username
    let finalUsername = username;
    if (!finalUsername) {
      finalUsername = `${first_name.toLowerCase()}.${last_name.toLowerCase()}`;

      const existingUsername = await userRepo.findOne({ where: { username: finalUsername } });
      if (existingUsername) {
        finalUsername = `${finalUsername}${Math.floor(Math.random() * 1000)}`;
      }
    }

    // STEP 4: Hash Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // STEP 5: Create User Record with Complete Initialization
    const newUser = userRepo.create({
      email,
      password_hash: hashedPassword,
      username: finalUsername,
      first_name,
      last_name,
      phone_number,
      bio,
      country,
      city,
      profile_picture_url,
      account_type: account_type || AccountType.STUDENT,
      IsForWhichSystem: IsForWhichSystem as SystemType,
      bwenge_role: bwenge_role || (IsForWhichSystem === SystemType.BWENGEPLUS ? BwengeRole.LEARNER : null),
      institution_role: institution_role || null,
      is_institution_member: false,
      institution_ids: [],
      is_active,
      is_verified,
      date_joined: new Date(),
    });

    await userRepo.save(newUser);
    console.log(`✅ User created with system: ${IsForWhichSystem}`);



if (profile) {
  const profileRepo = dbConnection.getRepository(UserProfile);
  const newProfile = profileRepo.create({
    user: newUser,
    ...profile
  });
  await profileRepo.save(newProfile);
  newUser.profile = newProfile as any;
}

    let institutionAssignment = null;
    if (assign_to_institution) {
      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({
        where: { id: assign_to_institution.institution_id }
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found"
        });
      }

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const membership = memberRepo.create({
        user_id: newUser.id,
        institution_id: institution.id,
        role: assign_to_institution.role || InstitutionMemberRole.MEMBER,
        is_active: true,
        joined_at: new Date()
      });

      await memberRepo.save(membership);

      // ✅ FIX: Update user institution fields with null safety
      newUser.is_institution_member = true;
      newUser.institution_ids = [institution.id];
      
      // Only assign if is_primary is true (otherwise leave null)
      if (assign_to_institution.is_primary) {
        newUser.primary_institution_id = institution.id;
      }
      
      newUser.institution_role = assign_to_institution.role;

      await userRepo.save(newUser);

      institutionAssignment = {
        institution_id: institution.id,
        institution_name: institution.name,
        role: assign_to_institution.role,
        is_primary: assign_to_institution.is_primary || false
      };
    }

    // STEP 9: Send Welcome Email
    if (send_welcome_email) {
      try {
        await sendEmail({
          to: email,
          subject: "Welcome to BwengePlus - Your Account is Ready",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #5B7FA2;">Welcome to BwengePlus</h2>
              <p>Dear ${first_name},</p>
              <p>Your account has been created on BwengePlus!</p>
              
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Login Credentials</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> <code>${password}</code></p>
                <p><strong>Role:</strong> ${bwenge_role}</p>
                ${institutionAssignment ? `<p><strong>Institution:</strong> ${institutionAssignment.institution_name}</p>` : ''}
              </div>
              
              <p>Login at: ${process.env.CLIENT_URL}/login</p>
              ${require_password_change ? '<p><strong>Important:</strong> Please change your password after first login.</p>' : ''}
              
              <p>Best regards,<br>BwengePlus Team</p>
            </div>
          `
        });
        console.log("✅ Welcome email sent");
      } catch (emailError: any) {
        console.warn("⚠️ Failed to send welcome email:", emailError.message);
      }
    }

    // STEP 10: Log Admin Action
    console.log(`✅ User created by admin ${currentUser.email}`);

    // STEP 11: Return Response
    const { password_hash, ...userData } = newUser;

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        user: userData,
        institution_assignment: institutionAssignment,
        credentials: {
          email,
          temporary_password: password,
          password_change_required: require_password_change
        },
        notifications: {
          welcome_email_sent: send_welcome_email
        }
      }
    });

  } catch (error: any) {
    console.error("❌ Create user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create user",
      error: error.message
    });
  }
}

// ==================== METHOD 4: UPDATE USER (FIXED) ====================
static async updateUser(req: Request, res: Response) {
  try {
    console.log("\n✏️ [UPDATE USER] Starting...");

    const { userId } = req.params;

    // STEP 1: Verify System Admin
    const currentUser = await dbConnection.getRepository(User).findOne({
      where: { id: req.user?.userId }
    });

    if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: "System administrator access required"
      });
    }

    // STEP 2: Fetch Existing User
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      relations: ["profile", "institution_memberships"]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const {
      first_name,
      last_name,
      username,
      email,
      phone_number,
      bio,
      country,
      city,
      account_type,
      bwenge_role,
      institution_role,
      is_active,
      is_verified,
      profile,
      update_institution_assignment,
      reset_password
    } = req.body;

    // STEP 3: Validate Updates
    if (email && email !== user.email) {
      const existingEmail = await userRepo.findOne({
        where: { email }
      });
      if (existingEmail && existingEmail.id !== userId) {
        return res.status(400).json({
          success: false,
          message: "Email already in use"
        });
      }
    }

    if (username && username !== user.username) {
      const existingUsername = await userRepo.findOne({
        where: { username }
      });
      if (existingUsername && existingUsername.id !== userId) {
        return res.status(400).json({
          success: false,
          message: "Username already in use"
        });
      }
    }

    // STEP 4: Protect Critical Fields
    const systemAdminCount = await userRepo.count({
      where: { bwenge_role: BwengeRole.SYSTEM_ADMIN, is_active: true }
    });

    if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN && systemAdminCount === 1) {
      if (bwenge_role && bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(400).json({
          success: false,
          message: "Cannot change role of the only system administrator"
        });
      }
      if (is_active === false) {
        return res.status(400).json({
          success: false,
          message: "Cannot deactivate the only system administrator"
        });
      }
    }

    // STEP 5: Update Basic Fields
    const changes: string[] = [];

    if (first_name !== undefined && first_name !== user.first_name) {
      user.first_name = first_name;
      changes.push("first_name");
    }
    if (last_name !== undefined && last_name !== user.last_name) {
      user.last_name = last_name;
      changes.push("last_name");
    }
    if (username !== undefined && username !== user.username) {
      user.username = username;
      changes.push("username");
    }
    if (email !== undefined && email !== user.email) {
      user.email = email;
      changes.push("email");
    }
    if (phone_number !== undefined) {
      user.phone_number = phone_number;
      changes.push("phone_number");
    }
    if (bio !== undefined) {
      user.bio = bio;
      changes.push("bio");
    }
    if (country !== undefined) {
      user.country = country;
      changes.push("country");
    }
    if (city !== undefined) {
      user.city = city;
      changes.push("city");
    }
    if (account_type !== undefined) {
      user.account_type = account_type;
      changes.push("account_type");
    }
    if (is_active !== undefined) {
      user.is_active = is_active;
      changes.push("is_active");
    }
    if (is_verified !== undefined) {
      user.is_verified = is_verified;
      changes.push("is_verified");
    }

    // STEP 7: Handle Role Changes
    let roleChanges: any = null;

    if (bwenge_role !== undefined && bwenge_role !== user.bwenge_role) {
      const oldRole = user.bwenge_role;
      user.setOriginalBwengeRole(oldRole);
      user.bwenge_role = bwenge_role;
      changes.push("bwenge_role");

      roleChanges = {
        old_bwenge_role: oldRole,
        new_bwenge_role: bwenge_role
      };
    }

    if (institution_role !== undefined && institution_role !== user.institution_role) {
      const oldRole = user.institution_role;
      user.institution_role = institution_role;
      changes.push("institution_role");

      if (!roleChanges) roleChanges = {};
      roleChanges.old_institution_role = oldRole;
      roleChanges.new_institution_role = institution_role;
    }

    // STEP 6: Update Profile
    if (profile) {
      const profileRepo = dbConnection.getRepository(UserProfile);
      let userProfile = user.profile;

      if (!userProfile) {
        userProfile = profileRepo.create({
          user: user,
          ...profile
        });
      } else {
        Object.assign(userProfile, profile);
      }

      await profileRepo.save(userProfile);
      changes.push("profile");
    }

    

    // STEP 8: Handle Institution Assignments
    let institutionChanges: any = null;

    if (update_institution_assignment) {
      const memberRepo = dbConnection.getRepository(InstitutionMember);

      // Add to institutions
      if (update_institution_assignment.add_to_institutions) {
        for (const inst of update_institution_assignment.add_to_institutions) {
          const membership = memberRepo.create({
            user_id: userId,
            institution_id: inst.institution_id,
            role: inst.role || InstitutionMemberRole.MEMBER,
            is_active: true,
            joined_at: new Date()
          });
          await memberRepo.save(membership);

          if (!user.institution_ids) user.institution_ids = [];
          if (!user.institution_ids.includes(inst.institution_id)) {
            user.institution_ids.push(inst.institution_id);
          }

          // ✅ FIX: Only set primary_institution_id if is_primary is true
          if (inst.is_primary) {
            user.primary_institution_id = inst.institution_id;
          }
        }

        user.is_institution_member = true;

        if (!institutionChanges) institutionChanges = {};
        institutionChanges.added_to = update_institution_assignment.add_to_institutions.map((i: any) => i.institution_id);
      }

      // Remove from institutions
      if (update_institution_assignment.remove_from_institutions) {
        for (const instId of update_institution_assignment.remove_from_institutions) {
          await memberRepo.update(
            { user_id: userId, institution_id: instId },
            { is_active: false }
          );

          user.institution_ids = user.institution_ids?.filter(id => id !== instId) || [];

          // ✅ FIX: Handle nullable primary_institution_id
          if (user.primary_institution_id === instId) {
            // Set to first remaining institution or leave undefined (TypeORM handles this)
            const remainingId = user.institution_ids[0];
            if (remainingId) {
              user.primary_institution_id = remainingId;
            } else {
              // Use type assertion to allow setting to undefined
              (user as any).primary_institution_id = null;
            }
          }
        }

        if (!institutionChanges) institutionChanges = {};
        institutionChanges.removed_from = update_institution_assignment.remove_from_institutions;
      }

      // Update primary institution
      if (update_institution_assignment.update_primary_institution) {
        user.primary_institution_id = update_institution_assignment.update_primary_institution;

        if (!institutionChanges) institutionChanges = {};
        institutionChanges.new_primary = update_institution_assignment.update_primary_institution;
      }

      changes.push("institution_assignment");
    }

    // STEP 9: Handle Password Reset
    if (reset_password) {
      const hashedPassword = await bcrypt.hash(reset_password.new_password, 10);
      user.password_hash = hashedPassword;
      changes.push("password");

      // Invalidate all sessions
      const sessionRepo = dbConnection.getRepository(UserSession);
      await sessionRepo.update(
        { user_id: userId },
        { is_active: false }
      );
    }

    // STEP 10: Save All Changes
    await userRepo.save(user);

    console.log(`✅ User updated: ${changes.join(", ")}`);

    // STEP 11: Return Response
    const { password_hash, ...userData } = user;

    return res.json({
      success: true,
      message: "User updated successfully",
      data: {
        user: userData,
        changes: {
          fields_updated: changes,
          role_changes: roleChanges,
          institution_changes: institutionChanges
        },
        notifications_sent: {
          email_sent: false,
          notification_types: []
        }
      }
    });

  } catch (error: any) {
    console.error("❌ Update user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: error.message
    });
  }
}
  // ==================== METHOD 1: GET ALL USERS ====================
  static async getAllUsers(req: Request, res: Response) {
    try {
      console.log("\n👥 [GET ALL USERS] Starting...");

      // STEP 1: Verify System Admin Access
      const currentUser = await dbConnection.getRepository(User).findOne({
        where: { id: req.user?.userId }
      });

      if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "System administrator access required"
        });
      }

      // Extract query parameters
      const {
        search,
        bwenge_role,
        institution_role,
        account_type,
        is_institution_member,
        institution_id,
        is_active,
        is_verified,
        sort_by = 'created_at',
        sort_order = 'DESC',
        page = '1',
        limit = '20'
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);
      const offset = (pageNum - 1) * limitNum;

      console.log("📋 Filters:", { search, bwenge_role, institution_role, account_type });

      // STEP 2: Build Base Query
      const userRepo = dbConnection.getRepository(User);
      const queryBuilder = userRepo
        .createQueryBuilder("user")
        .leftJoinAndSelect("user.profile", "profile")
        .leftJoin("user.institution_memberships", "im")
        .leftJoin("user.enrollments", "e")
        .select([
          "user",
          "profile",
          "COUNT(DISTINCT im.id) as institution_count",
          "COUNT(DISTINCT e.id) as enrollment_count"
        ]);

      // STEP 3: Apply Filters

      // Search Filter
      if (search) {
        queryBuilder.andWhere(
          "(user.first_name ILIKE :search OR user.last_name ILIKE :search OR user.email ILIKE :search OR user.username ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      // Role Filters
      if (bwenge_role) {
        queryBuilder.andWhere("user.bwenge_role = :bwengeRole", { bwengeRole: bwenge_role });
      }

      if (institution_role) {
        queryBuilder.andWhere("user.institution_role = :institutionRole", { institutionRole: institution_role });
      }

      if (account_type) {
        queryBuilder.andWhere("user.account_type = :accountType", { accountType: account_type });
      }

      // Membership Filters
      if (is_institution_member !== undefined) {
        queryBuilder.andWhere("user.is_institution_member = :isInstitutionMember", {
          isInstitutionMember: is_institution_member === 'true'
        });
      }

      if (institution_id) {
        queryBuilder.andWhere(
          "EXISTS (SELECT 1 FROM institution_members WHERE user_id = user.id AND institution_id = :institutionId AND is_active = true)",
          { institutionId: institution_id }
        );
      }

      // Status Filters
      if (is_active !== undefined) {
        queryBuilder.andWhere("user.is_active = :isActive", { isActive: is_active === 'true' });
      }

      if (is_verified !== undefined) {
        queryBuilder.andWhere("user.is_verified = :isVerified", { isVerified: is_verified === 'true' });
      }

      // STEP 4: Group and Count
      queryBuilder.groupBy("user.id, profile.id");

      // STEP 6: Count Total (Before Pagination)
      const totalQuery = queryBuilder.clone();
      const totalResult = await totalQuery.getRawMany();
      const total = totalResult.length;

      // STEP 5: Apply Sorting
      const sortMapping: Record<string, string> = {
        'created_at': 'user.date_joined',
        'email': 'user.email',
        'first_name': 'user.first_name',
        'last_name': 'user.last_name',
        'last_login': 'user.last_login'
      };

      const sortField = sortMapping[sort_by as string] || 'user.date_joined';
      queryBuilder.orderBy(sortField, sort_order === 'ASC' ? 'ASC' : 'DESC');

      // STEP 7: Apply Pagination
      queryBuilder.offset(offset).limit(limitNum);

      // STEP 8: Fetch User Details
      const users = await queryBuilder.getRawAndEntities();

      // Format users with additional details
      const formattedUsers = await Promise.all(
        users.entities.map(async (user) => {
          // Get institution memberships
          const memberships = await dbConnection.getRepository(InstitutionMember).find({
            where: { user_id: user.id, is_active: true },
            relations: ["institution"]
          });

          const institutions = memberships.map(m => ({
            id: m.institution.id,
            name: m.institution.name,
            logo_url: m.institution.logo_url,
            role: m.role,
            is_active: m.is_active,
            joined_at: m.joined_at
          }));

          // Statistics
          const enrollmentCount = await dbConnection.getRepository(Enrollment).count({
            where: { user_id: user.id }
          });

          const certificateCount = await dbConnection.getRepository(Certificate).count({
            where: { user_id: user.id }
          });

          const coursesTaught = await dbConnection.getRepository(Course).count({
            where: { instructor_id: user.id }
          });

          return {
            // Basic Info
            id: user.id,
            email: user.email,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            phone_number: user.phone_number,
            profile_picture_url: user.profile_picture_url,
            bio: user.bio,

            // Account Info
            account_type: user.account_type,
            is_verified: user.is_verified,
            is_active: user.is_active,
            country: user.country,
            city: user.city,

            // Dates
            date_joined: user.date_joined,
            last_login: user.last_login,
            last_login_bwenge: user.last_login_bwenge,
            updated_at: user.updated_at,

            // Roles
            bwenge_role: user.bwenge_role,
            institution_role: user.institution_role,

            // Institution Info
            is_institution_member: user.is_institution_member,
            institution_ids: user.institution_ids || [],
            primary_institution_id: user.primary_institution_id,
            institutions,
            isforwhich_system:user.IsForWhichSystem,
            // Statistics
            statistics: {
              enrolled_courses_count: enrollmentCount,
              completed_courses_count: user.completed_courses_count || 0,
              courses_taught: coursesTaught,
              total_learning_hours: user.total_learning_hours || 0,
              certificates_earned: certificateCount,
              institutions_count: institutions.length
            },

            // Profile
            profile: user.profile || null
          };
        })
      );

      // Calculate summary statistics
      const allUsers = await userRepo.find();

      const summary = {
        total_users: total,
        by_bwenge_role: {
          SYSTEM_ADMIN: allUsers.filter(u => u.bwenge_role === BwengeRole.SYSTEM_ADMIN).length,
          INSTITUTION_ADMIN: allUsers.filter(u => u.bwenge_role === BwengeRole.INSTITUTION_ADMIN).length,
          CONTENT_CREATOR: allUsers.filter(u => u.bwenge_role === BwengeRole.CONTENT_CREATOR).length,
          INSTRUCTOR: allUsers.filter(u => u.bwenge_role === BwengeRole.INSTRUCTOR).length,
          LEARNER: allUsers.filter(u => u.bwenge_role === BwengeRole.LEARNER).length
        },
        by_account_type: {
          Student: allUsers.filter(u => u.account_type === AccountType.STUDENT).length,
          Researcher: allUsers.filter(u => u.account_type === AccountType.RESEARCHER).length,
          Institution: allUsers.filter(u => u.account_type === AccountType.INSTITUTION).length,
          Diaspora: allUsers.filter(u => u.account_type === AccountType.DIASPORA).length,
          admin: allUsers.filter(u => u.account_type === AccountType.ADMIN).length
        },
        active_users: allUsers.filter(u => u.is_active).length,
        verified_users: allUsers.filter(u => u.is_verified).length,
        institution_members: allUsers.filter(u => u.is_institution_member).length
      };

      console.log(`✅ Found ${formattedUsers.length} users`);

      return res.json({
        success: true,
        data: {
          users: formattedUsers,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum)
          },
          filters: {
            search: search || null,
            bwenge_role: bwenge_role || null,
            institution_role: institution_role || null,
            account_type: account_type || null,
            is_institution_member: is_institution_member || null,
            institution_id: institution_id || null,
            is_active: is_active || null,
            is_verified: is_verified || null,
            sort_by,
            sort_order
          },
          summary
        }
      });

    } catch (error: any) {
      console.error("❌ Get all users error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch users",
        error: error.message
      });
    }
  }





  // ==================== METHOD 5: DELETE USER ====================
  static async deleteUser(req: Request, res: Response) {
    try {
      console.log("\n🗑️ [DELETE USER] Starting...");

      const { userId } = req.params;
      const { permanent = 'false', force = 'false' } = req.query;

      // STEP 1: Verify System Admin
      const currentUser = await dbConnection.getRepository(User).findOne({
        where: { id: req.user?.userId }
      });

      if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "System administrator access required"
        });
      }

      // STEP 2: Fetch User
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId },
        relations: ["institution_memberships", "courses_created"]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // STEP 3: Protection Checks
      const systemAdminCount = await userRepo.count({
        where: { bwenge_role: BwengeRole.SYSTEM_ADMIN, is_active: true }
      });

      if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN && systemAdminCount === 1) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete the only system administrator"
        });
      }

      // STEP 4: Check Dependencies
      const coursesCount = await dbConnection.getRepository(Course).count({
        where: { instructor_id: userId }
      });

      const enrollmentsCount = await dbConnection.getRepository(Enrollment).count({
        where: { user_id: userId }
      });

      const certificatesCount = await dbConnection.getRepository(Certificate).count({
        where: { user_id: userId }
      });

      // STEP 6: Soft Delete (default)
      if (permanent === 'false') {
        user.is_active = false;
        await userRepo.save(user);

        // Invalidate all sessions
        const sessionRepo = dbConnection.getRepository(UserSession);
        await sessionRepo.update(
          { user_id: userId },
          { is_active: false }
        );

        // Deactivate institution memberships
        const memberRepo = dbConnection.getRepository(InstitutionMember);
        await memberRepo.update(
          { user_id: userId },
          { is_active: false }
        );

        console.log("✅ User soft deleted");

        return res.json({
          success: true,
          message: "User deactivated successfully",
          data: {
            user_id: userId,
            deletion_type: "soft",
            deleted_at: new Date(),
            dependencies_handled: {
              courses_reassigned: 0,
              institutions_updated: 0,
              enrollments_retained: enrollmentsCount,
              certificates_retained: certificatesCount
            },
            can_be_recovered: true,
            notification_sent: false
          }
        });
      }

      // STEP 7: Hard Delete
      if (permanent === 'true' && force === 'true') {
        // Delete cascade
        await dbConnection.getRepository(UserSession).delete({ user_id: userId });
        await dbConnection.getRepository(InstitutionMember).delete({ user_id: userId });
        await dbConnection.getRepository(UserProfile).delete({ user: { id: userId } as any });

        // Update courses to null instructor
        await dbConnection.getRepository(Course).update(
          { instructor_id: userId },
          { instructor_id: null }
        );

        // Delete user
        await userRepo.delete(userId);

        console.log("✅ User permanently deleted");

        return res.json({
          success: true,
          message: "User permanently deleted",
          data: {
            user_id: userId,
            deletion_type: "hard",
            deleted_at: new Date(),
            dependencies_handled: {
              courses_reassigned: coursesCount,
              institutions_updated: 0,
              enrollments_retained: enrollmentsCount,
              certificates_retained: certificatesCount
            },
            can_be_recovered: false,
            notification_sent: false
          }
        });
      }

      return res.status(400).json({
        success: false,
        message: "Cannot perform hard delete without force parameter"
      });

    } catch (error: any) {
      console.error("❌ Delete user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete user",
        error: error.message
      });
    }
  }

  // ==================== METHOD 6: BATCH UPDATE USERS ====================
  static async batchUpdateUsers(req: Request, res: Response) {
    try {
      console.log("\n📦 [BATCH UPDATE] Starting...");

      const { user_ids, updates } = req.body;

      // Verify System Admin
      const currentUser = await dbConnection.getRepository(User).findOne({
        where: { id: req.user?.userId }
      });

      if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "System administrator access required"
        });
      }

      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "User IDs array is required"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const results: any[] = [];

      for (const userId of user_ids) {
        try {
          const user = await userRepo.findOne({ where: { id: userId } });

          if (!user) {
            results.push({
              user_id: userId,
              success: false,
              message: "User not found"
            });
            continue;
          }

          Object.assign(user, updates);
          await userRepo.save(user);

          results.push({
            user_id: userId,
            success: true,
            message: "Updated successfully"
          });
        } catch (error: any) {
          results.push({
            user_id: userId,
            success: false,
            message: error.message
          });
        }
      }

      return res.json({
        success: true,
        message: "Batch update completed",
        data: {
          total: user_ids.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          results
        }
      });

    } catch (error: any) {
      console.error("❌ Batch update error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to batch update users",
        error: error.message
      });
    }
  }

  // ==================== METHOD 7: GET USER STATISTICS ====================
  static async getUserStatistics(req: Request, res: Response) {
    try {
      console.log("\n📊 [GET STATISTICS] Starting...");

      // Verify System Admin
      const currentUser = await dbConnection.getRepository(User).findOne({
        where: { id: req.user?.userId }
      });

      if (!currentUser || currentUser.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "System administrator access required"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const allUsers = await userRepo.find();

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentSignups = allUsers.filter(u =>
        u.date_joined && new Date(u.date_joined) > thirtyDaysAgo
      ).length;

      const statistics = {
        total_users: allUsers.length,
        by_role: {
          SYSTEM_ADMIN: allUsers.filter(u => u.bwenge_role === BwengeRole.SYSTEM_ADMIN).length,
          INSTITUTION_ADMIN: allUsers.filter(u => u.bwenge_role === BwengeRole.INSTITUTION_ADMIN).length,
          CONTENT_CREATOR: allUsers.filter(u => u.bwenge_role === BwengeRole.CONTENT_CREATOR).length,
          INSTRUCTOR: allUsers.filter(u => u.bwenge_role === BwengeRole.INSTRUCTOR).length,
          LEARNER: allUsers.filter(u => u.bwenge_role === BwengeRole.LEARNER).length
        },
        by_account_type: {
          Student: allUsers.filter(u => u.account_type === AccountType.STUDENT).length,
          Researcher: allUsers.filter(u => u.account_type === AccountType.RESEARCHER).length,
          Institution: allUsers.filter(u => u.account_type === AccountType.INSTITUTION).length,
          Diaspora: allUsers.filter(u => u.account_type === AccountType.DIASPORA).length,
          admin: allUsers.filter(u => u.account_type === AccountType.ADMIN).length
        },
        active_users: allUsers.filter(u => u.is_active).length,
        verified_users: allUsers.filter(u => u.is_verified).length,
        recent_signups: recentSignups,
        institution_members: allUsers.filter(u => u.is_institution_member).length
      };

      return res.json({
        success: true,
        data: statistics
      });

    } catch (error: any) {
      console.error("❌ Get statistics error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch statistics",
        error: error.message
      });
    }
  }
}