// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";
import { Enrollment } from "../database/models/Enrollment";

import { Progress } from "../database/models/Progress";
import { Assessment } from "../database/models/Assessment";
import { AssessmentAttempt } from "../database/models/AssessmentAttempt";
import { Review } from "../database/models/ReviewModel";
import { Certificate } from "../database/models/Certificate";
import { In, Between } from "typeorm";
import { format } from "date-fns";

export class StudentProgressController {
  
  // Get student progress for a specific course
  static async getStudentProgress(req: Request, res: Response) {
    try {
      const { studentId } = req.params;
      const { course } = req.query;
      const instructorId = req.user?.userId || req.user?.id;

      if (!studentId || !course) {
        return res.status(400).json({
          success: false,
          message: "Student ID and Course ID are required",
        });
      }

      // Verify instructor has access to this course
      const courseRepo = dbConnection.getRepository(Course);
      const instructorCourse = await courseRepo
        .createQueryBuilder("course")
        .where("course.id = :courseId", { courseId: course })
        .andWhere(
          `(
            course.instructor_id = :instructorId 
            OR EXISTS (
              SELECT 1 FROM course_instructors ci 
              WHERE ci.course_id = course.id 
              AND ci.instructor_id = :instructorId
            )
          )`,
          { instructorId }
        )
        .getOne();

      if (!instructorCourse) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this course",
        });
      }

      // Get student information
      const userRepo = dbConnection.getRepository(User);
      const student = await userRepo.findOne({
        where: { id: studentId },
        select: ["id", "email", "first_name", "last_name", "profile_picture_url", "bio", "country", "city", "date_joined", "last_login"],
      });

      if (!student) {
        return res.status(404).json({
          success: false,
          message: "Student not found",
        });
      }

      // Get enrollment data
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const enrollment = await enrollmentRepo.findOne({
        where: {
          user_id: studentId,
          course_id: course as string,
        },
        relations: ["course"],
      });

      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: "Student is not enrolled in this course",
        });
      }

      // Get course with modules and lessons
      const fullCourse = await courseRepo.findOne({
        where: { id: course as string },
        relations: [
          "modules",
          "modules.lessons",
          "modules.lessons.assessments",
          "modules.final_assessment",
          "modules.final_assessment.assessment",
        ],
        order: {
          modules: {
            order_index: "ASC",
            lessons: {
              order_index: "ASC",
            },
          },
        },
      });

      if (!fullCourse) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Get lesson progress for this student using Progress entity (which has course_id)
      const progressRepo = dbConnection.getRepository(Progress);
      const allLessonIds = fullCourse.modules?.flatMap(m => m.lessons?.map(l => l.id) || []) || [];
      
      let lessonProgress: Progress[] = [];
      if (allLessonIds.length > 0) {
        lessonProgress = await progressRepo.find({
          where: {
            user_id: studentId,
            course_id: course as string,
            lesson_id: In(allLessonIds),
          },
        });
      }

      const lessonProgressMap = new Map();
      lessonProgress.forEach(lp => {
        if (lp.lesson_id) {
          lessonProgressMap.set(lp.lesson_id, lp);
        }
      });

      // Get assessment attempts
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const assessments = await assessmentRepo.find({
        where: { course_id: course as string },
      });
      
      const assessmentIds = assessments.map(a => a.id);
      let assessmentAttempts: AssessmentAttempt[] = [];
      if (assessmentIds.length > 0) {
        assessmentAttempts = await dbConnection
          .getRepository(AssessmentAttempt)
          .find({
            where: {
              user_id: studentId,
              assessment_id: In(assessmentIds),
            },
            order: { started_at: "DESC" },
          });
      }

      const assessmentAttemptMap = new Map();
      assessmentAttempts.forEach(attempt => {
        if (!assessmentAttemptMap.has(attempt.assessment_id) || 
            (attempt.completed_at && !assessmentAttemptMap.get(attempt.assessment_id)?.completed_at)) {
          assessmentAttemptMap.set(attempt.assessment_id, attempt);
        }
      });

      // Get certificates
      const certificateRepo = dbConnection.getRepository(Certificate);
      const certificate = await certificateRepo.findOne({
        where: {
          user_id: studentId,
          course_id: course as string,
        },
      });

      // Get reviews
      const reviewRepo = dbConnection.getRepository(Review);
      const review = await reviewRepo.findOne({
        where: {
          user_id: studentId,
          course_id: course as string,
        },
      });

      // Calculate module progress
      const modulesProgress = fullCourse.modules?.map(module => {
        const moduleLessons = module.lessons || [];
        const totalLessons = moduleLessons.length;
        let completedLessons = 0;
        let totalDuration = 0;
        let timeSpent = 0;

        const lessonsProgress = moduleLessons.map(lesson => {
          const progress = lessonProgressMap.get(lesson.id);
          const isCompleted = progress?.is_completed || false;
          if (isCompleted) completedLessons++;
          
          totalDuration += lesson.duration_minutes || 0;
          
          // Get time spent from progress
          if (progress?.time_spent_seconds) {
            timeSpent += progress.time_spent_seconds / 60;
          }
          
          // Get assessment for this lesson
          const lessonAssessment = lesson.assessments?.[0];
          const assessmentAttempt = lessonAssessment ? assessmentAttemptMap.get(lessonAssessment.id) : null;
          
          return {
            id: lesson.id,
            title: lesson.title,
            type: lesson.type,
            duration_minutes: lesson.duration_minutes || 0,
            order_index: lesson.order_index,
            is_completed: isCompleted,
            completed_at: progress?.completed_at || null,
            last_accessed: progress?.last_accessed_at || null,
            time_spent_minutes: progress?.time_spent_seconds ? Math.round(progress.time_spent_seconds / 60) : 0,
            assessment: lessonAssessment ? {
              id: lessonAssessment.id,
              title: lessonAssessment.title,
              type: lessonAssessment.type,
              passing_score: lessonAssessment.passing_score,
              attempt: assessmentAttempt ? {
                id: assessmentAttempt.id,
                score: assessmentAttempt.percentage,
                passed: assessmentAttempt.passed,
                completed_at: assessmentAttempt.completed_at,
                attempts_count: assessmentAttempt.attempt_number,
              } : null,
            } : null,
          };
        });

        const moduleProgressPercent = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
        
        // Module final assessment
        const moduleFinal = module.final_assessment;
        const finalAttempt = moduleFinal?.assessment ? assessmentAttemptMap.get(moduleFinal.assessment.id) : null;

        return {
          id: module.id,
          title: module.title,
          description: module.description,
          order_index: module.order_index,
          total_lessons: totalLessons,
          completed_lessons: completedLessons,
          progress_percentage: Math.round(moduleProgressPercent),
          total_duration_minutes: totalDuration,
          time_spent_minutes: Math.round(timeSpent),
          lessons: lessonsProgress,
          final_assessment: moduleFinal ? {
            id: moduleFinal.id,
            title: moduleFinal.title,
            type: moduleFinal.type,
            passing_score: moduleFinal.passing_score_percentage,
            attempt: finalAttempt ? {
              id: finalAttempt.id,
              score: finalAttempt.percentage,
              passed: finalAttempt.passed,
              completed_at: finalAttempt.completed_at,
              attempts_count: finalAttempt.attempt_number,
            } : null,
          } : null,
        };
      }) || [];

      // Calculate overall progress
      const totalLessons = fullCourse.modules?.reduce((sum, m) => sum + (m.lessons?.length || 0), 0) || 0;
      const completedLessons = modulesProgress.reduce((sum, m) => sum + m.completed_lessons, 0);
      const overallProgress = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
      
      const totalDuration = fullCourse.modules?.reduce((sum, m) => 
        sum + m.lessons?.reduce((lsum, l) => lsum + (l.duration_minutes || 0), 0) || 0, 0
      ) || 0;
      
      const totalTimeSpent = modulesProgress.reduce((sum, m) => sum + m.time_spent_minutes, 0);

      // Calculate activity timeline (last 30 days) - Using Progress entity
      const activityTimeline = await StudentProgressController.getActivityTimeline(studentId, course as string);

      // Get performance metrics
      const performanceMetrics = await StudentProgressController.getPerformanceMetrics(studentId, course as string, assessmentIds);

      // Get recommended next steps
      const recommendedNextSteps = StudentProgressController.getRecommendedNextSteps(modulesProgress, enrollment);

      // Prepare response
      const response = {
        student: {
          id: student.id,
          name: `${student.first_name || ""} ${student.last_name || ""}`.trim(),
          email: student.email,
          profile_picture_url: student.profile_picture_url,
          bio: student.bio,
          location: student.country && student.city ? `${student.city}, ${student.country}` : student.country || student.city || null,
          joined_date: student.date_joined,
          last_login: student.last_login,
        },
        course: {
          id: fullCourse.id,
          title: fullCourse.title,
          description: fullCourse.description,
          thumbnail_url: fullCourse.thumbnail_url,
          course_type: fullCourse.course_type,
          level: fullCourse.level,
          instructor: fullCourse.instructor ? {
            id: fullCourse.instructor.id,
            name: `${fullCourse.instructor.first_name} ${fullCourse.instructor.last_name}`,
            email: fullCourse.instructor.email,
          } : null,
        },
        enrollment: {
          id: enrollment.id,
          enrolled_at: enrollment.enrolled_at,
          status: enrollment.status,
          progress_percentage: enrollment.progress_percentage || overallProgress,
          completed_lessons: enrollment.completed_lessons || completedLessons,
          total_time_spent_minutes: enrollment.total_time_spent_minutes || totalTimeSpent,
          last_accessed: enrollment.last_accessed,
          completion_date: enrollment.completion_date,
          final_score: enrollment.final_score,
          certificate_issued: enrollment.certificate_issued,
          certificate: certificate ? {
            id: certificate.id,
            issued_at: certificate.issued_at,
            certificate_url: certificate.certificate_url,
          } : null,
        },
        progress: {
          overall_percentage: Math.round(overallProgress),
          completed_lessons: completedLessons,
          total_lessons: totalLessons,
          completed_modules: modulesProgress.filter(m => m.progress_percentage === 100).length,
          total_modules: modulesProgress.length,
          total_duration_minutes: totalDuration,
          total_time_spent_minutes: totalTimeSpent,
          estimated_remaining_minutes: Math.max(0, totalDuration - totalTimeSpent),
          pace: StudentProgressController.calculatePace(totalTimeSpent, totalDuration, enrollment.enrolled_at),
        },
        modules: modulesProgress,
        activity_timeline: activityTimeline,
        performance: performanceMetrics,
        review: review ? {
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          created_at: review.created_at,
        } : null,
        recommended_next_steps: recommendedNextSteps,
      };

      res.json({
        success: true,
        data: response,
      });

    } catch (error: any) {
      console.error("Student progress error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch student progress",
        error: error.message,
      });
    }
  }

  // Get activity timeline for last 30 days - Using Progress entity
  private static async getActivityTimeline(studentId: string, courseId: string) {
    const progressRepo = dbConnection.getRepository(Progress);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activities = await progressRepo
      .createQueryBuilder("progress")
      .where("progress.user_id = :studentId", { studentId })
      .andWhere("progress.course_id = :courseId", { courseId })
      .andWhere("progress.last_accessed_at >= :thirtyDaysAgo", { thirtyDaysAgo })
      .orderBy("progress.last_accessed_at", "ASC")
      .getMany();

    // Group by day
    const timeline = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayActivities = activities.filter(a => 
        a.last_accessed_at && a.last_accessed_at >= date && a.last_accessed_at < nextDate
      );

      timeline.push({
        date: format(date, "MMM d"),
        full_date: date.toISOString(),
        activities_count: dayActivities.length,
        lessons_completed: dayActivities.filter(a => a.is_completed).length,
      });
    }

    return timeline;
  }

  // Get performance metrics
  private static async getPerformanceMetrics(studentId: string, courseId: string, assessmentIds: string[]) {
    const assessmentAttemptRepo = dbConnection.getRepository(AssessmentAttempt);
    
    let attempts: AssessmentAttempt[] = [];
    if (assessmentIds.length > 0) {
      attempts = await assessmentAttemptRepo.find({
        where: {
          user_id: studentId,
          assessment_id: In(assessmentIds),
        },
      });
    }

    const completedAttempts = attempts.filter(a => a.completed_at);
    const passedAttempts = attempts.filter(a => a.passed);
    
    const scores = completedAttempts.map(a => a.percentage).filter(s => s !== null && s !== undefined);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    
    // Get lesson completion trend using Progress entity
    const progressRepo = dbConnection.getRepository(Progress);
    const weeklyCompletions = [];
    
    for (let i = 4; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const completions = await progressRepo.count({
        where: {
          user_id: studentId,
          course_id: courseId,
          is_completed: true,
          completed_at: Between(weekStart, weekEnd),
        },
      });

      weeklyCompletions.push({
        week: `Week ${4 - i + 1}`,
        completions,
      });
    }

    return {
      assessments_taken: completedAttempts.length,
      assessments_passed: passedAttempts.length,
      average_score: Math.round(averageScore),
      best_score: Math.max(...scores, 0),
      weekly_lesson_completions: weeklyCompletions,
      engagement_score: StudentProgressController.calculateEngagementScore(attempts.length, weeklyCompletions),
    };
  }

  // Calculate engagement score
  private static calculateEngagementScore(totalAttempts: number, weeklyCompletions: any[]): number {
    const recentCompletions = weeklyCompletions.slice(-2).reduce((sum, w) => sum + w.completions, 0);
    let score = 50; // Base score
    
    if (totalAttempts > 0) score += Math.min(20, totalAttempts * 2);
    if (recentCompletions > 0) score += Math.min(30, recentCompletions * 5);
    
    return Math.min(100, score);
  }

  // Calculate student pace
  private static calculatePace(timeSpent: number, totalDuration: number, enrolledAt: Date): string {
    if (timeSpent === 0) return "Not started";
    
    const daysSinceEnrollment = Math.max(1, Math.floor((Date.now() - new Date(enrolledAt).getTime()) / (1000 * 60 * 60 * 24)));
    const dailyAverage = timeSpent / daysSinceEnrollment;
    const estimatedDaysToComplete = totalDuration > 0 ? (totalDuration - timeSpent) / dailyAverage : 0;
    
    if (estimatedDaysToComplete <= 0) return "Completed";
    if (estimatedDaysToComplete <= 7) return "On track - completing soon";
    if (estimatedDaysToComplete <= 14) return "Good pace";
    if (estimatedDaysToComplete <= 30) return "Steady progress";
    return "Behind schedule - needs attention";
  }

  // Get recommended next steps
  private static getRecommendedNextSteps(modulesProgress: any[], enrollment: any): any[] {
    const steps = [];
    
    // Find first incomplete lesson
    for (const module of modulesProgress) {
      for (const lesson of module.lessons) {
        if (!lesson.is_completed) {
          steps.push({
            type: "lesson",
            title: `Complete "${lesson.title}"`,
            module: module.title,
            priority: "high",
            action: "continue_lesson",
          });
          break;
        }
      }
      if (steps.length) break;
    }
    
    // Check for pending assessments
    for (const module of modulesProgress) {
      for (const lesson of module.lessons) {
        if (lesson.assessment && !lesson.assessment.attempt?.passed && lesson.is_completed) {
          steps.push({
            type: "assessment",
            title: `Retake "${lesson.assessment.title}"`,
            module: module.title,
            priority: "medium",
            action: "take_assessment",
          });
        }
      }
      
      if (module.final_assessment && !module.final_assessment.attempt?.passed && module.progress_percentage === 100) {
        steps.push({
          type: "final_assessment",
          title: `Complete "${module.final_assessment.title}"`,
          module: module.title,
          priority: "high",
          action: "take_final_assessment",
        });
      }
    }
    
    // If everything is completed, suggest review
    if (steps.length === 0 && enrollment.status !== "COMPLETED") {
      steps.push({
        type: "review",
        title: "Review course materials",
        priority: "low",
        action: "review_course",
      });
    }
    
    return steps;
  }
}