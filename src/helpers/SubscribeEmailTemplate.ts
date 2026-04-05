interface CommunityNotificationData {
  name: string;
  description: string;
  category: string;
  community_type: string;
  cover_image_url?: string;
  creator: {
    first_name: string;
    last_name: string;
  };
  community_id: string;
  created_at: Date;
}

interface ProjectNotificationData {
  title: string;
  abstract: string;
  research_type: string;
  author: {
    first_name: string;
    last_name: string;
  };
  community: {
    name: string;
  };
  project_id: string;
  created_at: Date;
}

interface EventNotificationData {
  title: string;
  description: string;
  event_type: string;
  event_mode: string;
  start_datetime: Date;
  community: {
    name: string;
  };
  event_id: string;
}

export class SubscribeEmailTemplate {
  
  /**
   * Email Template - New Community Created
   */
  static getNewCommunityNotification(
    communityData: CommunityNotificationData,
    subscriberEmail: string
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Community Created</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">
  <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(91,78,150,0.10);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg,#4a3f80 0%,#5b4e96 60%,#7c6fc4 100%); padding: 24px 32px;">
      <div style="color: white; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">Ongera</div>
      <div style="color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 4px; letter-spacing: 0.5px;">Connecting Researchers Worldwide</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 28px 32px 24px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello Researcher! 👋
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        Exciting news! A new community has just been created on Ongera platform. This could be a great opportunity to connect with like-minded researchers!
      </div>
      
      <span style="display: inline-block; background: #28a745; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        NEW COMMUNITY
      </span>
      
      <!-- Community Card -->
      <div style="background: #f0eeff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #5b4e96;">
        <div style="color: #1a1a1a; font-size: 20px; font-weight: 600; margin-bottom: 10px;">
          ${communityData.name}
        </div>
        ${communityData.cover_image_url ? `
        <div style="margin: 15px 0;">
          <img src="${communityData.cover_image_url}" alt="Community Cover" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 6px;">
        </div>
        ` : ''}
        <div style="color: #495057; font-size: 14px; line-height: 1.6; margin: 10px 0;">
          ${communityData.description}
        </div>
      </div>
      
      <!-- Community Details -->
      <div style="background: #f8f7ff; padding: 16px; border-radius: 10px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          COMMUNITY DETAILS
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>Category:</strong> ${communityData.category}<br>
          <strong>Type:</strong> ${communityData.community_type}<br>
          <strong>Created By:</strong> ${communityData.creator.first_name} ${communityData.creator.last_name}<br>
          <strong>Created:</strong> ${new Date(communityData.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
        </div>
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin: 15px 0;">
        🚀 <strong>Join this community</strong> to collaborate, share insights, and connect with fellow researchers in this field!
      </div>
      
      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities/${communityData.community_id}" 
         style="display: inline-block; background: #5b4e96; color: white; text-decoration: none; padding: 13px 32px; border-radius: 10px; font-weight: 700; font-size: 14px; margin: 20px 0;">
        Explore Community
      </a>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <div style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
        You're receiving this because you subscribed to Ongera notifications. &nbsp;
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe?email=${subscriberEmail}" style="color: #5b4e96; text-decoration: none; font-weight: 600;">Unsubscribe</a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f7ff; padding: 20px 32px; text-align: center; border-top: 1px solid #e8e3f7;">
      <div style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 4px;">
        <strong>Ongera Platform</strong> — Connecting Researchers &amp; Academics Worldwide
      </div>
      <div style="color: #94a3b8; font-size: 11px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>

  </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Email Template - New Research Project Created
   */
  static getNewProjectNotification(
    projectData: ProjectNotificationData,
    subscriberEmail: string
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Research Project</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">
  <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(91,78,150,0.10);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg,#4a3f80 0%,#5b4e96 60%,#7c6fc4 100%); padding: 24px 32px;">
      <div style="color: white; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">Ongera</div>
      <div style="color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 4px; letter-spacing: 0.5px;">Connecting Researchers Worldwide</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 28px 32px 24px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello Researcher! 🔬
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        Great news! A new research project has been published in <strong>${projectData.community.name}</strong> community. Check it out and explore cutting-edge research!
      </div>
      
      <span style="display: inline-block; background: #17a2b8; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        NEW RESEARCH
      </span>
      
      <!-- Project Card -->
      <div style="background: #f0eeff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #5b4e96;">
        <div style="color: #1a1a1a; font-size: 20px; font-weight: 600; margin-bottom: 10px;">
          ${projectData.title}
        </div>
        <div style="color: #495057; font-size: 14px; line-height: 1.6; margin: 10px 0;">
          ${projectData.abstract.substring(0, 200)}${projectData.abstract.length > 200 ? '...' : ''}
        </div>
      </div>
      
      <!-- Project Details -->
      <div style="background: #f8f7ff; padding: 16px; border-radius: 10px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          PROJECT DETAILS
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>Type:</strong> ${projectData.research_type}<br>
          <strong>Author:</strong> ${projectData.author.first_name} ${projectData.author.last_name}<br>
          <strong>Community:</strong> ${projectData.community.name}<br>
          <strong>Published:</strong> ${new Date(projectData.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
        </div>
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin: 15px 0;">
        📚 <strong>Visit now</strong> to read the full research, download resources, and engage with the author!
      </div>
      
      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${projectData.project_id}" 
         style="display: inline-block; background: #5b4e96; color: white; text-decoration: none; padding: 13px 32px; border-radius: 10px; font-weight: 700; font-size: 14px; margin: 20px 0;">
        View Research Project
      </a>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <div style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
        You're receiving this because you subscribed to Ongera notifications. &nbsp;
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe?email=${subscriberEmail}" style="color: #5b4e96; text-decoration: none; font-weight: 600;">Unsubscribe</a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f7ff; padding: 20px 32px; text-align: center; border-top: 1px solid #e8e3f7;">
      <div style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 4px;">
        <strong>Ongera Platform</strong> — Connecting Researchers &amp; Academics Worldwide
      </div>
      <div style="color: #94a3b8; font-size: 11px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>

  </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Email Template - New Event Created
   */
  static getNewEventNotification(
    eventData: EventNotificationData,
    subscriberEmail: string
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Event Created</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">
  <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(91,78,150,0.10);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg,#4a3f80 0%,#5b4e96 60%,#7c6fc4 100%); padding: 24px 32px;">
      <div style="color: white; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">Ongera</div>
      <div style="color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 4px; letter-spacing: 0.5px;">Connecting Researchers Worldwide</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 28px 32px 24px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello Researcher! 📅
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        Don't miss out! A new event has been scheduled in <strong>${eventData.community.name}</strong> community. Register now to secure your spot!
      </div>
      
      <span style="display: inline-block; background: #ffc107; color: #000; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        NEW EVENT
      </span>
      
      <!-- Event Card -->
      <div style="background: #f0eeff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #5b4e96;">
        <div style="color: #1a1a1a; font-size: 20px; font-weight: 600; margin-bottom: 10px;">
          ${eventData.title}
        </div>
        <div style="color: #495057; font-size: 14px; line-height: 1.6; margin: 10px 0;">
          ${eventData.description.substring(0, 200)}${eventData.description.length > 200 ? '...' : ''}
        </div>
      </div>
      
      <!-- Event Details -->
      <div style="background: #f8f7ff; padding: 16px; border-radius: 10px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          EVENT DETAILS
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>Type:</strong> ${eventData.event_type}<br>
          <strong>Mode:</strong> ${eventData.event_mode}<br>
          <strong>Community:</strong> ${eventData.community.name}<br>
          <strong>Start Date:</strong> ${new Date(eventData.start_datetime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin: 15px 0;">
        🎯 <strong>Register now</strong> to participate, network, and learn from industry experts!
      </div>
      
      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/events/${eventData.event_id}" 
         style="display: inline-block; background: #5b4e96; color: white; text-decoration: none; padding: 13px 32px; border-radius: 10px; font-weight: 700; font-size: 14px; margin: 20px 0;">
        View Event Details
      </a>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <div style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
        You're receiving this because you subscribed to Ongera notifications. &nbsp;
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe?email=${subscriberEmail}" style="color: #5b4e96; text-decoration: none; font-weight: 600;">Unsubscribe</a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f7ff; padding: 20px 32px; text-align: center; border-top: 1px solid #e8e3f7;">
      <div style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 4px;">
        <strong>Ongera Platform</strong> — Connecting Researchers &amp; Academics Worldwide
      </div>
      <div style="color: #94a3b8; font-size: 11px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>

  </div>
  </div>
</body>
</html>
    `;
  }
}