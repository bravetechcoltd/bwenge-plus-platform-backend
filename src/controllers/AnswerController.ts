
// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Answer } from "../database/models/Answer";
import { User } from "../database/models/User";
import { Assessment } from "../database/models/Assessment";
import { Quiz } from "../database/models/Quiz";
import { Question } from "../database/models/Question";
import { Enrollment } from "../database/models/Enrollment";
import { Progress } from "../database/models/Progress";
import { Course } from "../database/models/Course";
import { sendEmail } from "../services/emailService";
import { Not } from "typeorm";

export class AnswerController {

  static async submitAnswers(req: Request, res: Response) {
    try {
      const { assessment_id, answers, enrollment_id } = req.body;
      const userId = req.user?.userId || req.user?.id;


      if (!userId) {
        return res.status(401).json({ success: false, message: "User authentication required" });
      }

      if (!assessment_id || !Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ success: false, message: "Missing required fields: assessment_id and answers array" });
      }

      const userRepo = dbConnection.getRepository(User);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const quizRepo = dbConnection.getRepository(Quiz);
      const answerRepo = dbConnection.getRepository(Answer);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const progressRepo = dbConnection.getRepository(Progress);
      const courseRepo = dbConnection.getRepository(Course);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      let enrollment = null;
      if (enrollment_id) {
        enrollment = await enrollmentRepo.findOne({
          where: { id: enrollment_id, user_id: userId },
          relations: ["course"],
        });
        if (!enrollment) return res.status(404).json({ success: false, message: "Enrollment not found or doesn't belong to user" });
      }

      let assessment = null;
      let quiz = null;
      let isQuiz = false;
      let assessmentType = "ASSESSMENT";
      let courseId = null;
      let lessonId = null;

      assessment = await assessmentRepo.findOne({
        where: { id: assessment_id },
        relations: ["course", "lesson", "module"],
      });

      if (assessment) {
        assessmentType = "ASSESSMENT";
        courseId = assessment.course_id;
        lessonId = assessment.lesson_id || null;
      } else {
        quiz = await quizRepo.findOne({
          where: { id: assessment_id },
          relations: ["questions", "course", "lesson"],
        });
        if (!quiz) return res.status(404).json({ success: false, message: "Assessment or Quiz not found with the provided ID" });
        isQuiz = true;
        assessmentType = "QUIZ";
        courseId = quiz.course_id;
        lessonId = quiz.lesson_id || null;
      }

      if (enrollment && enrollment.course_id !== courseId) {
        return res.status(400).json({ success: false, message: "Enrollment course does not match assessment/quiz course" });
      }

      if (!enrollment && courseId) {
        enrollment = await enrollmentRepo.findOne({
          where: { user_id: userId, course_id: courseId, status: "ACTIVE" },
          relations: ["course"],
        });
      }

      const processedAnswers = [];
      let totalScore = 0;
      let totalPossiblePoints = 0;
      let requiresManualGrading = false;
      let objectiveQuestionsCount = 0;
      let subjectiveQuestionsCount = 0;


