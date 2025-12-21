interface EventData {
  title: string;
  description: string;
  event_type: string;
  event_mode: string;
  start_datetime: Date;
  end_datetime: Date;
  timezone: string;
  location_address?: string;
  online_meeting_url?: string;
  cover_image_url?: string;
  is_free: boolean;
  price_amount?: number;
  max_attendees?: number;
  requires_approval: boolean;
  organizer: {
    first_name: string;
    last_name: string;
    profile?: {
      institution_name?: string;
    };
  };
  community: {
    name: string;
    member_count: number;
  };
  event_id: string;
}

interface MemberData {
  first_name: string;
}

export class NewsEventCreatedTemplate {
  static getEventCreatedTemplate(eventData: EventData, memberData: MemberData): string {
    const startDate = new Date(eventData.start_datetime);
    const endDate = new Date(eventData.end_datetime);
    
    const eventDateLong = startDate.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    });
    
    const startTime = startDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    const endTime = endDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const durationText = durationHours > 0 
      ? `${durationHours}h ${durationMinutes}m` 
      : `${durationMinutes}m`;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Event: ${eventData.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <!-- Header -->
    <div style="background: #0158B7; padding: 25px 30px; text-align: center;">
      <div style="color: white; font-size: 26px; font-weight: bold; letter-spacing: 1px;">ONGERA</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 30px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hi ${memberData.first_name},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        Exciting news! A new event has been scheduled in <strong style="color: #0158B7;">${eventData.community.name}</strong>. Don't miss out!
      </div>
      
      <span style="display: inline-block; background: #0158B7; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        NEW EVENT
      </span>
      
      ${eventData.cover_image_url ? `
      <!-- Cover Image -->
      <div style="margin: 20px 0;">
        <img src="${eventData.cover_image_url}" alt="${eventData.title}" style="width: 100%; height: auto; border-radius: 8px; display: block;">
      </div>
      ` : ''}
      
      <!-- Highlight Box -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">${eventData.event_type.toUpperCase()} • ${eventData.event_mode.toUpperCase()}</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600; line-height: 1.4;">${eventData.title}</div>
      </div>
      
      <!-- Event Description -->
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${eventData.description.substring(0, 250)}${eventData.description.length > 250 ? '...' : ''}
      </div>
      
      <!-- Event Details -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          EVENT DETAILS
        </div>
        <div style="color: #212529; font-size: 15px; line-height: 1.8;">
          <div style="margin: 8px 0;">
            <strong>📅 Date:</strong> ${eventDateLong}
          </div>
          <div style="margin: 8px 0;">
            <strong>⏰ Time:</strong> ${startTime} - ${endTime} (${eventData.timezone})
          </div>
          <div style="margin: 8px 0;">
            <strong>⏱️ Duration:</strong> ${durationText}
          </div>
          <div style="margin: 8px 0;">
            <strong>💰 Price:</strong> ${eventData.is_free ? 'Free' : `$${eventData.price_amount}`}
          </div>
          ${eventData.max_attendees ? `
          <div style="margin: 8px 0;">
            <strong>👥 Capacity:</strong> ${eventData.max_attendees} attendees
          </div>
          ` : ''}
        </div>
      </div>

      ${eventData.event_mode === 'Physical' || eventData.event_mode === 'Hybrid' ? `
      <!-- Location Info -->
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #856404; font-weight: 600; font-size: 14px; margin-bottom: 8px;">📍 LOCATION</div>
        <div style="color: #856404; font-size: 15px;">${eventData.location_address || 'Location will be announced'}</div>
      </div>
      ` : ''}

      ${eventData.event_mode === 'Online' || eventData.event_mode === 'Hybrid' ? `
      <!-- Online Info -->
      <div style="background: #E3F2FD; border-left: 4px solid #0158B7; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">💻 ONLINE MEETING</div>
        <div style="color: #1a1a1a; font-size: 15px;">Meeting link will be provided after registration</div>
      </div>
      ` : ''}

      ${eventData.requires_approval ? `
      <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin: 15px 0; text-align: center;">
        <div style="color: #856404; font-size: 14px; font-weight: 600;">⚠️ This event requires organizer approval</div>
      </div>
      ` : ''}

      <!-- Organizer Info -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          ORGANIZED BY
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>${eventData.organizer.first_name} ${eventData.organizer.last_name}</strong><br>
          ${eventData.organizer.profile?.institution_name || 'Research Institution'}
        </div>
      </div>

      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/events/${eventData.event_id}" 
         style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 20px 0;">
        Register Now
      </a>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <!-- Community Info -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">${eventData.community.name}</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          ${eventData.community.member_count} members • Join your community at this exciting event!
        </div>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Ongera Platform</strong><br>
        Connecting Researchers & Academics Worldwide
      </div>
      <div style="color: #6c757d; font-size: 13px; margin-bottom: 8px;">
        You're receiving this because you're a member of <strong>${eventData.community.name}</strong>
      </div>
      <div style="color: #6c757d; font-size: 13px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
    `;
  }
}