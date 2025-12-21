// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Answer } from "../database/models/Answer";
import { Assessment } from "../database/models/Assessment";
import { Course } from "../database/models/Course";
import { User } from "../database/models/User";
import { format } from "date-fns";
import * as XLSX from "xlsx";

export class GradeController {

  // ==================== GET USER GRADES ====================
  static async getUserGrades(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      // Check permissions - users can only view their own grades
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

      // Get all graded answers for the user
      const answers = await answerRepo.find({
        where: [
          { user_id: userId, is_graded: true },
          { user_id: userId, quiz_id: { $ne: null } }, // Quizzes are auto-graded
        ],
        relations: ["assessment", "quiz", "quiz.questions"],
        order: { graded_at: "DESC" },
      });

      // Group by course
      const courseMap = new Map();

      for (const answer of answers) {
        // Determine course ID
        let courseId = answer.course_id;
        let assessmentTitle = "";
        let totalPoints = 0;

        if (answer.assessment) {
          courseId = answer.assessment.course_id;
          assessmentTitle = answer.assessment.title;
          
          // Calculate total points from assessment questions
          if (answer.assessment.questions) {
            totalPoints = answer.assessment.questions.reduce(
              (sum: number, q: any) => sum + (q.points || 1),
              0
            );
          }
        } else if (answer.quiz) {
          // For quizzes, get course from quiz
          const quiz = answer.quiz;
          courseId = quiz.course_id;
          assessmentTitle = quiz.title;
          
          // Calculate total points from quiz questions
          if (quiz.questions) {
            totalPoints = quiz.questions.reduce(
              (sum: number, q: any) => sum + (q.points || 1),
              0
            );
          }
        }

        if (!courseId) continue;

        // Get course details
        if (!courseMap.has(courseId)) {
          const course = await courseRepo.findOne({
            where: { id: courseId },
            relations: ["instructor"],
          });

          courseMap.set(courseId, {
            course_id: courseId,
            course_title: course?.title || "Unknown Course",
            course_thumbnail: course?.thumbnail_url || null,
            instructor: course?.instructor ? {
              id: course.instructor.id,
              name: `${course.instructor.first_name} ${course.instructor.last_name}`.trim(),
            } : null,
            assignments: [],
            total_score: 0,
            total_possible: 0,
          });
        }

        const course = courseMap.get(courseId);
        
        // Calculate percentage
        const percentage = totalPoints > 0
          ? (answer.points_earned / totalPoints) * 100
          : 0;

        course.assignments.push({
          id: answer.assessment_id || answer.quiz_id,
          title: assessmentTitle,
          score: answer.points_earned || 0,
          total_points: totalPoints,
          percentage,
          submitted_at: answer.created_at,
          graded_at: answer.graded_at || answer.updated_at,
          attempt: answer.attempt_number,
        });

        course.total_score += answer.points_earned || 0;
        course.total_possible += totalPoints;
      }

      // Calculate overall percentages and letter grades
      const grades = Array.from(courseMap.values()).map((course: any) => {
        course.overall_percentage = course.total_possible > 0
          ? (course.total_score / course.total_possible) * 100
          : 0;
        
        // Calculate letter grade
        const letterGrade = this.calculateLetterGrade(course.overall_percentage);
        course.letter_grade = letterGrade.grade;
        course.gpa_points = letterGrade.gpa;

        return course;
      });

      res.json({
        success: true,
        data: grades,
        total_courses: grades.length,
      });
    } catch (error: any) {
      console.error("❌ Get user grades error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user grades",
        error: error.message,
      });
    }
  }

  // ==================== GET GRADE STATISTICS ====================
  static async getGradeStats(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      if (requestingUserId !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
        
        if (requestingUser?.bwenge_role !== "SYSTEM_ADMIN") {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to view this user's grade statistics",
          });
        }
      }

      const answerRepo = dbConnection.getRepository(Answer);

      // Get all graded answers
      const answers = await answerRepo.find({
        where: [
          { user_id: userId, is_graded: true },
          { user_id: userId, quiz_id: { $ne: null } },
        ],
      });

      // Calculate statistics
      const totalAssignments = answers.length;
      const gradedAssignments = answers.filter(a => a.is_graded).length;
      
      const totalPoints = answers.reduce((sum, a) => sum + (a.points_earned || 0), 0);
      const averageScore = totalAssignments > 0 ? totalPoints / totalAssignments : 0;
      
      const percentages = answers.map(a => a.percentage || 0);
      const highestScore = percentages.length > 0 ? Math.max(...percentages) : 0;
      const lowestScore = percentages.length > 0 ? Math.min(...percentages) : 0;

      // Group by course (would need course info - simplified for now)
      const byCourse: any[] = [];

      res.json({
        success: true,
        data: {
          total_assignments: totalAssignments,
          graded_assignments: gradedAssignments,
          average_score: averageScore,
          highest_score: highestScore,
          lowest_score: lowestScore,
          by_course: byCourse,
        },
      });
    } catch (error: any) {
      console.error("❌ Get grade stats error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch grade statistics",
        error: error.message,
      });
    }
  }

  // ==================== EXPORT GRADES ====================
  static async exportGrades(req: Request, res: Response) {
    try {
      const { user_id, format = 'csv' } = req.query;
      const requestingUserId = req.user?.userId || req.user?.id;

      if (!user_id) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

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
        where: [
          { user_id: user_id as string, is_graded: true },
          { user_id: user_id as string, quiz_id: { $ne: null } },
        ],
        order: { graded_at: "DESC" },
      });

      // Prepare data for export
      const exportData = [];

      for (const answer of answers) {
        let courseTitle = "Unknown Course";
        let assessmentTitle = "Unknown Assessment";
        let totalPoints = 0;

        if (answer.assessment_id) {
          const assessment = await assessmentRepo.findOne({
            where: { id: answer.assessment_id },
            relations: ["course"],
          });
          
          if (assessment) {
            courseTitle = assessment.course?.title || "Unknown Course";
            assessmentTitle = assessment.title;
            
            if (assessment.questions) {
              totalPoints = assessment.questions.reduce(
                (sum: number, q: any) => sum + (q.points || 1),
                0
              );
            }
          }
        } else if (answer.quiz_id) {
          // Handle quiz (would need quiz repo)
          assessmentTitle = "Quiz";
        }

        const percentage = totalPoints > 0
          ? ((answer.points_earned || 0) / totalPoints) * 100
          : 0;

        exportData.push({
          'Course': courseTitle,
          'Assignment': assessmentTitle,
          'Score': answer.points_earned || 0,
          'Total Points': totalPoints,
          'Percentage': percentage.toFixed(2) + '%',
          'Submitted': format(new Date(answer.created_at), 'yyyy-MM-dd'),
          'Graded': answer.graded_at ? format(new Date(answer.graded_at), 'yyyy-MM-dd') : 'Pending',
          'Attempt': answer.attempt_number,
          'Feedback': answer.feedback || '',
        });
      }

      if (format === 'csv') {
        if (exportData.length === 0) {
          return res.send("No grade data to export");
        }

        const headers = Object.keys(exportData[0]);
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => 
            headers.map(header => {
              const value = row[header];
              return `"${String(value).replace(/"/g, '""')}"`;
            }).join(',')
          ),
        ];

        const csvContent = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=grades_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        return res.send(csvContent);
      }

      if (format === 'excel') {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Grades');
        
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=grades_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
        return res.send(buffer);
      }

      res.json({
        success: true,
        data: exportData,
      });
    } catch (error: any) {
      console.error("❌ Export grades error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to export grades",
        error: error.message,
      });
    }
  }

  // ==================== HELPER: CALCULATE LETTER GRADE ====================
  private static calculateLetterGrade(percentage: number): { grade: string; gpa: number } {
    if (percentage >= 90) return { grade: 'A', gpa: 4.0 };
    if (percentage >= 80) return { grade: 'B', gpa: 3.0 };
    if (percentage >= 70) return { grade: 'C', gpa: 2.0 };
    if (percentage >= 60) return { grade: 'D', gpa: 1.0 };
    return { grade: 'F', gpa: 0.0 };
  }
}