      for (const answerData of answers) {
        const { question_id, answer: submittedAnswer, time_spent_seconds } = answerData;

        if (!question_id) {
          continue;
        }

        let questionData = null;
        let isObjectiveQuestion = false;
        let questionPoints = 0;

        if (!isQuiz && assessment?.questions) {
          questionData = assessment.questions.find((q) => q.id === question_id);
          if (questionData) {
            isObjectiveQuestion = ["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(questionData.type);
            questionPoints = questionData.points || 1;
          }
        }

        if (!questionData && isQuiz && quiz?.questions) {
          const quizQuestion = quiz.questions.find((q) => q.id === question_id);
          if (quizQuestion) {
            questionData = {
              id: quizQuestion.id,
              question: quizQuestion.question_text,
              type: quizQuestion.question_type,
              options: quizQuestion.options,
              correct_answer: quizQuestion.correct_answer,
              points: quizQuestion.points,
            };
            isObjectiveQuestion = ["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(quizQuestion.question_type);
            questionPoints = quizQuestion.points || 1;
          }
        }

        if (!questionData) {
          isObjectiveQuestion = false;
          questionPoints = 1;
        }

        totalPossiblePoints += questionPoints;

        let isCorrect = false;
        let pointsEarned = 0;
        let isGraded = false;

        if (isObjectiveQuestion) {
          objectiveQuestionsCount++;
          const evaluation = AnswerController.evaluateQuestion(questionData, submittedAnswer);
          isCorrect = evaluation.isCorrect;
          pointsEarned = evaluation.pointsEarned;
          isGraded = true;
          totalScore += pointsEarned;
        } else {
          subjectiveQuestionsCount++;
          requiresManualGrading = true;
          isGraded = false;
        }

        // ============================================================
        // All question_id lookups use raw SQL — never TypeORM where {}
        // This prevents PostgreSQL from casting non-UUID IDs to uuid type
        // ============================================================
        const existingAnswerResult = await answerRepo.query(
          `SELECT * FROM answers WHERE user_id = $1 AND assessment_id = $2 AND question_id = $3 LIMIT 1`,
          [userId, assessment_id, String(question_id)]
        );
        const existingAnswer = existingAnswerResult.length > 0 ? existingAnswerResult[0] : null;

        if (existingAnswer) {
          await answerRepo.query(
            `UPDATE answers
             SET answer = $1, is_correct = $2, points_earned = $3, time_spent_seconds = $4,
                 attempt_number = attempt_number + 1, is_final_submission = $5, is_graded = $6,
                 quiz_id = $7, updated_at = NOW()
             WHERE id = $8`,
            [JSON.stringify(submittedAnswer), isCorrect, pointsEarned, time_spent_seconds || 0, true, isGraded, isQuiz ? assessment_id : null, existingAnswer.id]
          );

          const updatedResult = await answerRepo.query(`SELECT * FROM answers WHERE id = $1`, [existingAnswer.id]);
          if (updatedResult.length > 0) processedAnswers.push(updatedResult[0]);

        } else {
          // Always INSERT via raw query — no TypeORM entity save — so question_id stays as text
          const insertResult = await answerRepo.query(
            `INSERT INTO answers
              (user_id, assessment_id, quiz_id, question_id, answer, is_correct, points_earned,
               time_spent_seconds, attempt_number, is_final_submission, is_graded, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
             RETURNING *`,
            [
              userId,
              assessment_id,
              isQuiz ? assessment_id : null,
              String(question_id),
              JSON.stringify(submittedAnswer),
              isCorrect,
              pointsEarned,
              time_spent_seconds || 0,
              1,
              true,
              isGraded,
            ]
          );

          if (insertResult.length > 0) processedAnswers.push(insertResult[0]);
        }
      }

      const percentage = totalPossiblePoints > 0 ? (totalScore / totalPossiblePoints) * 100 : 0;
      const passingScore = isQuiz ? quiz.passing_score : assessment.passing_score;
      const passed = !requiresManualGrading && percentage >= passingScore;


      if (enrollment) {
        try {
          if (lessonId) {
            let progress = await progressRepo.findOne({ where: { enrollment_id: enrollment.id, lesson_id: lessonId, assessment_id: null } });
            if (!progress) {
              progress = progressRepo.create({
                enrollment_id: enrollment.id, lesson_id: lessonId, assessment_id: null, user_id: userId, course_id: courseId,
                is_completed: !requiresManualGrading && passed, completion_percentage: !requiresManualGrading ? percentage : 0,
                score: !requiresManualGrading ? percentage : null, status: !requiresManualGrading ? (passed ? "completed" : "failed") : "pending",
              });
            } else {
              if (!requiresManualGrading) {
                progress.is_completed = passed; progress.completion_percentage = percentage; progress.score = percentage;
                progress.status = passed ? "completed" : "failed";
                if (passed && !progress.completed_at) progress.completed_at = new Date();
              } else {
                progress.status = "pending";
              }
            }
            progress.last_accessed_at = new Date();
            await progressRepo.save(progress);
          } else {
            let progress = await progressRepo.findOne({ where: { enrollment_id: enrollment.id, assessment_id: assessment_id, lesson_id: null } });
            if (!progress) {
              progress = progressRepo.create({
                enrollment_id: enrollment.id, assessment_id: assessment_id, lesson_id: null, user_id: userId, course_id: courseId,
                is_completed: !requiresManualGrading && passed, completion_percentage: percentage, score: totalScore,
                status: !requiresManualGrading ? (passed ? "passed" : "failed") : "pending", attempt_count: 1, answers: answers,
              });
            } else {
              progress.attempt_count = (progress.attempt_count || 0) + 1;
              if (!requiresManualGrading) {
                progress.is_completed = passed; progress.completion_percentage = percentage; progress.score = totalScore;
                progress.status = passed ? "passed" : "failed";
                if (passed && !progress.completed_at) progress.completed_at = new Date();
              } else {
                progress.status = "pending";
              }
              progress.answers = answers;
            }
            progress.last_accessed_at = new Date();
            await progressRepo.save(progress);
          }
        } catch (progressError) {
        }
      }

      if (enrollment) {
        try {
          const course = await courseRepo.findOne({ where: { id: enrollment.course_id }, relations: ["modules", "modules.lessons"] });
          if (course) {
            const totalLessons = course.modules?.reduce((sum, module) => sum + (module.lessons?.length || 0), 0) || 0;
            const completedLessonsCount = await progressRepo.count({ where: { enrollment_id: enrollment.id, is_completed: true, lesson_id: Not(null), assessment_id: null } });
            enrollment.completed_lessons = completedLessonsCount;
            enrollment.progress_percentage = totalLessons > 0 ? Math.round((completedLessonsCount / totalLessons) * 100) : 0;
            await enrollmentRepo.save(enrollment);
          }
        } catch (enrollmentError) {
        }
      }

      if (requiresManualGrading && !isQuiz && assessment) {
        await AnswerController.notifyInstructorForGrading(assessment, user);
      }

      if (!requiresManualGrading) {
        try {
          await sendEmail({
            to: user.email,
            subject: `${assessmentType} Submitted: ${isQuiz ? quiz.title : assessment.title}`,
            html: `
              <h2>${assessmentType} Submission Received</h2>
              <p>Dear ${user.first_name || user.email},</p>
              <p>Your ${assessmentType.toLowerCase()} has been submitted successfully.</p>
              <p><strong>Score:</strong> ${totalScore} / ${totalPossiblePoints} (${percentage.toFixed(2)}%)</p>
              <p><strong>Passing Score:</strong> ${passingScore}%</p>
              <p><strong>Status:</strong> ${passed ? "✅ PASSED" : "❌ FAILED"}</p>
              <p>View your results at ${process.env.CLIENT_URL}/courses/${courseId}/learn</p>
            `,
          });
        } catch (emailError) {
        }
      }

      res.json({
        success: true,
        message: requiresManualGrading ? "Assessment submitted - awaiting instructor grading" : `${assessmentType} submitted successfully`,
        data: {
          assessment_id, assessment_type: assessmentType, enrollment_id: enrollment?.id || null,
          course_id: courseId, lesson_id: lessonId, total_score: totalScore, total_possible_points: totalPossiblePoints,
          percentage: percentage.toFixed(2), passing_score: passingScore, passed: requiresManualGrading ? null : passed,
          requires_manual_grading: requiresManualGrading, answers_count: processedAnswers.length,
          objective_questions: objectiveQuestionsCount, subjective_questions: subjectiveQuestionsCount,
          answers: processedAnswers.map(ans => ({
            id: ans.id, question_id: ans.question_id, is_correct: ans.is_correct, points_earned: ans.points_earned, is_graded: ans.is_graded,
          })),
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to submit answers", error: error.message, stack: process.env.NODE_ENV === "development" ? error.stack : undefined });
    }
  }



  // In AnswerController.ts - Update getUserAnswers method
  static async getUserAnswers(req: Request, res: Response) {
    try {
      const { assessment_id } = req.params;
      const userId = req.user?.userId || req.user?.id;


      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User authentication required",
        });
      }

      const answerRepo = dbConnection.getRepository(Answer);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const quizRepo = dbConnection.getRepository(Quiz);
      const questionRepo = dbConnection.getRepository(Question);

      // ==================== STEP 1: IDENTIFY ASSESSMENT TYPE ====================
      let actualAssessmentId = assessment_id;
      let isQuizId = false;
      let assessmentTitle = "";
      let questions: any[] = [];

      // Try Assessment first
      let assessment = await assessmentRepo.findOne({
        where: { id: assessment_id },
        relations: ["course", "lesson", "module"],
      });

      if (assessment) {
        assessmentTitle = assessment.title;

        // Extract questions from assessment JSONB
        if (assessment.questions && Array.isArray(assessment.questions)) {
          questions = assessment.questions.map((q: any) => ({
            ...q,
            id: q.id,
            text: q.question,
            question_text: q.question,
            question_type: q.type,
            points: q.points || 1,
            order_index: q.order_index || 0,
          }));
        }
      } else {
        // Try Quiz
        const quiz = await quizRepo.findOne({
          where: { id: assessment_id },
          relations: ["questions", "course", "lesson"],
        });

        if (quiz) {
          isQuizId = true;
          assessmentTitle = quiz.title;

          // Check if there's a linked assessment for this lesson
          if (quiz.lesson_id) {
            const linkedAssessment = await assessmentRepo.findOne({
              where: { lesson_id: quiz.lesson_id },
            });
            if (linkedAssessment) {
              actualAssessmentId = linkedAssessment.id;
            }
          }

          // Get questions from Quiz's Question table
          if (quiz.questions && Array.isArray(quiz.questions)) {
            questions = quiz.questions.map((q: any) => ({
              id: q.id,
              text: q.question_text,
              question_text: q.question_text,
              question_type: q.question_type,
              options: q.options || [],
              correct_answer: q.correct_answer,
              points: q.points || 1,
              order_index: q.order_index || 0,
              explanation: q.explanation,
            }));
          }
        }
      }

      if (!assessment && !isQuizId) {
        return res.status(404).json({
          success: false,
          message: "Assessment/Quiz not found",
        });
      }

      // ==================== STEP 2: FETCH USER ANSWERS ====================
      const answers = await answerRepo.find({
        where: {
          user_id: userId,
          assessment_id: actualAssessmentId,
        },
        order: { created_at: "ASC" },
      });


      if (answers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No answers found",
        });
      }

