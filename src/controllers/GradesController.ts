// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Answer } from "../database/models/Answer";
import { Assessment } from "../database/models/Assessment";
import { Course } from "../database/models/Course";
import { User } from "../database/models/User";
import { format } from "date-fns";

export class GradesController {
  
  // ==================== GET USER GRADES SUMMARY ====================
  static async getUserGrades(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;

      // Permission check
      if (requestingUserId !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
        
        if (requestingUser?.bwenge_role !== "SYSTEM_ADMIN") {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to view this user's grades",
          });
        }
      }

      const answerRepo = dbConnection.getRepository(Answer);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const courseRepo = dbConnection.getRepository(Course);

      // Get all graded answers
      const answers = await answerRepo.find({
        where: { user_id: userId, is_graded: true },
        order: { graded_at: "DESC" },
      });

      // Group by course and assessment
      const courseMap = new Map();

      for (const answer of answers) {
        if (!answer.assessment_id) continue;

        // Get assessment details
        const assessment = await assessmentRepo.findOne({
          where: { id: answer.assessment_id },
        });

        if (!assessment) continue;

        const courseId = assessment.course_id;

        // Initialize course if not exists
        if (!courseMap.has(courseId)) {
          const course = await courseRepo.findOne({
            where: { id: courseId },
            relations: ["instructor"],
          });

          if (!course) continue;

          courseMap.set(courseId, {
            course_id: courseId,
            course_title: course.title,
            course_thumbnail: course.thumbnail_url,
            assignments: new Map(),
            total_score: 0,
            total_possible: 0,
          });
        }

        const courseData = courseMap.get(courseId);
        const assessmentKey = `${answer.assessment_id}-${answer.attempt_number}`;

        // Calculate total points for assessment
        const totalPoints = assessment.questions?.reduce(
          (sum: number, q: any) => sum + (q.points || 1),
          0
        ) || 0;

        const percentage = totalPoints > 0 ? (answer.points_earned / totalPoints) * 100 : 0;

        // Check if this assessment already exists
        if (!courseData.assignments.has(assessmentKey)) {
          courseData.assignments.set(assessmentKey, {
            id: answer.assessment_id,
            title: assessment.title,
            score: answer.points_earned || 0,
            total_points: totalPoints,
            percentage,
            submitted_at: answer.created_at,
            graded_at: answer.graded_at,
            weight: 1,
            attempt: answer.attempt_number,
          });

          courseData.total_score += answer.points_earned || 0;
          courseData.total_possible += totalPoints;
        }
      }

      // Convert to array and calculate grades
      const grades = [];
      courseMap.forEach((courseData) => {
        const assignments = Array.from(courseData.assignments.values());
        const overall_percentage = courseData.total_possible > 0
          ? (courseData.total_score / courseData.total_possible) * 100
          : 0;

        const letterGrade = GradesController.calculateLetterGrade(overall_percentage);

        grades.push({
          course_id: courseData.course_id,
          course_title: courseData.course_title,
          course_thumbnail: courseData.course_thumbnail,
          assignments,
          total_score: courseData.total_score,
          total_possible: courseData.total_possible,
          overall_percentage,
          letter_grade: letterGrade.grade,
          gpa_points: letterGrade.gpa,
        });
      });

      res.json({
        success: true,
        data: grades,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch grades",
        error: error.message,
      });
    }
  }

  // ==================== GET GRADED ASSIGNMENTS ====================
  static async getGradedAssignments(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;

      // Permission check
      if (requestingUserId !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
        
        if (requestingUser?.bwenge_role !== "SYSTEM_ADMIN") {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to view this user's graded assignments",
          });
        }
      }

      const answerRepo = dbConnection.getRepository(Answer);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const courseRepo = dbConnection.getRepository(Course);

      // Get all graded answers
      const answers = await answerRepo.find({
        where: { user_id: userId, is_graded: true },
        order: { graded_at: "DESC" },
      });

      // Group by assessment and attempt
      const gradedMap = new Map();

      for (const answer of answers) {
        if (!answer.assessment_id) continue;

        const key = `${answer.assessment_id}-${answer.attempt_number}`;

        if (!gradedMap.has(key)) {
          const assessment = await assessmentRepo.findOne({
            where: { id: answer.assessment_id },
          });

          if (!assessment) continue;

          const course = await courseRepo.findOne({
            where: { id: assessment.course_id },
            relations: ["instructor"],
          });

          if (!course) continue;

          const totalPoints = assessment.questions?.reduce(
            (sum: number, q: any) => sum + (q.points || 1),
            0
          ) || 0;

          const percentage = totalPoints > 0 ? (answer.points_earned / totalPoints) * 100 : 0;

          gradedMap.set(key, {
            id: key,
            assessment_id: answer.assessment_id,
            title: assessment.title,
            description: assessment.description,
            course: {
              id: course.id,
              title: course.title,
              thumbnail_url: course.thumbnail_url,
              instructor: {
                id: course.instructor?.id,
                name: course.instructor
                  ? `${course.instructor.first_name} ${course.instructor.last_name}`
                  : "Unknown",
              },
            },
            submitted_at: answer.created_at,
            graded_at: answer.graded_at,
            attempt_number: answer.attempt_number,
            total_attempts: assessment.max_attempts || 3,
            questions_count: assessment.questions?.length || 0,
            total_points: totalPoints,
            earned_points: answer.points_earned || 0,
            percentage,
            passed: percentage >= (assessment.passing_score || 70),
            feedback: answer.feedback,
            graded_by: answer.graded_by_user_id,
          });
        }
      }

      const graded = Array.from(gradedMap.values());

      res.json({
        success: true,
        data: graded,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch graded assignments",
        error: error.message,
      });
    }
  }

  // ==================== EXPORT GRADES ====================
  static async exportGrades(req: Request, res: Response) {
    try {
      const { user_id, format: exportFormat = "csv" } = req.query;
      const requestingUserId = req.user?.userId || req.user?.id;

      if (!user_id) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      // Permission check
      if (requestingUserId !== user_id) {
        const userRepo = dbConnection.getRepository(User);
        const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
        
        if (requestingUser?.bwenge_role !== "SYSTEM_ADMIN") {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to export this user's grades",
          });
        }
      }

      const answerRepo = dbConnection.getRepository(Answer);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const courseRepo = dbConnection.getRepository(Course);

      // Get all graded answers
      const answers = await answerRepo.find({
        where: { user_id: user_id as string, is_graded: true },
        order: { graded_at: "DESC" },
      });

      const exportData = [];

      for (const answer of answers) {
        if (!answer.assessment_id) continue;

        const assessment = await assessmentRepo.findOne({
          where: { id: answer.assessment_id },
        });

        if (!assessment) continue;

        const course = await courseRepo.findOne({
          where: { id: assessment.course_id },
        });

        if (!course) continue;

        const totalPoints = assessment.questions?.reduce(
          (sum: number, q: any) => sum + (q.points || 1),
          0
        ) || 0;

        const percentage = totalPoints > 0 ? (answer.points_earned / totalPoints) * 100 : 0;
        const letterGrade = GradesController.calculateLetterGrade(percentage);

        exportData.push({
          course: course.title,
          assessment: assessment.title,
          score: answer.points_earned || 0,
          total_points: totalPoints,
          percentage: percentage.toFixed(2),
          letter_grade: letterGrade.grade,
          gpa: letterGrade.gpa,
          attempt: answer.attempt_number,
          submitted_at: format(new Date(answer.created_at), "yyyy-MM-dd HH:mm:ss"),
          graded_at: format(new Date(answer.graded_at), "yyyy-MM-dd HH:mm:ss"),
          feedback: answer.feedback || "",
        });
      }

      if (exportFormat === "csv") {
        const headers = [
          "Course",
          "Assessment",
          "Score",
          "Total Points",
          "Percentage",
          "Letter Grade",
          "GPA",
          "Attempt",
          "Submitted At",
          "Graded At",
          "Feedback",
        ];

        const rows = exportData.map((row) => [
          row.course,
          row.assessment,
          row.score,
          row.total_points,
          row.percentage,
          row.letter_grade,
          row.gpa,
          row.attempt,
          row.submitted_at,
          row.graded_at,
          row.feedback,
        ]);

        const csvContent = [
          headers.join(","),
          ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
        ].join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=grades_${format(new Date(), "yyyy-MM-dd")}.csv`
        );
        return res.send(csvContent);
      }

      res.json({
        success: true,
        data: exportData,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to export grades",
        error: error.message,
      });
    }
  }

  // ==================== HELPER: CALCULATE LETTER GRADE ====================
  private static calculateLetterGrade(percentage: number): { grade: string; gpa: number } {
    if (percentage >= 90) return { grade: "A", gpa: 4.0 };
    if (percentage >= 80) return { grade: "B", gpa: 3.0 };
    if (percentage >= 70) return { grade: "C", gpa: 2.0 };
    if (percentage >= 60) return { grade: "D", gpa: 1.0 };
    return { grade: "F", gpa: 0.0 };
  }
}
