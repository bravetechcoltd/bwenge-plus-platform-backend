import { Request, Response } from "express";
import dbConnection from '../database/db';
import { Subscribe } from "../database/models/Subscribe";
import { sendEmail, isValidEmail } from "../helpers/utils";
import { SubscribeEmailTemplate } from '../helpers/SubscribeEmailTemplate';

export class SubscribeController {
  
  /**
   * Subscribe a new email
   * POST /api/subscribe
   */
  static async subscribe(req: Request, res: Response) {
    try {
      const { email } = req.body;

      console.log("📧 New subscription request:", email);

      // Validate email
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          message: "Valid email is required"
        });
      }

      const subscribeRepo = dbConnection.getRepository(Subscribe);

      // Check if email already exists
      const existingSubscriber = await subscribeRepo.findOne({ 
        where: { email: email.toLowerCase() } 
      });

      if (existingSubscriber) {
        if (existingSubscriber.is_active) {
          return res.status(409).json({
            success: false,
            message: "This email is already subscribed"
          });
        } else {
          // Reactivate subscription
          existingSubscriber.is_active = true;
          existingSubscriber.notify_new_communities = true;
          existingSubscriber.notify_new_projects = true;
          existingSubscriber.notify_new_events = true;
          await subscribeRepo.save(existingSubscriber);

          console.log("✅ Reactivated subscription:", email);

          return res.status(200).json({
            success: true,
            message: "Welcome back! Your subscription has been reactivated.",
            data: { subscriber: existingSubscriber }
          });
        }
      }

      // Create new subscription
      const newSubscriber = subscribeRepo.create({
        email: email.toLowerCase(),
        is_active: true,
        notify_new_communities: true,
        notify_new_projects: true,
        notify_new_events: true
      });

      await subscribeRepo.save(newSubscriber);

      console.log("✅ New subscriber added:", email);

      // Send welcome email
      try {
        await sendEmail({
          to: email,
          subject: "🎉 Welcome to Ongera - Subscription Confirmed!",
          html: `
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2 style="color: #0158B7;">Welcome to Ongera!</h2>
              <p>Thank you for subscribing to our platform notifications.</p>
              <p>You'll now receive updates about:</p>
              <ul>
                <li>New communities</li>
                <li>New research projects</li>
                <li>Upcoming events</li>
              </ul>
              <p>Stay connected with the latest in research and academia!.</p>
            </body>
            </html>
          `
        });
        console.log("✅ Welcome email sent to:", email);
      } catch (emailError: any) {
        console.error("❌ Failed to send welcome email:", emailError.message);
      }

      res.status(201).json({
        success: true,
        message: "Successfully subscribed! You'll receive notifications about new content.",
        data: { subscriber: newSubscriber }
      });

    } catch (error: any) {
      console.error("❌ Subscribe error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to subscribe",
        error: error.message
      });
    }
  }

  /**
   * Get all active subscribers
   * Internal use only - for sending notifications
   */
  static async getAllActiveSubscribers(): Promise<Subscribe[]> {
    try {
      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const subscribers = await subscribeRepo.find({
        where: { is_active: true }
      });
      return subscribers;
    } catch (error: any) {
      console.error("❌ Error fetching subscribers:", error.message);
      return [];
    }
  }

  /**
   * Get all subscribers with filters
   * GET /api/subscribe/all (Admin only)
   */
  static async getAllSubscribers(req: Request, res: Response) {
    try {
      const { is_active, notify_type } = req.query;

      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const queryBuilder = subscribeRepo.createQueryBuilder("subscriber");

      if (is_active !== undefined) {
        queryBuilder.andWhere("subscriber.is_active = :is_active", { 
          is_active: is_active === 'true' 
        });
      }

      if (notify_type === 'communities') {
        queryBuilder.andWhere("subscriber.notify_new_communities = :value", { value: true });
      } else if (notify_type === 'projects') {
        queryBuilder.andWhere("subscriber.notify_new_projects = :value", { value: true });
      } else if (notify_type === 'events') {
        queryBuilder.andWhere("subscriber.notify_new_events = :value", { value: true });
      }

      const subscribers = await queryBuilder
        .orderBy("subscriber.subscribed_at", "DESC")
        .getMany();

      res.status(200).json({
        success: true,
        count: subscribers.length,
        data: { subscribers }
      });

    } catch (error: any) {
      console.error("❌ Get subscribers error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch subscribers",
        error: error.message
      });
    }
  }

  /**
   * Unsubscribe
   * POST /api/subscribe/unsubscribe
   */
  static async unsubscribe(req: Request, res: Response) {
    try {
      const { email } = req.body;

      if (!email || !isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          message: "Valid email is required"
        });
      }

      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const subscriber = await subscribeRepo.findOne({ 
        where: { email: email.toLowerCase() } 
      });

      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: "Email not found in subscribers list"
        });
      }

      subscriber.is_active = false;
      await subscribeRepo.save(subscriber);

      console.log("✅ Unsubscribed:", email);

      res.status(200).json({
        success: true,
        message: "Successfully unsubscribed. You will no longer receive notifications."
      });

    } catch (error: any) {
      console.error("❌ Unsubscribe error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to unsubscribe",
        error: error.message
      });
    }
  }

  /**
   * Update notification preferences
   * PATCH /api/subscribe/preferences
   */
  static async updatePreferences(req: Request, res: Response) {
    try {
      const { email, notify_new_communities, notify_new_projects, notify_new_events } = req.body;

      if (!email || !isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          message: "Valid email is required"
        });
      }

      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const subscriber = await subscribeRepo.findOne({ 
        where: { email: email.toLowerCase() } 
      });

      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: "Subscriber not found"
        });
      }

      // Update preferences
      if (notify_new_communities !== undefined) {
        subscriber.notify_new_communities = notify_new_communities;
      }
      if (notify_new_projects !== undefined) {
        subscriber.notify_new_projects = notify_new_projects;
      }
      if (notify_new_events !== undefined) {
        subscriber.notify_new_events = notify_new_events;
      }

      await subscribeRepo.save(subscriber);

      console.log("✅ Updated preferences for:", email);

      res.status(200).json({
        success: true,
        message: "Notification preferences updated successfully",
        data: { subscriber }
      });

    } catch (error: any) {
      console.error("❌ Update preferences error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update preferences",
        error: error.message
      });
    }
  }

  /**
   * Send email notifications to subscribers - NEW COMMUNITY
   */
  static async notifyNewCommunity(communityData: any): Promise<void> {
    try {
      console.log("\n📧 ========== NOTIFYING SUBSCRIBERS: NEW COMMUNITY ==========");
      
      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const subscribers = await subscribeRepo.find({
        where: { 
          is_active: true,
          notify_new_communities: true
        }
      });

      console.log(`📊 Found ${subscribers.length} subscriber(s) to notify`);

      if (subscribers.length === 0) {
        console.log("⚠️ No active subscribers to notify");
        return;
      }

      let emailsSent = 0;
      let emailsFailed = 0;

      for (const subscriber of subscribers) {
        try {
          const emailHtml = SubscribeEmailTemplate.getNewCommunityNotification(
            communityData,
            subscriber.email
          );

          await sendEmail({
            to: subscriber.email,
            subject: `🎉 New Community Created: ${communityData.name}`,
            html: emailHtml
          });

          subscriber.last_notification_sent = new Date();
          await subscribeRepo.save(subscriber);

          emailsSent++;
          console.log(`✅ Email sent to: ${subscriber.email}`);

          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (emailError: any) {
          emailsFailed++;
          console.error(`❌ Failed to send email to ${subscriber.email}:`, emailError.message);
        }
      }

      console.log("\n📊 === NOTIFICATION SUMMARY ===");
      console.log(`✅ Successfully sent: ${emailsSent}/${subscribers.length}`);
      console.log(`❌ Failed: ${emailsFailed}/${subscribers.length}`);
      console.log("📧 ========== NOTIFICATION COMPLETE ==========\n");

    } catch (error: any) {
      console.error("❌ Notification system error:", error.message);
    }
  }

  /**
   * Send email notifications to subscribers - NEW PROJECT
   */
  static async notifyNewProject(projectData: any): Promise<void> {
    try {
      console.log("\n📧 ========== NOTIFYING SUBSCRIBERS: NEW PROJECT ==========");
      
      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const subscribers = await subscribeRepo.find({
        where: { 
          is_active: true,
          notify_new_projects: true
        }
      });

      console.log(`📊 Found ${subscribers.length} subscriber(s) to notify`);

      if (subscribers.length === 0) {
        console.log("⚠️ No active subscribers to notify");
        return;
      }

      let emailsSent = 0;
      let emailsFailed = 0;

      for (const subscriber of subscribers) {
        try {
          const emailHtml = SubscribeEmailTemplate.getNewProjectNotification(
            projectData,
            subscriber.email
          );

          await sendEmail({
            to: subscriber.email,
            subject: `🔬 New Research: ${projectData.title}`,
            html: emailHtml
          });

          subscriber.last_notification_sent = new Date();
          await subscribeRepo.save(subscriber);

          emailsSent++;
          console.log(`✅ Email sent to: ${subscriber.email}`);

          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (emailError: any) {
          emailsFailed++;
          console.error(`❌ Failed to send email to ${subscriber.email}:`, emailError.message);
        }
      }

      console.log("\n📊 === NOTIFICATION SUMMARY ===");
      console.log(`✅ Successfully sent: ${emailsSent}/${subscribers.length}`);
      console.log(`❌ Failed: ${emailsFailed}/${subscribers.length}`);
      console.log("📧 ========== NOTIFICATION COMPLETE ==========\n");

    } catch (error: any) {
      console.error("❌ Notification system error:", error.message);
    }
  }

  /**
   * Send email notifications to subscribers - NEW EVENT
   */
  static async notifyNewEvent(eventData: any): Promise<void> {
    try {
      console.log("\n📧 ========== NOTIFYING SUBSCRIBERS: NEW EVENT ==========");
      
      const subscribeRepo = dbConnection.getRepository(Subscribe);
      const subscribers = await subscribeRepo.find({
        where: { 
          is_active: true,
          notify_new_events: true
        }
      });

      console.log(`📊 Found ${subscribers.length} subscriber(s) to notify`);

      if (subscribers.length === 0) {
        console.log("⚠️ No active subscribers to notify");
        return;
      }

      let emailsSent = 0;
      let emailsFailed = 0;

      for (const subscriber of subscribers) {
        try {
          const emailHtml = SubscribeEmailTemplate.getNewEventNotification(
            eventData,
            subscriber.email
          );

          await sendEmail({
            to: subscriber.email,
            subject: `📅 New Event: ${eventData.title}`,
            html: emailHtml
          });

          subscriber.last_notification_sent = new Date();
          await subscribeRepo.save(subscriber);

          emailsSent++;
          console.log(`✅ Email sent to: ${subscriber.email}`);

          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (emailError: any) {
          emailsFailed++;
          console.error(`❌ Failed to send email to ${subscriber.email}:`, emailError.message);
        }
      }

      console.log("\n📊 === NOTIFICATION SUMMARY ===");
      console.log(`✅ Successfully sent: ${emailsSent}/${subscribers.length}`);
      console.log(`❌ Failed: ${emailsFailed}/${subscribers.length}`);
      console.log("📧 ========== NOTIFICATION COMPLETE ==========\n");

    } catch (error: any) {
      console.error("❌ Notification system error:", error.message);
    }
  }
}