      // ==================== STEP 3: MAP QUESTIONS TO ANSWERS ====================
      const questionMap = new Map();
      questions.forEach(q => questionMap.set(q.id, q));

      // Also create a reverse map by order index for fallback matching
      const questionsByOrder = new Map();
      questions.forEach((q, index) => questionsByOrder.set(index, q));

      const detailedAnswers = [];
      let totalPoints = 0;
      let totalPossiblePoints = 0;
      let correctAnswersCount = 0;
      let gradedAnswersCount = 0;

      for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        let questionData = questionMap.get(answer.question_id);

        // If question not found by ID, try to match by order/index
        if (!questionData && i < questions.length) {
          questionData = questionsByOrder.get(i);
          if (questionData) {
          }
        }

        if (questionData) {
          totalPossiblePoints += questionData.points || 1;

          if (answer.is_graded) {
            gradedAnswersCount++;
            totalPoints += answer.points_earned || 0;
            if (answer.is_correct) {
              correctAnswersCount++;
            }
          }

          const answerDetail = {
            // Answer Info
            answer_id: answer.id,
            question_id: answer.question_id,
            attempt_number: answer.attempt_number,
            time_spent_seconds: answer.time_spent_seconds,
            submitted_at: answer.created_at,

            // Full Question Data - IMPORTANT: Include complete question object
            question: {
              id: questionData.id,
              text: questionData.text || questionData.question_text || "Question",
              type: questionData.question_type || questionData.type,
              options: questionData.options || [],
              points: questionData.points || 1,
              order_index: questionData.order_index || i + 1,
              correct_answer: questionData.correct_answer,
              explanation: questionData.explanation,
            },

            // User's Answer
            user_answer: answer.answer,
            selected_option: answer.selected_option,

            // Grading Info
            is_graded: answer.is_graded,
            is_correct: answer.is_correct,
            points_earned: answer.points_earned || 0,
            points_possible: questionData.points || 1, // CRITICAL: Set proper points possible

            // Feedback
            correct_answer: questionData.correct_answer,
            explanation: questionData.explanation,
            instructor_feedback: answer.feedback,
            graded_by: answer.graded_by_user_id,
            graded_at: answer.graded_at,
          };

          detailedAnswers.push(answerDetail);
        } else {

          const answerDetail: any = {
            answer_id: answer.id,
            question_id: answer.question_id,
            user_answer: answer.answer,
            is_graded: answer.is_graded,
            is_correct: answer.is_correct,
            points_earned: answer.points_earned || 0,
            points_possible: 1, // Default to 1 point
            error: "Question data not found",
            warning: `Question ID ${answer.question_id} not found`,
          };

          detailedAnswers.push(answerDetail);

          if (answer.is_graded) {
            gradedAnswersCount++;
            totalPoints += answer.points_earned || 0;
            if (answer.is_correct) {
              correctAnswersCount++;
            }
          }
        }
      }

      // Sort by order_index
      detailedAnswers.sort((a, b) =>
        (a.question?.order_index || 0) - (b.question?.order_index || 0)
      );

      // ==================== STEP 4: CALCULATE SCORE ====================
      const percentage = totalPossiblePoints > 0
        ? (totalPoints / totalPossiblePoints) * 100
        : 0;

      const passingScore = assessment?.passing_score || 70;
      const hasPassed = gradedAnswersCount === detailedAnswers.length && percentage >= passingScore;

      // ==================== STEP 5: RETURN RESPONSE ====================
      const response = {
        success: true,
        data: {
          assessment: {
            id: actualAssessmentId,
            original_id: assessment_id,
            type: "ASSESSMENT",
            title: assessmentTitle,
            passing_score: passingScore,
            questions: questions, // Include questions array
          },
          summary: {
            total_questions: detailedAnswers.length,
            answered_questions: detailedAnswers.length,
            graded_questions: gradedAnswersCount,
            pending_grading: detailedAnswers.length - gradedAnswersCount,
            correct_answers: correctAnswersCount,
            incorrect_answers: gradedAnswersCount - correctAnswersCount,

            // Scoring - ensure proper values
            total_points_earned: totalPoints,
            total_points_possible: totalPossiblePoints,
            percentage: parseFloat(percentage.toFixed(2)),
            passing_percentage: passingScore,

            // Status
            is_fully_graded: gradedAnswersCount === detailedAnswers.length,
            is_pending: gradedAnswersCount < detailedAnswers.length,
            has_passed: hasPassed,
            status: gradedAnswersCount < detailedAnswers.length
              ? "PENDING_GRADING"
              : hasPassed
                ? "PASSED"
                : "FAILED",
          },
          answers: detailedAnswers, // Now includes full question objects
        },
      };


      return res.json(response);

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch user answers",
        error: error.message,
      });
    }
  }

  // ==================== GET USER'S ALL ANSWERS (FOR SUBMITTED PAGE) ====================
