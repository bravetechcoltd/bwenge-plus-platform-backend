// @ts-nocheck
import dbConnection from "../database/db";
import {
  Notification,
  NotificationType,
  NotificationEntityType,
  RecipientRole,
} from "../database/models/Notification";
import { User, BwengeRole } from "../database/models/User";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { emitToUser, emitToAdminRoom, emitToInstitutionAdmins } from "../socket/socketEmitter";

interface CreateNotificationParams {
  recipientUserId: string;
  recipientRole: RecipientRole;
  notificationType: NotificationType;
  title: string;
  body: string;
  entityType: NotificationEntityType;
  entityId?: string;
  actorUserId?: string;
  institutionId?: string;
}

export class NotificationService {
  // ==================== CORE METHODS ====================

  static async createNotification(
    params: CreateNotificationParams
  ): Promise<Notification> {
    const repo = dbConnection.getRepository(Notification);
    const notification = repo.create({
      recipient_user_id: params.recipientUserId,
      recipient_role: params.recipientRole,
      notification_type: params.notificationType,
      title: params.title,
      body: params.body,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      actor_user_id: params.actorUserId || null,
      institution_id: params.institutionId || null,
    });
    const saved = await repo.save(notification);

    // ── Real-time: Push notification + unread count to user via socket ──────
    emitToUser(params.recipientUserId, "new-notification", saved);

    const unreadCount = await repo.count({
      where: { recipient_user_id: params.recipientUserId, is_read: false },
    });
    emitToUser(params.recipientUserId, "unread-count-updated", { unreadCount });

    return saved;
  }

