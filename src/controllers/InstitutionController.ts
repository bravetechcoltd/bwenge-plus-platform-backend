// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Institution, InstitutionType } from "../database/models/Institution";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { User, BwengeRole, InstitutionRole } from "../database/models/User";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Course } from "../database/models/Course";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { sendEmail } from "../services/emailService";
import { UploadToCloud } from "../services/cloudinary";
import fs from "fs";
import { CourseCategory } from "../database/models/CourseCategory";
import { Review } from "../database/models/ReviewModel";
import { Enrollment } from "../database/models/Enrollment";
import { Module } from "../database/models/Module";
import { Lesson } from "../database/models/Lesson";

export class InstitutionController {



static async getPublicInstitutionsForHomepage(req: Request, res: Response) {
  try {
    console.log("🏠 [getPublicInstitutionsForHomepage] Fetching public homepage data...");

    const institutionRepo = dbConnection.getRepository(Institution);
    const categoryRepo = dbConnection.getRepository(CourseCategory);
    const courseRepo = dbConnection.getRepository(Course);

    // Fetch only active institutions
    const institutions = await institutionRepo
      .createQueryBuilder("institution")
      .where("institution.is_active = :is_active", { is_active: true })
      .orderBy("institution.created_at", "DESC")
      .getMany();

    console.log(`✅ Found ${institutions.length} active institutions`);

    // Build response with categories and courses for each institution
    const institutionsWithData = await Promise.all(
      institutions.map(async (institution) => {
        console.log(`📊 Processing institution: ${institution.name} (${institution.id})`);

        // STRATEGY 1: Get all published courses for this institution first
        const allCourses = await courseRepo
          .createQueryBuilder("course")
          .leftJoinAndSelect("course.instructor", "instructor")
          .leftJoinAndSelect("course.course_category", "course_category")
          .where("course.institution_id = :institutionId", { institutionId: institution.id })
          .andWhere("course.status = :status", { status: "PUBLISHED" })
          .orderBy("course.enrollment_count", "DESC")
          .getMany();

        console.log(`   Found ${allCourses.length} published courses`);

        // STRATEGY 2: Get active categories for this institution
        const categories = await categoryRepo.find({
          where: {
            institution_id: institution.id,
            is_active: true,
          },
          order: { order_index: "ASC" },
        });

        console.log(`   Found ${categories.length} categories`);

        // STRATEGY 3: Build categories with courses
        const categoriesWithCourses: any[] = [];

        // First, add courses that have category assignments
        for (const category of categories) {
          const categoryCourses = allCourses
            .filter((course) => course.category_id === category.id)
            .slice(0, 6)
            .map((course) => ({
              id: course.id,
              title: course.title,
              thumbnail_url: course.thumbnail_url,
              instructor: course.instructor
                ? {
                    id: course.instructor.id,
                    first_name: course.instructor.first_name,
                    last_name: course.instructor.last_name,
                    profile_picture_url: course.instructor.profile_picture_url,
                  }
                : null,
              enrollment_count: course.enrollment_count,
              average_rating: parseFloat(course.average_rating?.toString() || "0"),
              course_type: course.course_type,
              level: course.level,
              duration_minutes: course.duration_minutes,
            }));

          if (categoryCourses.length > 0) {
            categoriesWithCourses.push({
              id: category.id,
              name: category.name,
              description: category.description,
              course_count: allCourses.filter((c) => c.category_id === category.id).length,
              courses: categoryCourses,
            });
          }
        }

        // STRATEGY 4: Handle uncategorized courses
        const uncategorizedCourses = allCourses
          .filter((course) => !course.category_id)
          .slice(0, 6)
          .map((course) => ({
            id: course.id,
            title: course.title,
            thumbnail_url: course.thumbnail_url,
            instructor: course.instructor
              ? {
                  id: course.instructor.id,
                  first_name: course.instructor.first_name,
                  last_name: course.instructor.last_name,
                  profile_picture_url: course.instructor.profile_picture_url,
                }
              : null,
            enrollment_count: course.enrollment_count,
            average_rating: parseFloat(course.average_rating?.toString() || "0"),
            course_type: course.course_type,
            level: course.level,
            duration_minutes: course.duration_minutes,
          }));

        // If there are uncategorized courses, create an "All Courses" category
        if (uncategorizedCourses.length > 0) {
          categoriesWithCourses.push({
            id: `uncategorized-${institution.id}`,
            name: "All Courses",
            description: "Courses from this institution",
            course_count: uncategorizedCourses.length,
            courses: uncategorizedCourses,
          });
        }

        // STRATEGY 5: If no categories exist but courses do, create a default category
        if (categoriesWithCourses.length === 0 && allCourses.length > 0) {
          console.log(`   ⚠️ No categories found, creating default category for ${allCourses.length} courses`);
          
          const defaultCourses = allCourses
            .slice(0, 6)
            .map((course) => ({
              id: course.id,
              title: course.title,
              thumbnail_url: course.thumbnail_url,
              instructor: course.instructor
                ? {
                    id: course.instructor.id,
                    first_name: course.instructor.first_name,
                    last_name: course.instructor.last_name,
                    profile_picture_url: course.instructor.profile_picture_url,
                  }
                : null,
              enrollment_count: course.enrollment_count,
              average_rating: parseFloat(course.average_rating?.toString() || "0"),
              course_type: course.course_type,
              level: course.level,
              duration_minutes: course.duration_minutes,
            }));

          categoriesWithCourses.push({
            id: `default-${institution.id}`,
            name: "Featured Courses",
            description: `Featured courses from ${institution.name}`,
            course_count: allCourses.length,
            courses: defaultCourses,
          });
        }

        console.log(`   ✅ Returning ${categoriesWithCourses.length} categories with courses`);

        return {
          id: institution.id,
          name: institution.name,
          logo_url: institution.logo_url,
          type: institution.type,
          slug: institution.slug,
          categories: categoriesWithCourses,
          total_courses: allCourses.length,
        };
      })
    );

    console.log("✅ [getPublicInstitutionsForHomepage] Data prepared successfully");

    res.json({
      success: true,
      data: institutionsWithData,
    });
  } catch (error: any) {
    console.error("❌ Get public institutions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch public institutions",
      error: error.message,
    });
  }
}



static async getInstitutionSettings(req: Request, res: Response) {
  try {
    const { id } = req.params;
    
    const institutionRepo = dbConnection.getRepository(Institution);
    const institution = await institutionRepo.findOne({ where: { id } });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    // Return settings with defaults
    const settings = {
      general: {
        name: institution.name,
        type: institution.type,
        description: institution.description,
        logo_url: institution.logo_url,
      },
      security: institution.settings?.security || {
        require_2fa: false,
        session_timeout: 60,
        max_login_attempts: 5,
        password_complexity: "medium",
      },
      courses: institution.settings?.courses || {
        allow_public_courses: true,
        require_approval_for_spoc: false,
        max_instructors: 10,
      },
      members: institution.settings?.members || {
        allow_self_registration: false,
        require_approval_for_members: true,
        max_members: 100,
      },
      notifications: institution.settings?.notifications || {
        email_notifications: true,
        push_notifications: true,
      },
    };

    res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    console.error("❌ Get settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch institution settings",
      error: error.message,
    });
  }
}

static async updateInstitutionSettings(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const institutionRepo = dbConnection.getRepository(Institution);
    const institution = await institutionRepo.findOne({ where: { id } });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    // Merge settings
    const newSettings = {
      ...institution.settings,
      ...updates,
    };

    institution.settings = newSettings;
    await institutionRepo.save(institution);

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: institution.settings,
    });
  } catch (error: any) {
    console.error("❌ Update settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update institution settings",
      error: error.message,
    });
  }
}

static async updateSecuritySettings(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const securityUpdates = req.body;

    const institutionRepo = dbConnection.getRepository(Institution);
    const institution = await institutionRepo.findOne({ where: { id } });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    // Update security settings
    const settings = institution.settings || {};
    settings.security = {
      ...settings.security,
      ...securityUpdates,
    };

    institution.settings = settings;
    await institutionRepo.save(institution);

    res.json({
      success: true,
      message: "Security settings updated successfully",
      data: settings.security,
    });
  } catch (error: any) {
    console.error("❌ Update security settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update security settings",
      error: error.message,
    });
  }
}


