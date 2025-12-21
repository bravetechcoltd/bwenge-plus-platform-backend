// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course } from "../database/models/Course";
import { User } from "../database/models/User";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { sendEmail } from "../services/emailService";
import { In } from "typeorm";

export class CourseInstructorController {
  
  // ==================== METHOD 1: Get Available Instructors for Institution ====================
  static async getAvailableInstructors(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const { course_id, search, page = 1, limit = 20 } = req.query;

      if (!institutionId) {
        return res.status(400).json({
          success: false,
          message: "Institution ID is required",
        });
      }

      const pageNumber = parseInt(page as string);
      const limitNumber = parseInt(limit as string);
      const skip = (pageNumber - 1) * limitNumber;

      // Build query for available instructors
      const queryBuilder = dbConnection
        .getRepository(InstitutionMember)
        .createQueryBuilder("member")
        .innerJoinAndSelect("member.user", "user")
        .where("member.institution_id = :institutionId", { institutionId })
        .andWhere("member.is_active = true")
        .andWhere("member.role IN (:...roles)", {
          roles: ["INSTRUCTOR", "CONTENT_CREATOR", "ADMIN"]
        })
        .andWhere("user.is_active = true");

      // Apply search filter
      if (search) {
        queryBuilder.andWhere(
          "(user.first_name ILIKE :search OR user.last_name ILIKE :search OR user.email ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      // Exclude current instructors if course_id provided
      if (course_id) {
        // Get current primary instructor
        const course = await dbConnection.getRepository(Course).findOne({
          where: { id: course_id as string },
          select: ["instructor_id"]
        });

        // Get additional instructors
        const currentInstructors = await dbConnection.getRepository(CourseInstructor).find({
          where: { course_id: course_id as string },
          select: ["instructor_id"]
        });

        const excludedIds = [
          course?.instructor_id,
          ...currentInstructors.map(ci => ci.instructor_id)
        ].filter(id => id !== null);

        if (excludedIds.length > 0) {
          queryBuilder.andWhere("user.id NOT IN (:...excludedIds)", { excludedIds });
        }
      }

      // Get total count
      const total = await queryBuilder.getCount();

      // Get paginated results
      const members = await queryBuilder
        .orderBy("user.first_name", "ASC")
        .addOrderBy("user.last_name", "ASC")
        .skip(skip)
        .take(limitNumber)
        .getMany();

      // Get course counts for each instructor
      const instructorsWithCourseCounts = await Promise.all(
        members.map(async (member) => {
          const courseCount = await dbConnection.getRepository(CourseInstructor).count({
            where: { instructor_id: member.user_id }
          });

          return {
            user_id: member.user_id,
            email: member.user.email,
            first_name: member.user.first_name,
            last_name: member.user.last_name,
            profile_picture_url: member.user.profile_picture_url,
            institution_role: member.role,
            member_since: member.joined_at,
            courses_taught: courseCount,
          };
        })
      );

      res.json({
        success: true,
        data: instructorsWithCourseCounts,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber)
        }
      });

    } catch (error: any) {
      console.error("❌ Get available instructors error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch available instructors",
        error: error.message,
      });
    }
  }

  // ==================== METHOD 2: Get Course Instructors ====================
  static async getCourseInstructors(req: Request, res: Response) {
    try {
      const { courseId } = req.params;

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      // Get course with primary instructor
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["instructor"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Get additional instructors
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
      const additionalInstructors = await courseInstructorRepo.find({
        where: { course_id: courseId },
        relations: ["instructor"],
        order: { assigned_at: "DESC" },
      });

      // Format primary instructor
      const primaryInstructor = course.instructor ? {
        id: course.instructor.id,
        email: course.instructor.email,
        first_name: course.instructor.first_name,
        last_name: course.instructor.last_name,
        profile_picture_url: course.instructor.profile_picture_url,
        assigned_at: course.created_at,
        is_primary: true,
      } : null;

      // Format additional instructors
      const formattedAdditionalInstructors = additionalInstructors.map(ci => ({
        id: ci.instructor.id,
        email: ci.instructor.email,
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
      }));

      res.json({
        success: true,
        data: {
          primary_instructor: primaryInstructor,
          additional_instructors: formattedAdditionalInstructors,
          total_instructors: (primaryInstructor ? 1 : 0) + formattedAdditionalInstructors.length,
        }
      });

    } catch (error: any) {
      console.error("❌ Get course instructors error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch course instructors",
        error: error.message,
      });
    }
  }

  // ==================== METHOD 3: Assign Instructor to Course ====================
  static async assignInstructor(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const { instructor_id, is_primary_instructor = false, permissions } = req.body;
      const userId = req.user?.id;

      if (!instructor_id) {
        return res.status(400).json({
          success: false,
          message: "Instructor ID is required",
        });
      }

      // Get course with institution
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Check if instructor is already the primary instructor
      if (course.instructor_id === instructor_id) {
        return res.status(400).json({
          success: false,
          message: "This instructor is already the primary instructor",
        });
      }

      // Verify instructor eligibility
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const instructorMember = await memberRepo.findOne({
        where: {
          user_id: instructor_id,
          institution_id: course.institution_id,
          is_active: true,
          role: In(["INSTRUCTOR", "CONTENT_CREATOR", "ADMIN"])
        }
      });

      if (!instructorMember) {
        return res.status(400).json({
          success: false,
          message: "User is not an active member of this institution with instructor role",
        });
      }

      // Check for duplicate assignment
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
      const existingAssignment = await courseInstructorRepo.findOne({
        where: {
          course_id: courseId,
          instructor_id: instructor_id
        }
      });

      if (existingAssignment) {
        return res.status(400).json({
          success: false,
          message: "Instructor is already assigned to this course",
        });
      }

      // Create new course instructor record
      const newAssignment = courseInstructorRepo.create({
        course_id: courseId,
        instructor_id: instructor_id,
        is_primary_instructor: is_primary_instructor,
        can_grade_assignments: permissions?.can_grade_assignments ?? true,
        can_manage_enrollments: permissions?.can_manage_enrollments ?? false,
        can_edit_course_content: permissions?.can_edit_course_content ?? false,
        assigned_at: new Date(),
      });

      await courseInstructorRepo.save(newAssignment);

      // Update user role if needed
      if (instructorMember.role === "MEMBER") {
        instructorMember.role = "INSTRUCTOR";
        await memberRepo.save(instructorMember);
      }

      // Get instructor details for response
      const userRepo = dbConnection.getRepository(User);
      const instructor = await userRepo.findOne({
        where: { id: instructor_id }
      });

      // Send notification email
      if (instructor?.email) {
        try {
          await sendEmail({
            to: instructor.email,
            subject: `You've been assigned as an instructor for ${course.title}`,
            html: `
              <h2>Course Assignment Notification</h2>
              <p>You have been assigned as an instructor for the course: <strong>${course.title}</strong>.</p>
              <p><strong>Permissions granted:</strong></p>
              <ul>
                <li>Grade assignments: ${newAssignment.can_grade_assignments ? 'Yes' : 'No'}</li>
                <li>Manage enrollments: ${newAssignment.can_manage_enrollments ? 'Yes' : 'No'}</li>
                <li>Edit course content: ${newAssignment.can_edit_course_content ? 'Yes' : 'No'}</li>
              </ul>
              <p>You can access the course from your instructor dashboard.</p>
            `,
          });
        } catch (emailError) {
          console.error("Failed to send notification email:", emailError);
        }
      }

      res.status(201).json({
        success: true,
        message: "Instructor assigned successfully",
        data: {
          course_instructor: {
            id: newAssignment.id,
            course_id: newAssignment.course_id,
            instructor_id: newAssignment.instructor_id,
            instructor: {
              email: instructor?.email,
              first_name: instructor?.first_name,
              last_name: instructor?.last_name,
            },
            is_primary_instructor: newAssignment.is_primary_instructor,
            permissions: {
              can_grade_assignments: newAssignment.can_grade_assignments,
              can_manage_enrollments: newAssignment.can_manage_enrollments,
              can_edit_course_content: newAssignment.can_edit_course_content,
            },
            assigned_at: newAssignment.assigned_at,
          }
        }
      });

    } catch (error: any) {
      console.error("❌ Assign instructor error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to assign instructor",
        error: error.message,
      });
    }
  }

  // ==================== METHOD 4: Update Instructor Permissions ====================
  static async updateInstructorPermissions(req: Request, res: Response) {
    try {
      const { courseId, instructorId } = req.params;
      const { can_grade_assignments, can_manage_enrollments, can_edit_course_content } = req.body;

      // Get course instructor record
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
      const assignment = await courseInstructorRepo.findOne({
        where: {
          course_id: courseId,
          instructor_id: instructorId,
        },
        relations: ["instructor", "course"],
      });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: "Instructor assignment not found",
        });
      }

      // Prevent modifying primary instructor permissions
      if (assignment.is_primary_instructor) {
        return res.status(400).json({
          success: false,
          message: "Cannot modify permissions for primary instructor",
        });
      }

      // Update permissions
      if (can_grade_assignments !== undefined) {
        assignment.can_grade_assignments = can_grade_assignments;
      }
      if (can_manage_enrollments !== undefined) {
        assignment.can_manage_enrollments = can_manage_enrollments;
      }
      if (can_edit_course_content !== undefined) {
        assignment.can_edit_course_content = can_edit_course_content;
      }

      await courseInstructorRepo.save(assignment);

      res.json({
        success: true,
        message: "Instructor permissions updated successfully",
        data: assignment,
      });

    } catch (error: any) {
      console.error("❌ Update instructor permissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update instructor permissions",
        error: error.message,
      });
    }
  }

  // ==================== METHOD 5: Replace Primary Instructor ====================
  static async replacePrimaryInstructor(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const { new_instructor_id, keep_as_additional = true, transfer_permissions } = req.body;

      if (!new_instructor_id) {
        return res.status(400).json({
          success: false,
          message: "New instructor ID is required",
        });
      }

      // Get course with current instructor and institution
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["instructor", "institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const oldInstructorId = course.instructor_id;

      // Check if new instructor is same as current
      if (oldInstructorId === new_instructor_id) {
        return res.status(400).json({
          success: false,
          message: "New instructor is already the primary instructor",
        });
      }

      // Verify new instructor eligibility
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const newInstructorMember = await memberRepo.findOne({
        where: {
          user_id: new_instructor_id,
          institution_id: course.institution_id,
          is_active: true,
          role: In(["INSTRUCTOR", "CONTENT_CREATOR", "ADMIN"])
        },
        relations: ["user"],
      });

      if (!newInstructorMember) {
        return res.status(400).json({
          success: false,
          message: "New instructor is not an eligible member of this institution",
        });
      }

      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      // Start transaction
      await dbConnection.transaction(async (transactionalEntityManager) => {
        // Handle old primary instructor
        if (oldInstructorId) {
          // Check if old instructor exists in course_instructors table
          const oldInstructorAssignment = await transactionalEntityManager.findOne(CourseInstructor, {
            where: {
              course_id: courseId,
              instructor_id: oldInstructorId,
            },
          });

          if (keep_as_additional) {
            // Keep old instructor as additional instructor
            if (oldInstructorAssignment) {
              oldInstructorAssignment.is_primary_instructor = false;
              await transactionalEntityManager.save(CourseInstructor, oldInstructorAssignment);
            } else {
              // Create new assignment for old instructor
              const newAssignment = transactionalEntityManager.create(CourseInstructor, {
                course_id: courseId,
                instructor_id: oldInstructorId,
                is_primary_instructor: false,
                can_grade_assignments: transfer_permissions?.can_grade_assignments ?? true,
                can_manage_enrollments: transfer_permissions?.can_manage_enrollments ?? false,
                can_edit_course_content: transfer_permissions?.can_edit_course_content ?? false,
                assigned_at: new Date(),
              });
              await transactionalEntityManager.save(CourseInstructor, newAssignment);
            }
          } else {
            // Remove old instructor completely
            if (oldInstructorAssignment) {
              await transactionalEntityManager.remove(CourseInstructor, oldInstructorAssignment);
            }
          }
        }

        // Remove new instructor from additional instructors if exists
        const newInstructorAsAdditional = await transactionalEntityManager.findOne(CourseInstructor, {
          where: {
            course_id: courseId,
            instructor_id: new_instructor_id,
          },
        });

        if (newInstructorAsAdditional) {
          await transactionalEntityManager.remove(CourseInstructor, newInstructorAsAdditional);
        }

        // Update course with new primary instructor
        course.instructor_id = new_instructor_id;
        await transactionalEntityManager.save(Course, course);

        // Update new instructor's role if needed
        if (newInstructorMember.role !== "INSTRUCTOR") {
          newInstructorMember.role = "INSTRUCTOR";
          await transactionalEntityManager.save(InstitutionMember, newInstructorMember);
        }
      });

      // Get user details for response
      const userRepo = dbConnection.getRepository(User);
      const newInstructor = await userRepo.findOne({ where: { id: new_instructor_id } });
      const oldInstructor = oldInstructorId ? await userRepo.findOne({ where: { id: oldInstructorId } }) : null;

      // Send notifications
      try {
        if (newInstructor?.email) {
          await sendEmail({
            to: newInstructor.email,
            subject: `You are now the primary instructor for ${course.title}`,
            html: `
              <h2>Primary Instructor Assignment</h2>
              <p>You have been assigned as the primary instructor for the course: <strong>${course.title}</strong>.</p>
              <p>You now have full administrative access to this course.</p>
            `,
          });
        }

        if (oldInstructor?.email) {
          const subject = keep_as_additional 
            ? `Your role has changed for ${course.title}`
            : `You have been removed from ${course.title}`;
          
          const message = keep_as_additional
            ? `You are now an additional instructor for the course: <strong>${course.title}</strong>.`
            : `You have been removed as an instructor from the course: <strong>${course.title}</strong>.`;
          
          await sendEmail({
            to: oldInstructor.email,
            subject: subject,
            html: `
              <h2>Instructor Role Update</h2>
              <p>${message}</p>
            `,
          });
        }
      } catch (emailError) {
        console.error("Failed to send notification emails:", emailError);
      }

      res.json({
        success: true,
        message: "Primary instructor replaced successfully",
        data: {
          course: {
            id: course.id,
            title: course.title,
            instructor_id: new_instructor_id,
          },
          new_primary_instructor: {
            id: new_instructor_id,
            email: newInstructor?.email,
            first_name: newInstructor?.first_name,
            last_name: newInstructor?.last_name,
          },
          previous_instructor: oldInstructorId ? {
            id: oldInstructorId,
            email: oldInstructor?.email,
            status: keep_as_additional ? "additional" : "removed",
            permissions: keep_as_additional ? transfer_permissions : null,
          } : null,
        }
      });

    } catch (error: any) {
      console.error("❌ Replace primary instructor error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to replace primary instructor",
        error: error.message,
      });
    }
  }

  // ==================== METHOD 6: Remove Instructor from Course ====================
  static async removeInstructor(req: Request, res: Response) {
    try {
      const { courseId, instructorId } = req.params;

      // Get course to check if instructor is primary
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["instructor"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Check if trying to remove primary instructor
      if (course.instructor_id === instructorId) {
        return res.status(400).json({
          success: false,
          message: "Cannot remove primary instructor. Use replace endpoint instead.",
        });
      }

      // Get course instructor record
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
      const assignment = await courseInstructorRepo.findOne({
        where: {
          course_id: courseId,
          instructor_id: instructorId,
        },
        relations: ["instructor"],
      });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: "Instructor assignment not found",
        });
      }

      // Get instructor details for notification
      const instructorEmail = assignment.instructor?.email;
      const instructorName = assignment.instructor 
        ? `${assignment.instructor.first_name} ${assignment.instructor.last_name}`
        : "Instructor";

      // Delete the assignment
      await courseInstructorRepo.remove(assignment);

      // Check if instructor has other courses
      const otherAssignments = await courseInstructorRepo.count({
        where: { instructor_id: instructorId }
      });

      const courseCount = await courseRepo.count({
        where: { instructor_id: instructorId }
      });

      const totalCourses = otherAssignments + courseCount;

      // Optionally downgrade role if no other courses (business decision)
      if (totalCourses === 0) {
        const memberRepo = dbConnection.getRepository(InstitutionMember);
        const member = await memberRepo.findOne({
          where: { user_id: instructorId }
        });

        if (member && member.role === "INSTRUCTOR") {
          // Check if user has other roles in other institutions
          const otherInstitutions = await memberRepo.count({
            where: {
              user_id: instructorId,
              role: "INSTRUCTOR",
              id: member.id ? undefined : member.id // Exclude current if it exists
            }
          });

          if (otherInstitutions === 0) {
            // Could downgrade to CONTENT_CREATOR here
            // member.role = "CONTENT_CREATOR";
            // await memberRepo.save(member);
          }
        }
      }

      // Send notification
      try {
        if (instructorEmail) {
          await sendEmail({
            to: instructorEmail,
            subject: `You have been removed from ${course.title}`,
            html: `
              <h2>Instructor Removal Notification</h2>
              <p>You have been removed as an instructor from the course: <strong>${course.title}</strong>.</p>
              <p>If you have any questions, please contact the course administrator.</p>
            `,
          });
        }
      } catch (emailError) {
        console.error("Failed to send removal notification:", emailError);
      }

      res.json({
        success: true,
        message: "Instructor removed successfully",
        data: {
          removed_instructor_id: instructorId,
          course_id: courseId,
        }
      });

    } catch (error: any) {
      console.error("❌ Remove instructor error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove instructor",
        error: error.message,
      });
    }
  }

  // ==================== METHOD 7: Bulk Assign Instructors ====================
  static async bulkAssignInstructors(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const { instructors } = req.body;

      if (!instructors || !Array.isArray(instructors) || instructors.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Instructors array is required",
        });
      }

      // Get course with institution
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Validate all instructors first
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const validationErrors = [];
      const validInstructors = [];

      for (const instructorData of instructors) {
        const { instructor_id, permissions } = instructorData;

        // Check instructor eligibility
        const member = await memberRepo.findOne({
          where: {
            user_id: instructor_id,
            institution_id: course.institution_id,
            is_active: true,
            role: In(["INSTRUCTOR", "CONTENT_CREATOR", "ADMIN"])
          }
        });

        if (!member) {
          validationErrors.push({
            instructor_id,
            error: "Not an eligible member of this institution",
          });
          continue;
        }

        // Check for duplicate assignment
        const existingAssignment = await courseInstructorRepo.findOne({
          where: {
            course_id: courseId,
            instructor_id: instructor_id,
          },
        });

        if (existingAssignment) {
          validationErrors.push({
            instructor_id,
            error: "Already assigned to this course",
          });
          continue;
        }

        // Check if instructor is primary instructor
        if (course.instructor_id === instructor_id) {
          validationErrors.push({
            instructor_id,
            error: "Already primary instructor of this course",
          });
          continue;
        }

        validInstructors.push({
          instructor_id,
          permissions: permissions || {
            can_grade_assignments: true,
            can_manage_enrollments: false,
            can_edit_course_content: false,
          },
          member,
        });
      }

      // If any validation errors, return them
      if (validationErrors.length > 0 && validInstructors.length === 0) {
        return res.status(400).json({
          success: false,
          message: "All instructors failed validation",
          errors: validationErrors,
        });
      }

      // Process bulk assignment in transaction
      const createdAssignments = [];
      const userRepo = dbConnection.getRepository(User);

      await dbConnection.transaction(async (transactionalEntityManager) => {
        for (const { instructor_id, permissions, member } of validInstructors) {
          // Create course instructor record
          const assignment = transactionalEntityManager.create(CourseInstructor, {
            course_id: courseId,
            instructor_id: instructor_id,
            is_primary_instructor: false,
            can_grade_assignments: permissions.can_grade_assignments,
            can_manage_enrollments: permissions.can_manage_enrollments,
            can_edit_course_content: permissions.can_edit_course_content,
            assigned_at: new Date(),
          });

          await transactionalEntityManager.save(CourseInstructor, assignment);

          // Update user role if needed
          if (member.role === "MEMBER") {
            member.role = "INSTRUCTOR";
            await transactionalEntityManager.save(InstitutionMember, member);
          }

          // Get instructor details
          const instructor = await userRepo.findOne({
            where: { id: instructor_id }
          });

          createdAssignments.push({
            course_instructor: assignment,
            instructor: {
              id: instructor_id,
              email: instructor?.email,
              first_name: instructor?.first_name,
              last_name: instructor?.last_name,
            },
          });
        }
      });

      // Send bulk notifications
      try {
        for (const assignment of createdAssignments) {
          if (assignment.instructor.email) {
            await sendEmail({
              to: assignment.instructor.email,
              subject: `You've been assigned as an instructor for ${course.title}`,
              html: `
                <h2>Course Assignment Notification</h2>
                <p>You have been assigned as an instructor for the course: <strong>${course.title}</strong>.</p>
                <p>You can access the course from your instructor dashboard.</p>
              `,
            });
          }
        }
      } catch (emailError) {
        console.error("Failed to send bulk notifications:", emailError);
      }

      const response = {
        success: true,
        message: `Successfully assigned ${createdAssignments.length} instructors`,
        data: {
          created_assignments: createdAssignments,
          total_assigned: createdAssignments.length,
        },
      };

      // Add validation errors if any
      if (validationErrors.length > 0) {
        response.data.validation_errors = validationErrors;
        response.message += ` (${validationErrors.length} failed validation)`;
      }

      res.status(201).json(response);

    } catch (error: any) {
      console.error("❌ Bulk assign instructors error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to bulk assign instructors",
        error: error.message,
      });
    }
  }
}