  static async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
    isRead?: boolean
  ) {
    const repo = dbConnection.getRepository(Notification);
    const skip = (page - 1) * limit;

    const where: any = { recipient_user_id: userId };
    if (isRead !== undefined) {
      where.is_read = isRead;
    }

    const [items, total] = await repo.findAndCount({
      where,
      order: { created_at: "DESC" },
      skip,
      take: limit,
    });

    const unreadCount = await repo.count({
      where: { recipient_user_id: userId, is_read: false },
    });

    return {
      items,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + items.length < total,
      },
    };
  }

  static async getUnreadCount(userId: string): Promise<number> {
    const repo = dbConnection.getRepository(Notification);
    return await repo.count({
      where: { recipient_user_id: userId, is_read: false },
    });
  }

  static async markAsRead(
    notificationId: string,
    userId: string
  ): Promise<Notification | null> {
    const repo = dbConnection.getRepository(Notification);
    const notification = await repo.findOne({
      where: { id: notificationId, recipient_user_id: userId },
    });

    if (!notification) return null;

    notification.is_read = true;
    notification.read_at = new Date();
    return await repo.save(notification);
  }

  static async markAllAsRead(userId: string): Promise<number> {
    const repo = dbConnection.getRepository(Notification);
    const result = await repo
      .createQueryBuilder()
      .update(Notification)
      .set({ is_read: true, read_at: new Date() })
      .where("recipient_user_id = :userId AND is_read = false", { userId })
      .execute();
    return result.affected || 0;
  }

  // ==================== TRIGGER HELPERS ====================

  // Notify a single user
  private static async notifyUser(
    userId: string,
    role: RecipientRole,
    type: NotificationType,
    title: string,
    body: string,
    entityType: NotificationEntityType,
    entityId?: string,
    actorUserId?: string,
    institutionId?: string
  ) {
    try {
      await this.createNotification({
        recipientUserId: userId,
        recipientRole: role,
        notificationType: type,
        title,
        body,
        entityType,
        entityId,
        actorUserId,
        institutionId,
      });
    } catch (error) {
      console.error(`Failed to create notification for user ${userId}:`, error);
    }
  }

  // Notify all users with a specific role in an institution
  private static async notifyInstitutionAdmins(
    institutionId: string,
    type: NotificationType,
    title: string,
    body: string,
    entityType: NotificationEntityType,
    entityId?: string,
    actorUserId?: string
  ) {
    try {
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const admins = await memberRepo.find({
        where: { institution_id: institutionId, role: "ADMIN" as any },
        select: ["user_id"],
      });

      // Also find users whose bwenge_role is INSTITUTION_ADMIN and primary_institution_id matches
      const userRepo = dbConnection.getRepository(User);
      const institutionAdminUsers = await userRepo.find({
        where: {
          bwenge_role: BwengeRole.INSTITUTION_ADMIN,
          primary_institution_id: institutionId,
        },
        select: ["id"],
      });

      const adminUserIds = new Set([
        ...admins.map((a) => a.user_id),
        ...institutionAdminUsers.map((u) => u.id),
      ]);

      for (const userId of adminUserIds) {
        await this.notifyUser(
          userId,
          RecipientRole.INSTITUTION_ADMIN,
          type,
          title,
          body,
          entityType,
          entityId,
          actorUserId,
          institutionId
        );
      }
    } catch (error) {
      console.error("Failed to notify institution admins:", error);
    }
  }

  // Notify all system admins
  private static async notifySystemAdmins(
    type: NotificationType,
    title: string,
    body: string,
    entityType: NotificationEntityType,
    entityId?: string,
    actorUserId?: string
  ) {
    try {
      const userRepo = dbConnection.getRepository(User);
      const systemAdmins = await userRepo.find({
        where: { bwenge_role: BwengeRole.SYSTEM_ADMIN },
        select: ["id"],
      });

      for (const admin of systemAdmins) {
        await this.notifyUser(
          admin.id,
          RecipientRole.SYSTEM_ADMIN,
          type,
          title,
          body,
          entityType,
          entityId,
          actorUserId
        );
      }
    } catch (error) {
      console.error("Failed to notify system admins:", error);
    }
  }

  // ==================== LEARNER TRIGGERS ====================

  static async onEnrollmentApproved(
    learnerId: string,
    courseName: string,
    enrollmentId: string,
    actorUserId?: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.ENROLLMENT_APPROVED,
      "Enrollment Approved",
      `Your enrollment in "${courseName}" has been approved`,
      NotificationEntityType.ENROLLMENT,
      enrollmentId,
      actorUserId
    );
  }

  static async onEnrollmentRejected(
    learnerId: string,
    courseName: string,
    enrollmentId: string,
    actorUserId?: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.ENROLLMENT_REJECTED,
      "Enrollment Not Approved",
      `Your enrollment request for "${courseName}" was not approved`,
      NotificationEntityType.ENROLLMENT,
      enrollmentId,
      actorUserId
    );
  }

  static async onEnrollmentPending(
    learnerId: string,
    courseName: string,
    enrollmentId: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.ENROLLMENT_PENDING,
      "Enrollment Pending",
      `Your enrollment request for "${courseName}" is pending review`,
      NotificationEntityType.ENROLLMENT,
      enrollmentId
    );
  }

  static async onAssessmentGraded(
    learnerId: string,
    courseName: string,
    score: number,
    assessmentId: string,
    actorUserId?: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.ASSESSMENT_GRADED,
      "Assessment Graded",
      `Your submission for "${courseName}" has been graded — Score: ${score}%`,
      NotificationEntityType.ASSESSMENT,
      assessmentId,
      actorUserId
    );
  }

  static async onNewLessonPublished(
    learnerId: string,
    courseName: string,
    courseId: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.NEW_LESSON_PUBLISHED,
      "New Content Available",
      `New content available in "${courseName}"`,
      NotificationEntityType.COURSE,
      courseId
    );
  }

  static async onCertificateIssued(
    learnerId: string,
    courseName: string,
    certificateId: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.CERTIFICATE_ISSUED,
      "Certificate Ready",
      `Congratulations! Your certificate for "${courseName}" is ready`,
      NotificationEntityType.CERTIFICATE,
      certificateId
    );
  }

  static async onCourseDeadlineReminder(
    learnerId: string,
    courseName: string,
    courseId: string
  ) {
    await this.notifyUser(
      learnerId,
      RecipientRole.LEARNER,
      NotificationType.COURSE_DEADLINE_REMINDER,
      "Deadline Reminder",
      `Reminder: "${courseName}" has content due soon`,
      NotificationEntityType.COURSE,
      courseId
    );
  }

  // ==================== INSTITUTION ADMIN TRIGGERS ====================

  static async onNewEnrollmentRequest(
    institutionId: string,
    studentName: string,
    courseName: string,
    enrollmentId: string,
    actorUserId?: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.NEW_ENROLLMENT_REQUEST,
      "New Enrollment Request",
      `New enrollment request from ${studentName} for "${courseName}"`,
      NotificationEntityType.ENROLLMENT,
      enrollmentId,
      actorUserId
    );
  }

  static async onNewInstructorJoined(
    institutionId: string,
    instructorName: string,
    instructorId: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.NEW_INSTRUCTOR_JOINED,
      "New Instructor",
      `Instructor ${instructorName} has joined your institution`,
      NotificationEntityType.USER,
      instructorId
    );
  }

  static async onNewStudentJoined(
    institutionId: string,
    studentName: string,
    studentId: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.NEW_STUDENT_JOINED,
      "New Student",
      `A new student ${studentName} has enrolled in your institution`,
      NotificationEntityType.USER,
      studentId
    );
  }

  static async onCoursePublished(
    institutionId: string,
    courseName: string,
    courseId: string,
    actorUserId?: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.COURSE_PUBLISHED,
      "Course Published",
      `Course "${courseName}" has been published`,
      NotificationEntityType.COURSE,
      courseId,
      actorUserId
    );
  }

  static async onCourseFlagged(
    institutionId: string,
    courseName: string,
    courseId: string,
    actorUserId?: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.COURSE_FLAGGED,
      "Course Flagged",
      `Course "${courseName}" has been flagged for review`,
      NotificationEntityType.COURSE,
      courseId,
      actorUserId
    );
  }

  static async onBulkEnrollmentCompleted(
    institutionId: string,
    courseName: string,
    count: number,
    courseId: string,
    actorUserId?: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.BULK_ENROLLMENT_COMPLETED,
      "Bulk Enrollment Completed",
      `Bulk enrollment for "${courseName}" completed — ${count} students enrolled`,
      NotificationEntityType.COURSE,
      courseId,
      actorUserId
    );
  }

  static async onAccessCodeUsed(
    institutionId: string,
    courseName: string,
    studentName: string,
    courseId: string,
    actorUserId?: string
  ) {
    await this.notifyInstitutionAdmins(
      institutionId,
      NotificationType.ACCESS_CODE_USED,
      "Access Code Used",
      `Access code used for course "${courseName}" by ${studentName}`,
      NotificationEntityType.COURSE,
      courseId,
      actorUserId
    );
  }

  // ==================== SYSTEM ADMIN TRIGGERS ====================

  static async onNewInstitutionRegistration(
    institutionName: string,
    institutionId: string,
    actorUserId?: string
  ) {
    await this.notifySystemAdmins(
      NotificationType.NEW_INSTITUTION_REGISTRATION,
      "New Institution Registration",
      `New institution "${institutionName}" has submitted a registration`,
      NotificationEntityType.INSTITUTION,
      institutionId,
      actorUserId
    );
  }

  static async onNewInstitutionAdmin(
    adminName: string,
    adminId: string
  ) {
    await this.notifySystemAdmins(
      NotificationType.NEW_INSTITUTION_ADMIN,
      "New Institution Admin",
      `New institution admin ${adminName} registered`,
      NotificationEntityType.USER,
      adminId
    );
  }

  static async onContentModerationFlag(
    courseName: string,
    courseId: string,
    actorUserId?: string
  ) {
    await this.notifySystemAdmins(
      NotificationType.CONTENT_MODERATION_FLAG,
      "Content Flagged",
      `Course "${courseName}" has been flagged for content review`,
      NotificationEntityType.COURSE,
      courseId,
      actorUserId
    );
  }

  static async onSystemHealthAlert(
    component: string
  ) {
    await this.notifySystemAdmins(
      NotificationType.SYSTEM_HEALTH_ALERT,
      "System Alert",
      `System alert: ${component} is experiencing issues`,
      NotificationEntityType.SYSTEM
    );
  }

  static async onEnrollmentSpike(
    institutionName: string,
    institutionId: string
  ) {
    await this.notifySystemAdmins(
      NotificationType.ENROLLMENT_SPIKE,
      "Enrollment Spike",
      `Enrollment spike detected in "${institutionName}"`,
      NotificationEntityType.INSTITUTION,
      institutionId
    );
  }

  static async onNewInstructorApplication(
    applicantName: string,
    applicantId: string
  ) {
    await this.notifySystemAdmins(
      NotificationType.NEW_INSTRUCTOR_APPLICATION,
      "New Instructor Application",
      `New instructor application from ${applicantName}`,
      NotificationEntityType.USER,
      applicantId
    );
  }
}