static async createInstitution(req: Request, res: Response) {
  try {
    console.log("\n🏛️ [CREATE INSTITUTION] Starting...");
   
    console.log("📁 Request files:", req.files);
    console.log("📁 Request file (single):", req.file);
    console.log("📁 Request body:", req.body);
    
    if (req.body && typeof req.body === 'object') {
      console.log("📋 Form fields received:");
      Object.keys(req.body).forEach(key => {
        console.log(`  ${key}:`, req.body[key]);
      });
    }
    
    const { 
      name, 
      type, 
      description, 
      settings,
      // Admin user details
      admin_email,
      admin_first_name,
      admin_last_name,
      admin_phone,
      admin_username,
    } = req.body;
    const logoFile = req.file;

    // Validate required fields
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message: "Institution name and type are required",
      });
    }

    if (!admin_email || !admin_first_name || !admin_last_name) {
      return res.status(400).json({
        success: false,
        message: "Admin email, first name, and last name are required",
      });
    }

    if (!Object.values(InstitutionType).includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid institution type",
      });
    }

    const institutionRepo = dbConnection.getRepository(Institution);
    const userRepo = dbConnection.getRepository(User);
    const memberRepo = dbConnection.getRepository(InstitutionMember);

    // Generate unique slug
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Check if slug exists
    const existingSlug = await institutionRepo.findOne({ where: { slug } });
    if (existingSlug) {
      return res.status(400).json({
        success: false,
        message: "Institution with similar name already exists",
      });
    }

    // Check if admin email already exists
    let adminUser = await userRepo.findOne({ where: { email: admin_email } });
    
    // Upload logo if provided
    let logo_url = null;
    if (logoFile) {
      try {
        const uploadResult = await UploadToCloud(logoFile);
        logo_url = uploadResult.secure_url;
        
        if (fs.existsSync(logoFile.path)) {
          fs.unlinkSync(logoFile.path);
        }
      } catch (uploadError: any) {
        console.error("❌ Logo upload failed:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload institution logo",
          error: uploadError.message,
        });
      }
    }

    // Parse settings if provided
    let parsedSettings = {};
    if (settings) {
      try {
        parsedSettings = JSON.parse(settings);
      } catch (parseError) {
        console.warn("⚠️ Failed to parse settings JSON, using empty object");
        parsedSettings = {};
      }
    }

    // Create institution
    const institution = institutionRepo.create({
      name,
      slug,
      type,
      description,
      logo_url,
      settings: parsedSettings,
      is_active: true,
    });

    await institutionRepo.save(institution);
    console.log("✅ Institution created:", institution.id);

    // Generate temporary password for admin
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Create or update admin user
    if (adminUser) {
      // User exists - just update their role
      console.log("⚠️ Admin user already exists, updating role...");
      
      if (!adminUser.institution_ids) {
        adminUser.institution_ids = [];
      }
      if (!adminUser.institution_ids.includes(institution.id)) {
        adminUser.institution_ids.push(institution.id);
      }
      
      adminUser.is_institution_member = true;
      adminUser.bwenge_role = BwengeRole.INSTITUTION_ADMIN;
      adminUser.institution_role = InstitutionRole.ADMIN; // ✅ FIXED: Set institution_role
      
      if (!adminUser.primary_institution_id) {
        adminUser.primary_institution_id = institution.id;
      }
      
      await userRepo.save(adminUser);
      console.log("✅ Existing user updated as institution admin");
    } else {
      // Create new admin user
      console.log("✅ Creating new admin user...");
      
      const username = admin_username || admin_email.split('@')[0] + '_' + Math.random().toString(36).substring(7);
      
      adminUser = userRepo.create({
        email: admin_email,
        password_hash: hashedPassword,
        username,
        first_name: admin_first_name,
        last_name: admin_last_name,
        phone_number: admin_phone || null,
        bwenge_role: BwengeRole.INSTITUTION_ADMIN,
        institution_role: InstitutionRole.ADMIN, // ✅ FIXED: Set institution_role
        is_verified: true,
        is_active: true,
        is_institution_member: true,
        primary_institution_id: institution.id,
        institution_ids: [institution.id],
      });

      await userRepo.save(adminUser);
      console.log("✅ New admin user created");
    }

    // Create institution membership
    const membership = memberRepo.create({
      user_id: adminUser.id,
      institution_id: institution.id,
      role: InstitutionMemberRole.ADMIN,
      is_active: true,
    });

    await memberRepo.save(membership);
    console.log("✅ Admin membership created");

    // Send email to admin with credentials
    try {
      await sendEmail({
        to: admin_email,
        subject: `Welcome as Admin of ${institution.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #5B7FA2;">Welcome to ${institution.name}!</h2>
            <p>You have been assigned as the Institution Administrator.</p>
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Your Login Credentials</h3>
              <p><strong>Email:</strong> ${admin_email}</p>
              <p><strong>Temporary Password:</strong> <code style="background-color: #fff; padding: 5px 10px; border-radius: 4px;">${tempPassword}</code></p>
              <p><strong>Institution:</strong> ${institution.name}</p>
              <p><strong>Your Role:</strong> Institution Administrator</p>
            </div>
            
            <p>Please login at <a href="${process.env.CLIENT_URL}/login">${process.env.CLIENT_URL}/login</a></p>
            <p><strong>Important:</strong> Please change your password after first login for security.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              <p style="color: #666; font-size: 12px;">This is an automated message from BwengePlus Platform.</p>
            </div>
          </div>
        `,
      });
      console.log("✅ Admin credentials email sent");
    } catch (emailError: any) {
      console.warn("⚠️ Failed to send email:", emailError.message);
    }

    return res.status(201).json({
      success: true,
      message: "Institution and admin created successfully",
      data: {
        institution,
        admin: {
          id: adminUser.id,
          email: adminUser.email,
          first_name: adminUser.first_name,
          last_name: adminUser.last_name,
          bwenge_role: adminUser.bwenge_role,
          institution_role: adminUser.institution_role,
          temporary_password: tempPassword,
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Create institution error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create institution",
      error: error.message,
    });
  }
}