static async getUserAllAnswers(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user?.userId || req.user?.id;


    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Check permissions - users can only view their own answers
    if (requestingUserId !== userId) {
      const userRepo = dbConnection.getRepository(User);
      const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
      
      if (requestingUser?.bwenge_role !== "SYSTEM_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this user's answers",
        });
      }
    }

    const answerRepo = dbConnection.getRepository(Answer);
    const assessmentRepo = dbConnection.getRepository(Assessment);
    const quizRepo = dbConnection.getRepository(Quiz);
    const courseRepo = dbConnection.getRepository(Course);

    // Get all answers for the user
    const answers = await answerRepo.find({
      where: { user_id: userId },
      order: { created_at: "DESC" },
    });


    // Group by assessment/quiz to get unique submissions
    const submissionMap = new Map();

    for (const answer of answers) {
      const key = `${answer.assessment_id || answer.quiz_id}-${answer.attempt_number}`;
      
      // Only keep the latest version of each submission
      if (!submissionMap.has(key) || 
          new Date(answer.created_at) > new Date(submissionMap.get(key).created_at)) {
        
        // Fetch assessment/quiz details
        let assessmentTitle = "Unknown Assessment";
        let courseId = answer.course_id;
        let courseTitle = "Unknown Course";
        let courseThumbnail = null;
        let instructorName = "Unknown Instructor";
        let totalPoints = 0;
        let questions: any[] = [];

        if (answer.assessment_id) {
          const assessment = await assessmentRepo.findOne({
            where: { id: answer.assessment_id },
            relations: ["course", "course.instructor"],
          });
          
          if (assessment) {
            assessmentTitle = assessment.title;
            courseId = assessment.course_id;
            
            if (assessment.course) {
              courseTitle = assessment.course.title;
              courseThumbnail = assessment.course.thumbnail_url;
              if (assessment.course.instructor) {
                instructorName = `${assessment.course.instructor.first_name} ${assessment.course.instructor.last_name}`.trim();
              }
            }
            
            if (assessment.questions) {
              questions = assessment.questions;
              totalPoints = assessment.questions.reduce(
                (sum: number, q: any) => sum + (q.points || 1),
                0
              );
            }
          }
        } else if (answer.quiz_id) {
          const quiz = await quizRepo.findOne({
            where: { id: answer.quiz_id },
            relations: ["course", "course.instructor", "questions"],
          });
          
          if (quiz) {
            assessmentTitle = quiz.title;
            courseId = quiz.course_id;
            
            if (quiz.course) {
              courseTitle = quiz.course.title;
              courseThumbnail = quiz.course.thumbnail_url;
              if (quiz.course.instructor) {
                instructorName = `${quiz.course.instructor.first_name} ${quiz.course.instructor.last_name}`.trim();
              }
            }
            
            if (quiz.questions) {
              questions = quiz.questions;
              totalPoints = quiz.questions.reduce(
                (sum: number, q: any) => sum + (q.points || 1),
                0
              );
            }
          }
        }

        // Calculate percentage
        const percentage = totalPoints > 0
          ? ((answer.points_earned || 0) / totalPoints) * 100
          : 0;

        // Determine status
        let status: "PENDING_GRADING" | "GRADED" | "AUTO_GRADED" = "PENDING_GRADING";
        
        // Check if it's a quiz (auto-graded)
        if (answer.quiz_id) {
          status = "AUTO_GRADED";
        } else if (answer.is_graded) {
          status = "GRADED";
        }

        submissionMap.set(key, {
          id: key,
          assessment_id: answer.assessment_id || answer.quiz_id,
          title: assessmentTitle,
          description: "", // Would need to fetch description
          course: {
            id: courseId,
            title: courseTitle,
            thumbnail_url: courseThumbnail,
            instructor: {
              id: answer.course_id ? "fetch-me" : "",
              name: instructorName,
            },
          },
          submitted_at: answer.created_at,
          attempt_number: answer.attempt_number,
          total_attempts: 3, // Would need to fetch from assessment
          answers_count: 1, // Would need to count answers
          questions_count: questions.length,
          total_points: totalPoints,
          status,
          score: answer.points_earned || 0,
          percentage,
          passed: answer.passed || (percentage >= 70), // Would need passing score
          feedback: answer.feedback,
          graded_at: answer.graded_at,
          graded_by: answer.graded_by_user_id,
        });
      }
    }

    const submissions = Array.from(submissionMap.values());

    // Sort by most recent first
    submissions.sort((a: any, b: any) => 
      new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    );

    // Calculate statistics
    const totalSubmissions = submissions.length;
    const pendingGrading = submissions.filter((s: any) => s.status === "PENDING_GRADING").length;
    const graded = submissions.filter((s: any) => s.status === "GRADED").length;
    const autoGraded = submissions.filter((s: any) => s.status === "AUTO_GRADED").length;

    const gradedSubmissions = submissions.filter((s: any) => s.percentage > 0);
    const averageScore = gradedSubmissions.length > 0
      ? gradedSubmissions.reduce((sum: number, s: any) => sum + s.percentage, 0) / gradedSubmissions.length
      : 0;

    const passedCount = gradedSubmissions.filter((s: any) => s.passed).length;
    const passRate = gradedSubmissions.length > 0 ? (passedCount / gradedSubmissions.length) * 100 : 0;

    res.json({
      success: true,
      data: submissions,
      summary: {
        total: totalSubmissions,
        pending_grading: pendingGrading,
        graded,
        auto_graded: autoGraded,
        average_score: averageScore,
        pass_rate: passRate,
      },
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user answers",
      error: error.message,
    });
  }
}