// ==================== REPLACE INSTITUTION ADMIN ====================
static async replaceInstitutionAdmin(req: Request, res: Response) {
  try {
    console.log("\n🔄 [REPLACE ADMIN] Starting...");

    const { id } = req.params;
    const {
      new_admin_email,
      new_admin_first_name,
      new_admin_last_name,
      new_admin_phone,
      new_admin_username,
    } = req.body;

    if (!new_admin_email || !new_admin_first_name || !new_admin_last_name) {
      return res.status(400).json({
        success: false,
        message: "New admin email, first name, and last name are required",
      });
    }

    const institutionRepo = dbConnection.getRepository(Institution);
    const userRepo = dbConnection.getRepository(User);
    const memberRepo = dbConnection.getRepository(InstitutionMember);

    // Check if institution exists
    const institution = await institutionRepo.findOne({ where: { id } });
    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    // Find current admin
    const currentAdmin = await memberRepo.findOne({
      where: {
        institution_id: id,
        role: InstitutionMemberRole.ADMIN,
        is_active: true,
      },
      relations: ["user"],
    });

    // Check if new admin email already exists
    let newAdminUser = await userRepo.findOne({ 
      where: { email: new_admin_email } 
    });

    // Generate temporary password for new admin
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Create or update new admin user
    if (newAdminUser) {
      console.log("⚠️ New admin user already exists, updating role...");
      
      if (!newAdminUser.institution_ids) {
        newAdminUser.institution_ids = [];
      }
      if (!newAdminUser.institution_ids.includes(institution.id)) {
        newAdminUser.institution_ids.push(institution.id);
      }
      
      newAdminUser.is_institution_member = true;
      newAdminUser.bwenge_role = BwengeRole.INSTITUTION_ADMIN;
      newAdminUser.institution_role = InstitutionRole.ADMIN; // ✅ FIXED: Set institution_role
      
      if (!newAdminUser.primary_institution_id) {
        newAdminUser.primary_institution_id = institution.id;
      }
      
      await userRepo.save(newAdminUser);
    } else {
      console.log("✅ Creating new admin user...");
      
      const username = new_admin_username || 
        new_admin_email.split('@')[0] + '_' + Math.random().toString(36).substring(7);
      
      newAdminUser = userRepo.create({
        email: new_admin_email,
        password_hash: hashedPassword,
        username,
        first_name: new_admin_first_name,
        last_name: new_admin_last_name,
        phone_number: new_admin_phone || null,
        bwenge_role: BwengeRole.INSTITUTION_ADMIN,
        institution_role: InstitutionRole.ADMIN, // ✅ FIXED: Set institution_role
        is_verified: true,
        is_active: true,
        is_institution_member: true,
        primary_institution_id: institution.id,
        institution_ids: [institution.id],
      });

      await userRepo.save(newAdminUser);
    }

    // Deactivate current admin membership (if exists)
    if (currentAdmin) {
      currentAdmin.is_active = false;
      await memberRepo.save(currentAdmin);
      
      // Downgrade current admin's role if this was their only admin role
      const currentAdminUser = currentAdmin.user;
      const otherAdminMemberships = await memberRepo.count({
        where: {
          user_id: currentAdminUser.id,
          role: InstitutionMemberRole.ADMIN,
          is_active: true,
        },
      });

      if (otherAdminMemberships === 0) {
        currentAdminUser.bwenge_role = BwengeRole.CONTENT_CREATOR;
        currentAdminUser.institution_role = null; // ✅ Reset institution_role
        await userRepo.save(currentAdminUser);
      }

      console.log("✅ Previous admin membership deactivated");
    }

    // Create new admin membership
    const newMembership = memberRepo.create({
      user_id: newAdminUser.id,
      institution_id: institution.id,
      role: InstitutionMemberRole.ADMIN,
      is_active: true,
    });

    await memberRepo.save(newMembership);
    console.log("✅ New admin membership created");

    // Send email to new admin
    try {
      await sendEmail({
        to: new_admin_email,
        subject: `You are now Admin of ${institution.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #5B7FA2;">Welcome as Admin of ${institution.name}!</h2>
            <p>You have been assigned as the new Institution Administrator.</p>
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Your Login Credentials</h3>
              <p><strong>Email:</strong> ${new_admin_email}</p>
              <p><strong>Temporary Password:</strong> <code style="background-color: #fff; padding: 5px 10px; border-radius: 4px;">${tempPassword}</code></p>
              <p><strong>Institution:</strong> ${institution.name}</p>
              <p><strong>Your Role:</strong> Institution Administrator</p>
            </div>
            
            <p>Please login at <a href="${process.env.CLIENT_URL}/login">${process.env.CLIENT_URL}/login</a></p>
            <p><strong>Important:</strong> Please change your password after first login for security.</p>
          </div>
        `,
      });
      console.log("✅ New admin credentials email sent");
    } catch (emailError: any) {
      console.warn("⚠️ Failed to send email:", emailError.message);
    }

    // Notify previous admin if exists
    if (currentAdmin) {
      try {
        await sendEmail({
          to: currentAdmin.user.email,
          subject: `Admin Role Transfer - ${institution.name}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #5B7FA2;">Admin Role Transfer Notice</h2>
              <p>Dear ${currentAdmin.user.first_name},</p>
              <p>This is to inform you that your administrative role for <strong>${institution.name}</strong> has been transferred to a new administrator.</p>
              <p>You will continue to have access to the institution as a member, but with modified permissions.</p>
              <p>If you have any questions, please contact the system administrator.</p>
            </div>
          `,
        });
      } catch (emailError: any) {
        console.warn("⚠️ Failed to send notification to previous admin");
      }
    }

    res.json({
      success: true,
      message: "Institution admin replaced successfully",
      data: {
        institution,
        new_admin: {
          id: newAdminUser.id,
          email: newAdminUser.email,
          first_name: newAdminUser.first_name,
          last_name: newAdminUser.last_name,
          bwenge_role: newAdminUser.bwenge_role,
          institution_role: newAdminUser.institution_role,
          temporary_password: tempPassword,
        },
        previous_admin: currentAdmin ? {
          id: currentAdmin.user.id,
          email: currentAdmin.user.email,
          first_name: currentAdmin.user.first_name,
          last_name: currentAdmin.user.last_name,
        } : null,
      },
    });
  } catch (error: any) {
    console.error("❌ Replace admin error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to replace institution admin",
      error: error.message,
    });
  }
}

  // ==================== GET INSTITUTION ADMIN ====================
  static async getInstitutionAdmin(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      
      const admin = await memberRepo.findOne({
        where: {
          institution_id: id,
          role: InstitutionMemberRole.ADMIN,
          is_active: true,
        },
        relations: ["user"],
      });

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "No active admin found for this institution",
        });
      }

      res.json({
        success: true,
        data: {
          id: admin.user.id,
          email: admin.user.email,
          first_name: admin.user.first_name,
          last_name: admin.user.last_name,
          phone_number: admin.user.phone_number,
          username: admin.user.username,
          profile_picture_url: admin.user.profile_picture_url,
          joined_at: admin.joined_at,
        },
      });
    } catch (error: any) {
      console.error("❌ Get admin error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution admin",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE INSTITUTION ====================
  static async updateInstitution(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const logoFile = req.file;

      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      if (logoFile) {
        try {
          const uploadResult = await UploadToCloud(logoFile);
          updates.logo_url = uploadResult.secure_url;
          
          if (fs.existsSync(logoFile.path)) {
            fs.unlinkSync(logoFile.path);
          }
        } catch (uploadError: any) {
          console.error("❌ Logo upload failed:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload institution logo",
            error: uploadError.message,
          });
        }
      }

      if (updates.settings && typeof updates.settings === "string") {
        updates.settings = JSON.parse(updates.settings);
      }

      Object.assign(institution, updates);
      await institutionRepo.save(institution);

      res.json({
        success: true,
        message: "Institution updated successfully",
        data: institution,
      });
    } catch (error: any) {
      console.error("❌ Update institution error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update institution",
        error: error.message,
      });
    }
  }

  // ==================== TOGGLE INSTITUTION STATUS ====================
  static async toggleInstitutionStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const institutionRepo = dbConnection.getRepository(Institution);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const courseRepo = dbConnection.getRepository(Course);

      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      const newStatus = !institution.is_active;

      // If deactivating, check for active courses
      if (!newStatus) {
        const activeCourses = await courseRepo.count({
          where: {
            institution_id: id,
            status: "PUBLISHED",
          },
        });

        if (activeCourses > 0) {
          return res.status(400).json({
            success: false,
            message: `Cannot deactivate institution with ${activeCourses} active published courses. Please unpublish or archive them first.`,
          });
        }

        // Deactivate all institution members
        await memberRepo.update(
          { institution_id: id, is_active: true },
          { is_active: false }
        );

        console.log("✅ Institution members deactivated");
      } else {
        // If activating, reactivate admin membership
        const adminMember = await memberRepo.findOne({
          where: {
            institution_id: id,
            role: InstitutionMemberRole.ADMIN,
          },
        });

        if (adminMember) {
          adminMember.is_active = true;
          await memberRepo.save(adminMember);
          console.log("✅ Admin membership reactivated");
        }
      }

      // Toggle institution status
      institution.is_active = newStatus;
      await institutionRepo.save(institution);

      // Get updated member count
      const memberCount = await memberRepo.count({
        where: { institution_id: id, is_active: true },
      });

      console.log(`✅ Institution ${newStatus ? "activated" : "deactivated"}`);

      res.json({
        success: true,
        message: `Institution ${newStatus ? "activated" : "deactivated"} successfully`,
        data: {
          ...institution,
          memberCount,
          membersAffected: !newStatus,
        },
      });
    } catch (error: any) {
      console.error("❌ Toggle institution status error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update institution status",
        error: error.message,
      });
    }
  }

// ==================== ACTIVATE INSTITUTION ====================
static async activateInstitution(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const institutionRepo = dbConnection.getRepository(Institution);
    const memberRepo = dbConnection.getRepository(InstitutionMember);

    const institution = await institutionRepo.findOne({ where: { id } });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    if (institution.is_active) {
      return res.status(400).json({
        success: false,
        message: "Institution is already active",
      });
    }

    // Activate institution
    institution.is_active = true;
    await institutionRepo.save(institution);

    // Reactivate admin membership
    const adminMember = await memberRepo.findOne({
      where: {
        institution_id: id,
        role: InstitutionMemberRole.ADMIN,
      },
      relations: ["user"],
    });

    if (adminMember) {
      adminMember.is_active = true;
      await memberRepo.save(adminMember);
      console.log("✅ Admin membership reactivated");

      // Also update the user's institution_role if needed
      if (adminMember.user) {
        adminMember.user.institution_role = InstitutionRole.ADMIN; // ✅ Ensure institution_role is set
        await userRepo.save(adminMember.user);
      }

      // Send notification email to admin
      try {
        await sendEmail({
          to: adminMember.user.email,
          subject: `${institution.name} - Institution Activated`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #10b981;">Institution Activated</h2>
              <p>Dear ${adminMember.user.first_name},</p>
              <p><strong>${institution.name}</strong> has been activated and is now operational.</p>
              <p>You can now access all administrative functions and manage your institution.</p>
              <p>Login at <a href="${process.env.CLIENT_URL}/login">${process.env.CLIENT_URL}/login</a></p>
            </div>
          `,
        });
      } catch (emailError: any) {
        console.warn("⚠️ Failed to send activation email:", emailError.message);
      }
    }

    console.log("✅ Institution activated");

    res.json({
      success: true,
      message: "Institution activated successfully",
      data: institution,
    });
  } catch (error: any) {
    console.error("❌ Activate institution error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to activate institution",
      error: error.message,
    });
  }
}


static async getAllInstitutions(req: Request, res: Response) {
  try {
    const { type, is_active, search } = req.query;

    const institutionRepo = dbConnection.getRepository(Institution);
    const memberRepo = dbConnection.getRepository(InstitutionMember);
    const courseRepo = dbConnection.getRepository(Course);
    const categoryRepo = dbConnection.getRepository(CourseCategory);
    const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
    
    const queryBuilder = institutionRepo.createQueryBuilder("institution");

    // Apply filters
    if (type) {
      queryBuilder.andWhere("institution.type = :type", { type });
    }

    if (is_active !== undefined) {
      queryBuilder.andWhere("institution.is_active = :is_active", {
        is_active: is_active === "true",
      });
    }

    if (search) {
      queryBuilder.andWhere(
        "(institution.name ILIKE :search OR institution.description ILIKE :search)",
        { search: `%${search}%` }
      );
    }

    const institutions = await queryBuilder
      .loadRelationCountAndMap("institution.memberCount", "institution.members")
      .loadRelationCountAndMap("institution.courseCount", "institution.courses")
      .loadRelationCountAndMap("institution.categoryCount", "institution.categories")
      .orderBy("institution.created_at", "DESC")
      .getMany();

    // Fetch detailed information for each institution
    const institutionsWithDetails = await Promise.all(
      institutions.map(async (institution) => {
        // Find the active admin for this institution
        const admin = await memberRepo.findOne({
          where: {
            institution_id: institution.id,
            role: InstitutionMemberRole.ADMIN,
            is_active: true,
          },
          relations: ["user"],
        });

        // Find all active members for this institution
        const members = await memberRepo.find({
          where: {
            institution_id: institution.id,
            is_active: true,
          },
          relations: ["user"],
          order: { joined_at: "DESC" },
        });

        // ==================== ENHANCEMENT: Fetch detailed courses ====================
        // First get courses without nested relations to avoid issues
        const courses = await courseRepo.find({
          where: {
            institution_id: institution.id,
          },
          relations: ["instructor", "course_category"],
          order: { created_at: "DESC" },
          take: 20,
        });

        // Then fetch additional instructors for each course separately
        const coursesWithInstructors = await Promise.all(
          courses.map(async (course) => {
            // Fetch additional instructors for this course
            const additionalInstructors = await courseInstructorRepo.find({
              where: {
                course_id: course.id,
              },
              relations: ["instructor"],
            });

            return {
              id: course.id,
              title: course.title,
              description: course.description,
              short_description: course.short_description,
              thumbnail_url: course.thumbnail_url,
              category: course.category,
              tags: course.tags,
              course_type: course.course_type,
              is_public: course.is_public,
              access_codes: course.access_codes,
              requires_approval: course.requires_approval,
              max_enrollments: course.max_enrollments,
              enrollment_start_date: course.enrollment_start_date,
              enrollment_end_date: course.enrollment_end_date,
              is_institution_wide: course.is_institution_wide,
              level: course.level,
              status: course.status,
              enrollment_count: course.enrollment_count,
              completion_rate: course.completion_rate,
              average_rating: course.average_rating,
              total_reviews: course.total_reviews,
              duration_minutes: course.duration_minutes,
              total_lessons: course.total_lessons,
              price: course.price,
              is_certificate_available: course.is_certificate_available,
              requirements: course.requirements,
              what_you_will_learn: course.what_you_will_learn,
              language: course.language,
              created_at: course.created_at,
              updated_at: course.updated_at,
              published_at: course.published_at,
              
              // Enhanced relations
              instructor: course.instructor ? {
                id: course.instructor.id,
                email: course.instructor.email,
                username: course.instructor.username,
                first_name: course.instructor.first_name,
                last_name: course.instructor.last_name,
                profile_picture_url: course.instructor.profile_picture_url,
              } : null,
              
              course_category: course.course_category ? {
                id: course.course_category.id,
                name: course.course_category.name,
                description: course.course_category.description,
                order_index: course.course_category.order_index,
                is_active: course.course_category.is_active,
              } : null,
              
              additional_instructors: additionalInstructors.map(ci => ({
                id: ci.instructor.id,
                email: ci.instructor.email,
                username: ci.instructor.username,
                first_name: ci.instructor.first_name,
                last_name: ci.instructor.last_name,
                profile_picture_url: ci.instructor.profile_picture_url,
                is_primary_instructor: ci.is_primary_instructor,
                permissions: {
                  can_grade_assignments: ci.can_grade_assignments,
                  can_manage_enrollments: ci.can_manage_enrollments,
                  can_edit_course_content: ci.can_edit_course_content,
                },
                assigned_at: ci.assigned_at,
              })),
            };
          })
        );

        // ==================== ENHANCEMENT: Fetch course categories ====================
        const categories = await categoryRepo.find({
          where: {
            institution_id: institution.id,
            is_active: true,
          },
          relations: ["parent_category", "subcategories"],
          order: { order_index: "ASC" },
        });

        const formattedCategories = categories.map((category) => ({
          id: category.id,
          name: category.name,
          description: category.description,
          parent_category_id: category.parent_category_id,
          parent_category: category.parent_category ? {
            id: category.parent_category.id,
            name: category.parent_category.name,
          } : null,
          subcategories: category.subcategories?.map(sub => ({
            id: sub.id,
            name: sub.name,
            description: sub.description,
            order_index: sub.order_index,
          })) || [],
          order_index: category.order_index,
          is_active: category.is_active,
          created_at: category.created_at,
          updated_at: category.updated_at,
        }));

        // Format members data (excluding passwords)
        const formattedMembers = members.map((member) => ({
          // Member information
          member_id: member.id,
          role: member.role,
          is_active: member.is_active,
          joined_at: member.joined_at,
          additional_permissions: member.additional_permissions,
          // User information
          user: {
            id: member.user.id,
            email: member.user.email,
            username: member.user.username,
            first_name: member.user.first_name,
            last_name: member.user.last_name,
            phone_number: member.user.phone_number,
            profile_picture_url: member.user.profile_picture_url,
            bio: member.user.bio,
            account_type: member.user.account_type,
            bwenge_role: member.user.bwenge_role,
            institution_role: member.user.institution_role,
            is_verified: member.user.is_verified,
            is_active: member.user.is_active,
            date_joined: member.user.date_joined,
            last_login: member.user.last_login,
            country: member.user.country,
            city: member.user.city,
            enrolled_courses_count: member.user.enrolled_courses_count,
            completed_courses_count: member.user.completed_courses_count,
            total_learning_hours: member.user.total_learning_hours,
            certificates_earned: member.user.certificates_earned,
          },
        }));

        // Calculate course statistics
        const [courseTypeStats, courseStatusStats, courseLevelStats, enrollmentTotal, averageRating] = await Promise.all([
          courseRepo
            .createQueryBuilder("course")
            .select("course.course_type, COUNT(*) as count")
            .where("course.institution_id = :institutionId", { institutionId: institution.id })
            .groupBy("course.course_type")
            .getRawMany(),
          courseRepo
            .createQueryBuilder("course")
            .select("course.status, COUNT(*) as count")
            .where("course.institution_id = :institutionId", { institutionId: institution.id })
            .groupBy("course.status")
            .getRawMany(),
          courseRepo
            .createQueryBuilder("course")
            .select("course.level, COUNT(*) as count")
            .where("course.institution_id = :institutionId", { institutionId: institution.id })
            .groupBy("course.level")
            .getRawMany(),
          courseRepo
            .createQueryBuilder("course")
            .select("SUM(course.enrollment_count)", "total")
            .where("course.institution_id = :institutionId", { institutionId: institution.id })
            .getRawOne(),
          courseRepo
            .createQueryBuilder("course")
            .select("AVG(course.average_rating)", "average")
            .where("course.institution_id = :institutionId", { institutionId: institution.id })
            .andWhere("course.average_rating > 0")
            .getRawOne(),
        ]);

        // Return institution with all enhanced details
        return {
          ...institution,
          admin: admin ? {
            member_id: admin.id,
            role: admin.role,
            is_active: admin.is_active,
            joined_at: admin.joined_at,
            additional_permissions: admin.additional_permissions,
            user: {
              id: admin.user.id,
              email: admin.user.email,
              username: admin.user.username,
              first_name: admin.user.first_name,
              last_name: admin.user.last_name,
              phone_number: admin.user.phone_number,
              profile_picture_url: admin.user.profile_picture_url,
              bio: admin.user.bio,
              account_type: admin.user.account_type,
              bwenge_role: admin.user.bwenge_role,
              institution_role: admin.user.institution_role,
              is_verified: admin.user.is_verified,
              is_active: admin.user.is_active,
              date_joined: admin.user.date_joined,
              last_login: admin.user.last_login,
              country: admin.user.country,
              city: admin.user.city,
              enrolled_courses_count: admin.user.enrolled_courses_count,
              completed_courses_count: admin.user.completed_courses_count,
              total_learning_hours: admin.user.total_learning_hours,
              certificates_earned: admin.user.certificates_earned,
            },
          } : null,
          members: formattedMembers,
          
          // ==================== ENHANCED DATA ====================
          courses: {
            total: institution.courseCount,
            recent: coursesWithInstructors,
          },
          categories: {
            total: institution.categoryCount,
            items: formattedCategories,
          },
          // Course statistics
          course_statistics: {
            total: institution.courseCount,
            by_type: courseTypeStats,
            by_status: courseStatusStats,
            by_level: courseLevelStats,
            total_enrollments: enrollmentTotal,
            average_rating: averageRating,
          },
        };
      })
    );

    res.json({
      success: true,
      data: institutionsWithDetails,
    });
  } catch (error: any) {
    console.error("❌ Get institutions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch institutions",
      error: error.message,
    });
  }
}


static async getInstitutionById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const institutionRepo = dbConnection.getRepository(Institution);
    const memberRepo = dbConnection.getRepository(InstitutionMember);
    const courseRepo = dbConnection.getRepository(Course);
    const categoryRepo = dbConnection.getRepository(CourseCategory);
    const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
    const moduleRepo = dbConnection.getRepository(Module);
    const lessonRepo = dbConnection.getRepository(Lesson);
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const reviewRepo = dbConnection.getRepository(Review);
    
    const institution = await institutionRepo
      .createQueryBuilder("institution")
      .where("institution.id = :id", { id })
      .loadRelationCountAndMap("institution.memberCount", "institution.members")
      .loadRelationCountAndMap("institution.courseCount", "institution.courses")
      .loadRelationCountAndMap("institution.categoryCount", "institution.categories")
      .getOne();

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    // Find the active admin for this institution
    const admin = await memberRepo.findOne({
      where: {
        institution_id: id,
        role: InstitutionMemberRole.ADMIN,
        is_active: true,
      },
      relations: ["user"],
    });

    // Find all active members for this institution
    const members = await memberRepo.find({
      where: {
        institution_id: id,
        is_active: true,
      },
      relations: ["user"],
      order: { joined_at: "DESC" },
    });

    // ==================== ENHANCEMENT: Fetch detailed courses ====================
    // First get courses without problematic nested relations
    const courses = await courseRepo.find({
      where: {
        institution_id: id,
      },
      relations: ["instructor", "course_category"],
      order: { created_at: "DESC" },
    });

    // Then enrich each course with additional data
    const coursesWithDetails = await Promise.all(
      courses.map(async (course) => {
        // Fetch additional data in parallel
        const [additionalInstructors, modules, lessons, enrollments, reviews] = await Promise.all([
          courseInstructorRepo.find({
            where: { course_id: course.id },
            relations: ["instructor"],
          }),
          moduleRepo.find({
            where: { course_id: course.id },
            order: { order_index: "ASC" },
          }),
          lessonRepo.find({
            where: { course_id: course.id },
            order: { order_index: "ASC" },
          }),
          enrollmentRepo.find({
            where: { course_id: course.id },
            order: { enrolled_at: "DESC" },
            take: 5,
          }),
          reviewRepo.find({
            where: { course_id: course.id },
            relations: ["user"],
            order: { created_at: "DESC" },
            take: 3,
          }),
        ]);

        return {
          id: course.id,
          title: course.title,
          description: course.description,
          short_description: course.short_description,
          thumbnail_url: course.thumbnail_url,
          category: course.category,
          tags: course.tags,
          course_type: course.course_type,
          is_public: course.is_public,
          access_codes: course.access_codes,
          requires_approval: course.requires_approval,
          max_enrollments: course.max_enrollments,
          enrollment_start_date: course.enrollment_start_date,
          enrollment_end_date: course.enrollment_end_date,
          is_institution_wide: course.is_institution_wide,
          level: course.level,
          status: course.status,
          enrollment_count: course.enrollment_count,
          completion_rate: course.completion_rate,
          average_rating: course.average_rating,
          total_reviews: course.total_reviews,
          duration_minutes: course.duration_minutes,
          total_lessons: course.total_lessons,
          price: course.price,
          is_certificate_available: course.is_certificate_available,
          requirements: course.requirements,
          what_you_will_learn: course.what_you_will_learn,
          language: course.language,
          created_at: course.created_at,
          updated_at: course.updated_at,
          published_at: course.published_at,
          
          // Enhanced relations
          instructor: course.instructor ? {
            id: course.instructor.id,
            email: course.instructor.email,
            username: course.instructor.username,
            first_name: course.instructor.first_name,
            last_name: course.instructor.last_name,
            profile_picture_url: course.instructor.profile_picture_url,
          } : null,
          
          course_category: course.course_category ? {
            id: course.course_category.id,
            name: course.course_category.name,
            description: course.course_category.description,
            order_index: course.course_category.order_index,
            is_active: course.course_category.is_active,
          } : null,
          
          modules: modules.map(module => ({
            id: module.id,
            title: module.title,
            description: module.description,
            order_index: module.order_index,
            created_at: module.created_at,
          })),
          
          lessons: lessons.map(lesson => ({
            id: lesson.id,
            title: lesson.title,
            lesson_type: lesson.lesson_type,
            duration_minutes: lesson.duration_minutes,
            order_index: lesson.order_index,
            is_published: lesson.is_published,
          })),
          
          additional_instructors: additionalInstructors.map(ci => ({
            id: ci.instructor.id,
            email: ci.instructor.email,
            username: ci.instructor.username,
            first_name: ci.instructor.first_name,
            last_name: ci.instructor.last_name,
            profile_picture_url: ci.instructor.profile_picture_url,
            is_primary_instructor: ci.is_primary_instructor,
            permissions: {
              can_grade_assignments: ci.can_grade_assignments,
              can_manage_enrollments: ci.can_manage_enrollments,
              can_edit_course_content: ci.can_edit_course_content,
            },
            assigned_at: ci.assigned_at,
          })),
          
          enrollments_summary: {
            total: course.enrollment_count,
            recent: enrollments.map(enrollment => ({
              id: enrollment.id,
              user_id: enrollment.user_id,
              enrolled_at: enrollment.enrolled_at,
              completion_percentage: enrollment.completion_percentage,
            })),
          },
          
          reviews_summary: {
            average_rating: course.average_rating,
            total_reviews: course.total_reviews,
            recent: reviews.map(review => ({
              id: review.id,
              rating: review.rating,
              comment: review.comment,
              created_at: review.created_at,
              user: review.user ? {
                id: review.user.id,
                first_name: review.user.first_name,
                last_name: review.user.last_name,
                profile_picture_url: review.user.profile_picture_url,
              } : null,
            })),
          },
        };
      })
    );

    // ==================== ENHANCEMENT: Fetch course categories ====================
    const categories = await categoryRepo.find({
      where: {
        institution_id: id,
        is_active: true,
      },
      relations: ["parent_category", "subcategories"],
      order: { order_index: "ASC" },
    });

    // Get course counts for categories
    const categoriesWithCourseCounts = await Promise.all(
      categories.map(async (category) => {
        const courseCount = await courseRepo.count({
          where: {
            category_id: category.id,
          },
        });

        const coursesPreview = await courseRepo.find({
          where: {
            category_id: category.id,
          },
          select: ["id", "title", "status", "enrollment_count", "average_rating"],
          take: 5,
        });

        return {
          id: category.id,
          name: category.name,
          description: category.description,
          parent_category_id: category.parent_category_id,
          parent_category: category.parent_category ? {
            id: category.parent_category.id,
            name: category.parent_category.name,
          } : null,
          subcategories: category.subcategories?.map(sub => ({
            id: sub.id,
            name: sub.name,
            description: sub.description,
            order_index: sub.order_index,
          })) || [],
          order_index: category.order_index,
          is_active: category.is_active,
          created_at: category.created_at,
          updated_at: category.updated_at,
          course_count: courseCount,
          courses_preview: coursesPreview.map(course => ({
            id: course.id,
            title: course.title,
            status: course.status,
            enrollment_count: course.enrollment_count,
            average_rating: course.average_rating,
          })),
        };
      })
    );

    // Format members data
    const formattedMembers = members.map((member) => ({
      member_id: member.id,
      role: member.role,
      is_active: member.is_active,
      joined_at: member.joined_at,
      additional_permissions: member.additional_permissions,
      user: {
        id: member.user.id,
        email: member.user.email,
        username: member.user.username,
        first_name: member.user.first_name,
        last_name: member.user.last_name,
        phone_number: member.user.phone_number,
        profile_picture_url: member.user.profile_picture_url,
        bio: member.user.bio,
        account_type: member.user.account_type,
        bwenge_role: member.user.bwenge_role,
        institution_role: member.user.institution_role,
        is_verified: member.user.is_verified,
        is_active: member.user.is_active,
        date_joined: member.user.date_joined,
        last_login: member.user.last_login,
        country: member.user.country,
        city: member.user.city,
        enrolled_courses_count: member.user.enrolled_courses_count,
        completed_courses_count: member.user.completed_courses_count,
        total_learning_hours: member.user.total_learning_hours,
        certificates_earned: member.user.certificates_earned,
      },
    }));

    // Calculate comprehensive statistics
    const [
      courseTypeStats,
      courseStatusStats,
      courseLevelStats,
      enrollmentTotal,
      averageRating,
      totalDuration,
      totalLessons,
      instructorCount,
      activeLearnerCount
    ] = await Promise.all([
      courseRepo
        .createQueryBuilder("course")
        .select("course.course_type, COUNT(*) as count")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .groupBy("course.course_type")
        .getRawMany(),
      courseRepo
        .createQueryBuilder("course")
        .select("course.status, COUNT(*) as count")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .groupBy("course.status")
        .getRawMany(),
      courseRepo
        .createQueryBuilder("course")
        .select("course.level, COUNT(*) as count")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .groupBy("course.level")
        .getRawMany(),
      courseRepo
        .createQueryBuilder("course")
        .select("SUM(course.enrollment_count)", "total")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .getRawOne(),
      courseRepo
        .createQueryBuilder("course")
        .select("AVG(course.average_rating)", "average")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .andWhere("course.average_rating > 0")
        .getRawOne(),
      courseRepo
        .createQueryBuilder("course")
        .select("SUM(course.duration_minutes)", "total")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .getRawOne(),
      courseRepo
        .createQueryBuilder("course")
        .select("SUM(course.total_lessons)", "total")
        .where("course.institution_id = :institutionId", { institutionId: id })
        .getRawOne(),
      memberRepo
        .createQueryBuilder("member")
        .select("COUNT(DISTINCT member.user_id)", "count")
        .where("member.institution_id = :institutionId", { institutionId: id })
        .andWhere("member.is_active = true")
        .getRawOne(),
      memberRepo
        .createQueryBuilder("member")
        .innerJoin("member.user", "user")
        .select("COUNT(DISTINCT member.user_id)", "count")
        .where("member.institution_id = :institutionId", { institutionId: id })
        .andWhere("member.is_active = true")
        .andWhere("user.enrolled_courses_count > 0")
        .getRawOne(),
    ]);

    // Add admin info and enhanced data to institution response
    const institutionWithDetails = {
      ...institution,
      admin: admin ? {
        member_id: admin.id,
        role: admin.role,
        is_active: admin.is_active,
        joined_at: admin.joined_at,
        additional_permissions: admin.additional_permissions,
        user: {
          id: admin.user.id,
          email: admin.user.email,
          username: admin.user.username,
          first_name: admin.user.first_name,
          last_name: admin.user.last_name,
          phone_number: admin.user.phone_number,
          profile_picture_url: admin.user.profile_picture_url,
          bio: admin.user.bio,
          account_type: admin.user.account_type,
          bwenge_role: admin.user.bwenge_role,
          institution_role: admin.user.institution_role,
          is_verified: admin.user.is_verified,
          is_active: admin.user.is_active,
          date_joined: admin.user.date_joined,
          last_login: admin.user.last_login,
          country: admin.user.country,
          city: admin.user.city,
          enrolled_courses_count: admin.user.enrolled_courses_count,
          completed_courses_count: admin.user.completed_courses_count,
          total_learning_hours: admin.user.total_learning_hours,
          certificates_earned: admin.user.certificates_earned,
        },
      } : null,
      members: formattedMembers,
      
      // ==================== ENHANCED DATA ====================
      courses: {
        total: institution.courseCount,
        items: coursesWithDetails,
      },
      categories: {
        total: institution.categoryCount,
        items: categoriesWithCourseCounts,
      },
      
      // Statistics
      statistics: {
        members: institution.memberCount,
        courses: {
          total: institution.courseCount,
          by_type: courseTypeStats,
          by_status: courseStatusStats,
          by_level: courseLevelStats,
          total_enrollments: enrollmentTotal,
          total_rating: averageRating,
          total_duration: totalDuration,
          total_lessons: totalLessons,
        },
        categories: institution.categoryCount,
        instructors: instructorCount,
        active_learners: activeLearnerCount,
      },
      
      // Recent activity
      recent_activity: {
        new_courses: coursesWithDetails
          .filter(course => 
            new Date(course.created_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
          )
          .slice(0, 5),
        updated_courses: coursesWithDetails
          .filter(course => 
            new Date(course.updated_at).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000 &&
            course.created_at !== course.updated_at
          )
          .slice(0, 5),
        new_members: formattedMembers
          .filter(member => 
            new Date(member.joined_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
          )
          .slice(0, 10),
      },
    };

    res.json({
      success: true,
      data: institutionWithDetails,
    });
  } catch (error: any) {
    console.error("❌ Get institution error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch institution",
      error: error.message,
    });
  }
}


  static async deactivateInstitution(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const institutionRepo = dbConnection.getRepository(Institution);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);

      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      if (!institution.is_active) {
        return res.status(400).json({
          success: false,
          message: "Institution is already inactive",
        });
      }

      // Check for active published courses
      const activeCourses = await courseRepo.count({
        where: {
          institution_id: id,
          status: "PUBLISHED",
        },
      });

      if (activeCourses > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot deactivate institution with ${activeCourses} active published courses. Please unpublish or archive them first.`,
          data: {
            active_courses: activeCourses,
          },
        });
      }

      // Get all active members before deactivation
      const activeMembers = await memberRepo.find({
        where: {
          institution_id: id,
          is_active: true,
        },
        relations: ["user"],
      });

      // Deactivate institution
      institution.is_active = false;
      await institutionRepo.save(institution);

      // Deactivate all memberships
      await memberRepo.update(
        { institution_id: id, is_active: true },
        { is_active: false }
      );

      // Update users who had this as primary institution
      for (const member of activeMembers) {
        const user = await userRepo.findOne({
          where: { id: member.user_id },
        });

        if (user && user.primary_institution_id === id) {
          // Find another active institution for this user
          const otherMembership = await memberRepo.findOne({
            where: {
              user_id: user.id,
              is_active: true,
            },
            relations: ["institution"],
          });

          if (otherMembership) {
            user.primary_institution_id = otherMembership.institution_id;
          } else {
            user.primary_institution_id = null;
            user.is_institution_member = false;
            
            // Downgrade role if they were institution admin
            if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
              user.bwenge_role = BwengeRole.CONTENT_CREATOR;
            }
          }

          await userRepo.save(user);
        }
      }

      console.log(`✅ Institution deactivated - ${activeMembers.length} members affected`);

      // Send notification emails to all members
      for (const member of activeMembers) {
        try {
          await sendEmail({
            to: member.user.email,
            subject: `${institution.name} - Institution Deactivated`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #ef4444;">Institution Deactivated</h2>
                <p>Dear ${member.user.first_name},</p>
                <p><strong>${institution.name}</strong> has been deactivated.</p>
                ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
                <p>You will no longer have access to institution resources until it is reactivated.</p>
                <p>If you have questions, please contact the system administrator.</p>
              </div>
            `,
          });
        } catch (emailError: any) {
          console.warn(`⚠️ Failed to send email to ${member.user.email}`);
        }
      }

      res.json({
        success: true,
        message: "Institution deactivated successfully",
        data: {
          institution,
          members_affected: activeMembers.length,
          reason: reason || null,
        },
      });
    } catch (error: any) {
      console.error("❌ Deactivate institution error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to deactivate institution",
        error: error.message,
      });
    }
  }


  // ==================== DELETE INSTITUTION ====================
  static async deleteInstitution(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const institutionRepo = dbConnection.getRepository(Institution);
      const courseRepo = dbConnection.getRepository(Course);

      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Check for active courses
      const activeCourses = await courseRepo.count({
        where: {
          institution_id: id,
          status: "PUBLISHED",
        },
      });

      if (activeCourses > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete institution with ${activeCourses} active courses`,
        });
      }

      // Soft delete
      institution.is_active = false;
      await institutionRepo.save(institution);

      res.json({
        success: true,
        message: "Institution deactivated successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete institution error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete institution",
        error: error.message,
      });
    }
  }

  // ==================== GET INSTITUTION MEMBERS ====================
  static async getInstitutionMembers(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { role, is_active, search, page = "1", limit = "15" } = req.query;

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      
      // Build query with filters
      const queryBuilder = memberRepo
        .createQueryBuilder("member")
        .leftJoinAndSelect("member.user", "user")
        .where("member.institution_id = :institutionId", { institutionId: id });

      // Filter by role if provided
      if (role && role !== "ALL") {
        queryBuilder.andWhere("member.role = :role", { role });
      }

      // Filter by active status if provided
      if (is_active !== undefined) {
        queryBuilder.andWhere("member.is_active = :is_active", { 
          is_active: is_active === "true" 
        });
      }

      // Search by name or email if provided
      if (search) {
        queryBuilder.andWhere(
          "(user.first_name ILIKE :search OR user.last_name ILIKE :search OR user.email ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      // Get total count before pagination
      const total = await queryBuilder.getCount();

      // Apply pagination
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      queryBuilder
        .orderBy("member.joined_at", "DESC")
        .skip((pageNum - 1) * limitNum)
        .take(limitNum);

      const members = await queryBuilder.getMany();

      const sanitizedMembers = members.map((member) => ({
        member_id: member.id,
        role: member.role,
        joined_at: member.joined_at,
        is_active: member.is_active,
        additional_permissions: member.additional_permissions,
        user: {
          id: member.user.id,
          email: member.user.email,
          username: member.user.username,
          first_name: member.user.first_name,
          last_name: member.user.last_name,
          phone_number: member.user.phone_number,
          profile_picture_url: member.user.profile_picture_url,
          bio: member.user.bio,
          account_type: member.user.account_type,
          bwenge_role: member.user.bwenge_role,
          institution_role: member.user.institution_role,
          is_verified: member.user.is_verified,
          is_active: member.user.is_active,
          date_joined: member.user.date_joined,
          last_login: member.user.last_login,
          country: member.user.country,
          city: member.user.city,
          enrolled_courses_count: member.user.enrolled_courses_count,
          completed_courses_count: member.user.completed_courses_count,
          total_learning_hours: member.user.total_learning_hours,
          certificates_earned: member.user.certificates_earned,
        },
      }));

      res.json({
        success: true,
        data: {
          members: sanitizedMembers,
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error: any) {
      console.error("❌ Get members error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch members",
        error: error.message,
      });
    }
  }

// ==================== ADD THESE METHODS TO InstitutionController ====================

// Check if user is a member of institution
static async checkUserIsMember(req: Request, res: Response) {
  try {
    const { id, userId } = req.params;

    const memberRepo = dbConnection.getRepository(InstitutionMember);
    
    const member = await memberRepo.findOne({
      where: {
        institution_id: id,
        user_id: userId,
      },
    });

    return res.json({
      success: true,
      isMember: member ? member.is_active : false,
      member: member || null,
    });
  } catch (error: any) {
    console.error("❌ Check member error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check member status",
      error: error.message,
    });
  }
}

static async addMemberToInstitution(req: Request, res: Response) {
  try {
    console.log("\n👥 [ADD MEMBER TO INSTITUTION] Starting...");
    console.log("📝 Request params:", req.params);
    console.log("📝 Request body:", req.body);

    const { id } = req.params;
    const { email, role, send_invitation, new_user_data } = req.body;

    // Validate required fields
    if (!email || !role) {
      return res.status(400).json({
        success: false,
        message: "Email and role are required",
      });
    }

    // Validate role
    if (!Object.values(InstitutionMemberRole).includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified",
      });
    }

    const userRepo = dbConnection.getRepository(User);
    const institutionRepo = dbConnection.getRepository(Institution);
    const memberRepo = dbConnection.getRepository(InstitutionMember);

    // Find institution
    const institution = await institutionRepo.findOne({ where: { id } });
    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    console.log(`🏛️ Found institution: ${institution.name}`);

    // Check if user exists
    let user = await userRepo.findOne({ where: { email } });
    let isNewUser = false;
    let tempPassword = "";

    if (!user) {
      // User doesn't exist - validate new user data
      if (!new_user_data) {
        return res.status(400).json({
          success: false,
          message: "New user data is required for non-existing users",
        });
      }

      const { first_name, last_name, username, phone_number } = new_user_data;

      if (!first_name || !last_name || !username) {
        return res.status(400).json({
          success: false,
          message: "First name, last name, and username are required for new users",
        });
      }

      console.log("👤 User not found, creating new user...");
      isNewUser = true;

      // Check if username is already taken
      const existingUsername = await userRepo.findOne({ where: { username } });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: "Username is already taken. Please choose a different username.",
        });
      }

      // Generate temporary password
      tempPassword = crypto.randomBytes(8).toString("hex");
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // Map role to bwenge_role and institution_role
      let bwengeRole: BwengeRole;
      let institutionRole: InstitutionRole;

      switch (role) {
        case InstitutionMemberRole.ADMIN:
          bwengeRole = BwengeRole.INSTITUTION_ADMIN;
          institutionRole = InstitutionRole.ADMIN;
          break;
        case InstitutionMemberRole.CONTENT_CREATOR:
          bwengeRole = BwengeRole.CONTENT_CREATOR;
          institutionRole = InstitutionRole.CONTENT_CREATOR;
          break;
        case InstitutionMemberRole.INSTRUCTOR:
          bwengeRole = BwengeRole.INSTRUCTOR;
          institutionRole = InstitutionRole.INSTRUCTOR;
          break;
        case InstitutionMemberRole.MEMBER:
        default:
          bwengeRole = BwengeRole.LEARNER;
          institutionRole = InstitutionRole.MEMBER;
          break;
      }

      // Create new user
      user = userRepo.create({
        email,
        password_hash: hashedPassword,
        username,
        first_name,
        last_name,
        phone_number: phone_number || null,
        bwenge_role: bwengeRole,
        institution_role: institutionRole,
        is_verified: false,
        is_active: true,
        is_institution_member: true,
        primary_institution_id: id,
        institution_ids: [id],
        date_joined: new Date(),
      });

      await userRepo.save(user);
      console.log(`✅ New user created with ID: ${user.id}`);
    } else {
      // User exists
      console.log(`✅ Found existing user: ${user.id}`);

      // Check if already a member of this institution
      const existingMember = await memberRepo.findOne({
        where: { user_id: user.id, institution_id: id },
      });

      if (existingMember) {
        if (existingMember.is_active) {
          console.log("⚠️ User is already an active member");
          return res.status(400).json({
            success: false,
            message: "User is already an active member of this institution",
          });
        } else {
          // Reactivate existing membership
          console.log("🔄 Reactivating existing membership");
          existingMember.is_active = true;
          existingMember.role = role as InstitutionMemberRole;
          await memberRepo.save(existingMember);

          // Update user's institution role to match
          let bwengeRole: BwengeRole;
          let institutionRole: InstitutionRole;

          switch (role) {
            case InstitutionMemberRole.ADMIN:
              bwengeRole = BwengeRole.INSTITUTION_ADMIN;
              institutionRole = InstitutionRole.ADMIN;
              break;
            case InstitutionMemberRole.CONTENT_CREATOR:
              bwengeRole = BwengeRole.CONTENT_CREATOR;
              institutionRole = InstitutionRole.CONTENT_CREATOR;
              break;
            case InstitutionMemberRole.INSTRUCTOR:
              bwengeRole = BwengeRole.INSTRUCTOR;
              institutionRole = InstitutionRole.INSTRUCTOR;
              break;
            case InstitutionMemberRole.MEMBER:
            default:
              bwengeRole = BwengeRole.LEARNER;
              institutionRole = InstitutionRole.MEMBER;
              break;
          }

          user.bwenge_role = bwengeRole;
          user.institution_role = institutionRole;
          user.is_institution_member = true;

          if (!user.institution_ids) {
            user.institution_ids = [];
          }
          if (!user.institution_ids.includes(id)) {
            user.institution_ids.push(id);
          }

          await userRepo.save(user);

          // Send invitation email if requested
          if (send_invitation) {
            try {
              console.log(`📧 Sending reactivation email to ${email}...`);
              await InstitutionController.sendInvitationEmail(
                email,
                institution.name,
                role,
                false,
                ""
              );
              console.log("✅ Reactivation email sent");
            } catch (emailError: any) {
              console.warn("⚠️ Failed to send email:", emailError.message);
            }
          }

          return res.status(200).json({
            success: true,
            message: "Member reactivated successfully",
            data: {
              member: existingMember,
              user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                username: user.username,
                bwenge_role: user.bwenge_role,
                institution_role: user.institution_role,
              },
              is_new_user: false,
            },
          });
        }
      }

      // User exists but is not a member - add them
      console.log("✅ Adding existing user as new member...");

      // Update user's institution arrays and roles
      if (!user.institution_ids) {
        user.institution_ids = [];
      }
      if (!user.institution_ids.includes(id)) {
        user.institution_ids.push(id);
      }

      user.is_institution_member = true;

      if (!user.primary_institution_id) {
        user.primary_institution_id = id;
      }

      // Map role to bwenge_role and institution_role
      let bwengeRole: BwengeRole;
      let institutionRole: InstitutionRole;

      switch (role) {
        case InstitutionMemberRole.ADMIN:
          bwengeRole = BwengeRole.INSTITUTION_ADMIN;
          institutionRole = InstitutionRole.ADMIN;
          break;
        case InstitutionMemberRole.CONTENT_CREATOR:
          bwengeRole = BwengeRole.CONTENT_CREATOR;
          institutionRole = InstitutionRole.CONTENT_CREATOR;
          break;
        case InstitutionMemberRole.INSTRUCTOR:
          bwengeRole = BwengeRole.INSTRUCTOR;
          institutionRole = InstitutionRole.INSTRUCTOR;
          break;
        case InstitutionMemberRole.MEMBER:
        default:
          bwengeRole = BwengeRole.LEARNER;
          institutionRole = InstitutionRole.MEMBER;
          break;
      }

      user.bwenge_role = bwengeRole;
      user.institution_role = institutionRole;

      await userRepo.save(user);
      console.log(`✅ User updated with institution membership`);
    }

    // Create new membership
    console.log("✅ Creating new membership...");
    const member = memberRepo.create({
      user_id: user.id,
      institution_id: id,
      role: role as InstitutionMemberRole,
      is_active: true,
      joined_at: new Date(),
    });

    await memberRepo.save(member);
    console.log(`✅ Membership created with ID: ${member.id}`);

    // Send invitation email if requested
    let emailSent = false;
    if (send_invitation) {
      try {
        console.log(`📧 Sending invitation email to ${email}...`);
        await InstitutionController.sendInvitationEmail(
          email,
          institution.name,
          role,
          isNewUser,
          tempPassword
        );
        emailSent = true;
        console.log("✅ Invitation email sent successfully");
      } catch (emailError: any) {
        console.warn("⚠️ Failed to send invitation email:", emailError.message);
        emailSent = false;
      }
    }

    console.log("✅ Member addition process completed successfully");

    // Return success response
    return res.status(201).json({
      success: true,
      message: "Member added successfully",
      data: {
        member: {
          id: member.id,
          user_id: member.user_id,
          institution_id: member.institution_id,
          role: member.role,
          is_active: member.is_active,
          joined_at: member.joined_at,
        },
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
          bwenge_role: user.bwenge_role,
          institution_role: user.institution_role,
          is_new_user: isNewUser,
        },
        institution: {
          id: institution.id,
          name: institution.name,
          type: institution.type,
        },
        notification: {
          email_sent: emailSent,
          temporary_password: isNewUser ? tempPassword : undefined,
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Add member error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add member",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}


// Helper method to send invitation email
private static async sendInvitationEmail(
  email: string, 
  institutionName: string, 
  role: string, 
  isNewUser: boolean, 
  tempPassword?: string
) {
  const emailContent = isNewUser ? `
    <h2>Welcome to ${institutionName}!</h2>
    <p>You have been invited to join <strong>${institutionName}</strong> as a ${role}.</p>
    <p>Your account has been created with the following credentials:</p>
    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
    </div>
    <p>Please login at <a href="${process.env.CLIENT_URL || 'https://your-platform.com'}/login">${process.env.CLIENT_URL || 'https://your-platform.com'}/login</a></p>
    <p><strong>Important:</strong> Please change your password after first login.</p>
  ` : `
    <h2>Welcome to ${institutionName}!</h2>
    <p>You have been added as a ${role} to <strong>${institutionName}</strong>.</p>
    <p>You can now access the institution resources using your existing account.</p>
    <p>Visit <a href="${process.env.CLIENT_URL || 'https://your-platform.com'}">${process.env.CLIENT_URL || 'https://your-platform.com'}</a> to get started.</p>
  `;
  
  await sendEmail({
    to: email,
    subject: `Invitation to join ${institutionName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${emailContent}
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
          <p>This is an automated message from the platform.</p>
        </div>
      </div>
    `,
  });
}

  // ==================== REMOVE MEMBER FROM INSTITUTION ====================
  static async removeMemberFromInstitution(req: Request, res: Response) {
    try {
      const { id, userId } = req.params;

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const member = await memberRepo.findOne({
        where: { institution_id: id, user_id: userId },
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found",
        });
      }

      member.is_active = false;
      await memberRepo.save(member);

      res.json({
        success: true,
        message: "Member removed successfully",
      });
    } catch (error: any) {
      console.error("❌ Remove member error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove member",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE MEMBER ROLE ====================
  static async updateMemberRole(req: Request, res: Response) {
    try {
      const { id, userId } = req.params;
      const { role } = req.body;

      if (!role || !Object.values(InstitutionMemberRole).includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Valid role is required",
        });
      }

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const userRepo = dbConnection.getRepository(User);
      
      const member = await memberRepo.findOne({
        where: { institution_id: id, user_id: userId },
        relations: ["user"],
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found",
        });
      }

      member.role = role as InstitutionMemberRole;
      await memberRepo.save(member);

      // Update user's institution_role to match
      const user = member.user;
      switch (role) {
        case InstitutionMemberRole.ADMIN:
          user.institution_role = InstitutionRole.ADMIN;
          user.bwenge_role = BwengeRole.INSTITUTION_ADMIN;
          break;
        case InstitutionMemberRole.INSTRUCTOR:
          user.institution_role = InstitutionRole.INSTRUCTOR;
          user.bwenge_role = BwengeRole.INSTRUCTOR;
          break;
        case InstitutionMemberRole.CONTENT_CREATOR:
          user.institution_role = InstitutionRole.CONTENT_CREATOR;
          user.bwenge_role = BwengeRole.CONTENT_CREATOR;
          break;
        case InstitutionMemberRole.MEMBER:
          user.institution_role = InstitutionRole.MEMBER;
          user.bwenge_role = BwengeRole.LEARNER;
          break;
      }
      await userRepo.save(user);

      res.json({
        success: true,
        message: "Member role updated successfully",
        data: member,
      });
    } catch (error: any) {
      console.error("❌ Update member role error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update member role",
        error: error.message,
      });
    }
  }

  // ==================== INVITE USER ====================
  static async inviteUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { email, first_name, last_name, phone, role, message } = req.body;

      if (!email || !first_name) {
        return res.status(400).json({
          success: false,
          message: "Email and first name are required",
        });
      }

      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Send invitation email
      await sendEmail({
        to: email,
        subject: `Invitation to join ${institution.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You're invited to join ${institution.name}!</h2>
            <p>Hi ${first_name},</p>
            <p>You have been invited to join <strong>${institution.name}</strong> as a ${role || 'member'}.</p>
            ${message ? `<p><em>${message}</em></p>` : ''}
            <p>Click the link below to accept the invitation and create your account:</p>
            <a href="${process.env.CLIENT_URL}/register?institution=${id}&email=${email}" 
               style="display: inline-block; padding: 12px 24px; background-color: #5B7FA2; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
              Accept Invitation
            </a>
            <p>If you have any questions, please contact the institution administrator.</p>
          </div>
        `,
      });

      res.json({
        success: true,
        message: "Invitation sent successfully",
      });
    } catch (error: any) {
      console.error("❌ Invite user error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send invitation",
        error: error.message,
      });
    }
  }

  // ==================== BULK INVITE ====================
  static async bulkInvite(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { emails, role, message } = req.body;

      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Emails array is required",
        });
      }

      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      const results = { succeeded: 0, failed: 0 };

      for (const email of emails) {
        try {
          await sendEmail({
            to: email,
            subject: `Invitation to join ${institution.name}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>You're invited to join ${institution.name}!</h2>
                <p>You have been invited to join <strong>${institution.name}</strong> as a ${role || 'member'}.</p>
                ${message ? `<p><em>${message}</em></p>` : ''}
                <p>Click the link below to accept the invitation:</p>
                <a href="${process.env.CLIENT_URL}/register?institution=${id}&email=${email}" 
                   style="display: inline-block; padding: 12px 24px; background-color: #5B7FA2; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
                  Accept Invitation
                </a>
              </div>
            `,
          });
          results.succeeded++;
        } catch {
          results.failed++;
        }
      }

      res.json({
        success: true,
        message: `Sent ${results.succeeded} invitations`,
        data: results,
      });
    } catch (error: any) {
      console.error("❌ Bulk invite error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send invitations",
        error: error.message,
      });
    }
  }

  // ==================== PROMOTE MEMBER ====================
  static async promoteMember(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { email, role } = req.body;

      if (!email || !role) {
        return res.status(400).json({
          success: false,
          message: "Email and role are required",
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);

      const user = await userRepo.findOne({ where: { email } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const member = await memberRepo.findOne({
        where: { institution_id: id, user_id: user.id },
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "User is not a member of this institution",
        });
      }

      member.role = role as InstitutionMemberRole;
      await memberRepo.save(member);

      // Update user role
      switch (role) {
        case InstitutionMemberRole.ADMIN:
          user.institution_role = InstitutionRole.ADMIN;
          user.bwenge_role = BwengeRole.INSTITUTION_ADMIN;
          break;
        case InstitutionMemberRole.INSTRUCTOR:
          user.institution_role = InstitutionRole.INSTRUCTOR;
          user.bwenge_role = BwengeRole.INSTRUCTOR;
          break;
        case InstitutionMemberRole.CONTENT_CREATOR:
          user.institution_role = InstitutionRole.CONTENT_CREATOR;
          user.bwenge_role = BwengeRole.CONTENT_CREATOR;
          break;
      }
      await userRepo.save(user);

      res.json({
        success: true,
        message: "Member promoted successfully",
        data: member,
      });
    } catch (error: any) {
      console.error("❌ Promote member error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to promote member",
        error: error.message,
      });
    }
  }

  // ==================== BULK IMPORT ====================
  static async bulkImport(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "CSV file is required",
        });
      }

      const institutionRepo = dbConnection.getRepository(Institution);
      const userRepo = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);

      const institution = await institutionRepo.findOne({ where: { id } });
      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Parse CSV
      const csvData = fs.readFileSync(file.path, 'utf-8');
      const lines = csvData.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      const results = { succeeded: 0, failed: 0, errors: [] as string[] };

      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i].split(',').map(v => v.trim());
          const row: any = {};
          headers.forEach((h, idx) => { row[h] = values[idx]; });

          const email = row.email;
          const first_name = row.first_name || row.firstname;
          const last_name = row.last_name || row.lastname;
          const role = (row.role || 'MEMBER').toUpperCase();

          if (!email || !first_name) {
            results.errors.push(`Row ${i + 1}: Missing email or first name`);
            results.failed++;
            continue;
          }

          let user = await userRepo.findOne({ where: { email } });
          
          if (!user) {
            const tempPassword = crypto.randomBytes(8).toString('hex');
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            
            user = userRepo.create({
              email,
              password_hash: hashedPassword,
              username: email.split('@')[0] + '_' + Math.random().toString(36).substring(7),
              first_name,
              last_name: last_name || '',
              phone_number: row.phone || null,
              country: row.country || null,
              bwenge_role: role === 'INSTRUCTOR' ? BwengeRole.INSTRUCTOR : BwengeRole.LEARNER,
              institution_role: role === 'INSTRUCTOR' ? InstitutionRole.INSTRUCTOR : InstitutionRole.MEMBER,
              is_verified: false,
              is_active: true,
              is_institution_member: true,
              primary_institution_id: id,
              institution_ids: [id],
            });
            await userRepo.save(user);
          }

          const existingMember = await memberRepo.findOne({
            where: { user_id: user.id, institution_id: id },
          });

          if (!existingMember) {
            const member = memberRepo.create({
              user_id: user.id,
              institution_id: id,
              role: role as InstitutionMemberRole,
              is_active: true,
            });
            await memberRepo.save(member);
          }

          results.succeeded++;
        } catch (err: any) {
          results.errors.push(`Row ${i + 1}: ${err.message}`);
          results.failed++;
        }
      }

      // Clean up file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      res.json({
        success: true,
        message: `Import completed: ${results.succeeded} succeeded, ${results.failed} failed`,
        data: results,
      });
    } catch (error: any) {
      console.error("❌ Bulk import error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to import users",
        error: error.message,
      });
    }
  }
}