// ==================== GET PENDING SUBMISSIONS (INSTRUCTOR) ====================
static async getPendingSubmissions(req: Request, res: Response) {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { course_id, assessment_id } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    const answerRepo = dbConnection.getRepository(Answer);
    const userRepo = dbConnection.getRepository(User);
    const assessmentRepo = dbConnection.getRepository(Assessment);

    // Verify user is instructor
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user || !["INSTRUCTOR", "CONTENT_CREATOR", "INSTITUTION_ADMIN", "SYSTEM_ADMIN"].includes(user.bwenge_role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions - instructor access required",
      });
    }

    // Step 1: Find all final submissions by students
    const queryBuilder = answerRepo
      .createQueryBuilder("answer")
      .leftJoinAndSelect("answer.user", "user")
      .leftJoinAndSelect("answer.assessment", "assessment")
      .leftJoinAndSelect("assessment.course", "course")
      .leftJoinAndSelect("assessment.lesson", "lesson")
      .where("answer.is_final_submission = :isFinal", { isFinal: true });

    // Filter by course instructor
    if (user.bwenge_role !== "SYSTEM_ADMIN") {
      queryBuilder.andWhere(
        "(course.instructor_id = :userId OR course.id IN (SELECT course_id FROM course_instructors WHERE instructor_id = :userId))",
        { userId }
      );
    }

    if (course_id) {
      queryBuilder.andWhere("course.id = :course_id", { course_id });
    }

    if (assessment_id) {
      queryBuilder.andWhere("assessment.id = :assessment_id", { assessment_id });
    }

    const allAnswers = await queryBuilder
      .orderBy("answer.created_at", "DESC")
      .getMany();


    // Step 2: Group by user and assessment
    const submissionMap = new Map();

    for (const answer of allAnswers) {
      const key = `${answer.user_id}-${answer.assessment_id}`;
      
      if (!submissionMap.has(key)) {
        submissionMap.set(key, {
          key,
          user: {
            id: answer.user.id,
            first_name: answer.user.first_name,
            last_name: answer.user.last_name,
            email: answer.user.email,
          },
          assessment: answer.assessment,
          answers: [],
          submitted_at: answer.created_at,
        });
      }

      const submission = submissionMap.get(key);
      submission.answers.push(answer);
    }

    const groupedSubmissions = Array.from(submissionMap.values());

    // Step 3: For each submission, check if it has subjective questions pending grading
    const pendingSubmissions = [];

    for (const submission of groupedSubmissions) {
      const assessment = await assessmentRepo.findOne({
        where: { id: submission.assessment.id },
        select: ["id", "questions"]
      });

      if (!assessment || !assessment.questions) {
        continue;
      }

      // Get all answers for this submission
      const allAnswersForSubmission = await answerRepo.find({
        where: {
          user_id: submission.user.id,
          assessment_id: submission.assessment.id,
          is_final_submission: true
        }
      });

      // Create a map of question_id -> answer
      const answerMap = new Map();
      allAnswersForSubmission.forEach(answer => {
        answerMap.set(answer.question_id, answer);
      });

      // Check if there are any subjective questions that need grading
      let hasSubjectiveQuestionsPending = false;
      let hasSubjectiveQuestions = false;

      for (const question of assessment.questions) {
        const answer = answerMap.get(question.id);
        
        if (["SHORT_ANSWER", "ESSAY"].includes(question.type)) {
          hasSubjectiveQuestions = true;
          
          if (answer && !answer.is_graded) {
            hasSubjectiveQuestionsPending = true;
            break;
          }
        }
      }

      // Only include submissions that have subjective questions pending grading
      if (hasSubjectiveQuestions && hasSubjectiveQuestionsPending) {
        pendingSubmissions.push(submission);
      }
    }

    // Step 4: For pending submissions, fetch ALL answers (including auto-graded ones)
    const finalSubmissions = [];

    for (const submission of pendingSubmissions) {
      const assessment = await assessmentRepo.findOne({
        where: { id: submission.assessment.id }
      });

      if (!assessment) continue;

      // Get ALL answers for this user and assessment
      const allAnswers = await answerRepo.find({
        where: {
          user_id: submission.user.id,
          assessment_id: submission.assessment.id,
          is_final_submission: true
        },
        order: { created_at: "ASC" }
      });

      // Create a complete submission with all answers
      const completeSubmission = {
        key: submission.key,
        user: submission.user,
        assessment: {
          ...assessment,
          // Ensure questions array exists
          questions: assessment.questions || []
        },
        answers: allAnswers.map(answer => ({
          id: answer.id,
          question_id: answer.question_id,
          answer: answer.answer,
          selected_option: answer.selected_option,
          is_correct: answer.is_correct,
          points_earned: answer.points_earned,
          is_graded: answer.is_graded,
          feedback: answer.feedback,
          created_at: answer.created_at,
          updated_at: answer.updated_at
        })),
        submitted_at: submission.submitted_at
      };

      finalSubmissions.push(completeSubmission);
    }


    res.json({
      success: true,
      data: {
        total: finalSubmissions.length,
        submissions: finalSubmissions,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch pending submissions",
      error: error.message,
    });
  }
}
  // ==================== GRADE ASSESSMENT MANUALLY ====================
  static async gradeAssessmentManually(req: Request, res: Response) {
    try {
      const { assessment_id, user_id, graded_answers } = req.body;
      const instructorId = req.user?.userId || req.user?.id;


      if (!instructorId) {
        return res.status(401).json({
          success: false,
          message: "Instructor authentication required",
        });
      }

      if (!assessment_id || !user_id || !Array.isArray(graded_answers)) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: assessment_id, user_id, and graded_answers array",
        });
      }

      const answerRepo = dbConnection.getRepository(Answer);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const progressRepo = dbConnection.getRepository(Progress);

      const assessment = await assessmentRepo.findOne({
        where: { id: assessment_id },
        relations: ["course"],
      });

      if (!assessment) {
        return res.status(404).json({
          success: false,
          message: "Assessment not found",
        });
      }

      const student = await userRepo.findOne({ where: { id: user_id } });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: "Student not found",
        });
      }

      let totalScore = 0;
      let totalPossiblePoints = 0;
      const gradedAnswerResults = [];

      // Update each answer with instructor's grading
      for (const gradedAnswer of graded_answers) {
        const { answer_id, points_earned, feedback } = gradedAnswer;

        const answer = await answerRepo.findOne({
          where: { id: answer_id, user_id, assessment_id },
        });

        if (!answer) {
          continue;
        }

        // Find question data from assessment using question_id from answer
        const questionData = assessment.questions.find(
          (q: any) => q.id === answer.question_id
        );

        if (questionData) {
          totalPossiblePoints += questionData.points || 0;
        }

        answer.points_earned = points_earned;
        answer.feedback = feedback || null;
        answer.is_graded = true;
        answer.graded_by_user_id = instructorId;
        answer.graded_at = new Date();
        answer.is_correct = points_earned === (questionData?.points || 0);

        await answerRepo.save(answer);
        totalScore += points_earned;

        gradedAnswerResults.push({
          answer_id: answer.id,
          question_id: answer.question_id,
          points_earned,
          feedback,
        });

      }

      const percentage = totalPossiblePoints > 0
        ? (totalScore / totalPossiblePoints) * 100
        : 0;

      const passed = percentage >= assessment.passing_score;


      // ==================== UPDATE PROGRESS ====================
      const enrollment = await enrollmentRepo.findOne({
        where: {
          user_id,
          course_id: assessment.course_id,
        },
      });

      if (enrollment) {
        // Update assessment or lesson progress
        if (assessment.lesson_id) {
          // Lesson-based assessment
          let progress = await progressRepo.findOne({
            where: {
              enrollment_id: enrollment.id,
              lesson_id: assessment.lesson_id,
              assessment_id: null,
            },
          });

          if (progress) {
            progress.is_completed = passed;
            progress.completion_percentage = percentage;
            progress.score = percentage;
            progress.status = passed ? "completed" : "failed";
            if (passed && !progress.completed_at) {
              progress.completed_at = new Date();
            }
            await progressRepo.save(progress);
          }
        } else {
          // Standalone assessment
          let progress = await progressRepo.findOne({
            where: {
              enrollment_id: enrollment.id,
              assessment_id: assessment_id,
              lesson_id: null,
            },
          });

          if (progress) {
            progress.is_completed = passed;
            progress.completion_percentage = percentage;
            progress.score = totalScore;
            progress.status = passed ? "passed" : "failed";
            if (passed && !progress.completed_at) {
              progress.completed_at = new Date();
            }
            await progressRepo.save(progress);
          }
        }

        // Update enrollment final score
        enrollment.final_score = percentage;
        await enrollmentRepo.save(enrollment);
      }

      // Send email notification to student
      try {
        await sendEmail({
          to: student.email,
          subject: `Assessment Graded: ${assessment.title}`,
          html: `
            <h2>Your Assessment Has Been Graded</h2>
            <p>Dear ${student.first_name || student.email},</p>
            <p>Your assessment <strong>${assessment.title}</strong> has been graded by your instructor.</p>
            <p><strong>Score:</strong> ${totalScore} / ${totalPossiblePoints} (${percentage.toFixed(2)}%)</p>
            <p><strong>Passing Score:</strong> ${assessment.passing_score}%</p>
            <p><strong>Status:</strong> ${passed ? "✅ PASSED" : "❌ FAILED"}</p>
            <p>View your detailed results and feedback at ${process.env.CLIENT_URL}/courses/${assessment.course_id}/assessments/${assessment_id}/results</p>
          `,
        });
      } catch (emailError) {
      }

      res.json({
        success: true,
        message: "Assessment graded successfully",
        data: {
          assessment_id,
          user_id,
          total_score: totalScore,
          total_possible_points: totalPossiblePoints,
          percentage: percentage.toFixed(2),
          passing_score: assessment.passing_score,
          passed,
          graded_answers: gradedAnswerResults,
          graded_by: instructorId,
          graded_at: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to grade assessment",
        error: error.message,
      });
    }
  }

  // ==================== HELPER: EVALUATE QUESTION ====================
  private static evaluateQuestion(
    questionData: any,
    submittedAnswer: any
  ): { isCorrect: boolean; pointsEarned: number } {
    const normalize = (s: string) => s.trim().toLowerCase();

    const parseArray = (raw: any): string[] => {
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch (_) { }
        return raw.split(",").map((x) => x.trim()).filter(Boolean);
      }
      return [String(raw)];
    };

    let isCorrect = false;
    let pointsEarned = 0;

    const questionType = questionData.type || questionData.question_type;
    const questionPoints = questionData.points || 0;

    if (questionType === "MULTIPLE_CHOICE") {
      const correctAnswers = parseArray(questionData.correct_answer);
      const submittedAnswers = parseArray(submittedAnswer);

      const normCorrect = correctAnswers.map(normalize).sort();
      const normSubmitted = submittedAnswers.map(normalize).sort();

      if (
        normCorrect.length === normSubmitted.length &&
        normCorrect.every((v, i) => v === normSubmitted[i])
      ) {
        isCorrect = true;
        pointsEarned = questionPoints;
      }
    } else if (questionType === "TRUE_FALSE") {
      const correctAnswer = normalize(String(questionData.correct_answer));
      const submittedAns = normalize(String(submittedAnswer));

      if (correctAnswer === submittedAns) {
        isCorrect = true;
        pointsEarned = questionPoints;
      }
    } else {
      // For other types, exact match
      const correctAnswer = normalize(String(questionData.correct_answer));
      const submittedAns = normalize(
        Array.isArray(submittedAnswer) ? String(submittedAnswer[0]) : String(submittedAnswer)
      );

      if (correctAnswer === submittedAns) {
        isCorrect = true;
        pointsEarned = questionPoints;
      }
    }

    return { isCorrect, pointsEarned };
  }

  // ==================== HELPER: NOTIFY INSTRUCTOR ====================
  private static async notifyInstructorForGrading(assessment: Assessment, student: User) {
    try {
      const course = assessment.course;
      if (!course || !course.instructor) {
        return;
      }

      await sendEmail({
        to: course.instructor.email,
        subject: `New Submission Requires Grading: ${assessment.title}`,
        html: `
          <h2>New Assessment Submission</h2>
          <p>Student <strong>${student.first_name || student.email} ${student.last_name || ""}</strong> has submitted <strong>${assessment.title}</strong>.</p>
          <p>This assessment contains subjective questions that require manual grading.</p>
          <p>Course: <strong>${course.title}</strong></p>
          <p>View submissions at ${process.env.CLIENT_URL}/instructor/grading</p>
        `,
      });

    } catch (error) {
    }
  }
}