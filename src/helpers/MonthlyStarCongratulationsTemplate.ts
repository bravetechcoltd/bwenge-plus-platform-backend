export class MonthlyStarCongratulationsTemplate {
  static getCongratulationsEmail(data: {
    user: { first_name: string; email: string };
    badge_image_url: string;
    month: string;
    year: number;
    statistics: {
      projects_count: number;
      blogs_count: number;
      events_count: number;
      followers_count: number;
      total_score: number;
    };
    description: string;
    rewards: string;
    community_name?: string;
  }): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monthly Star Award</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <!-- Header -->
    <div style="background: #0158B7; padding: 25px 30px; text-align: center;">
      <div style="color: white; font-size: 26px; font-weight: bold; letter-spacing: 1px;">ONGERA</div>
    </div>
    
    <!-- Congratulations Banner -->
    <div style="background: #0158B7; padding: 20px 25px; text-align: center; margin-top: 15px;">
      <div style="color: white; font-size: 22px; font-weight: bold; margin-bottom: 5px;">Congratulations!</div>
      <div style="color: white; font-size: 14px; opacity: 0.95;">You're Our Monthly Star!</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 25px; background: white;">
      <div style="font-size: 16px; color: #1a1a1a; margin-bottom: 15px; font-weight: 600;">
        Dear ${data.user.first_name},
      </div>
      
      <div style="color: #4a4a4a; font-size: 14px; line-height: 1.5; margin-bottom: 12px;">
        We are thrilled to announce that you have been selected as the <strong>Monthly Star</strong> for <strong>${data.month} ${data.year}</strong>${data.community_name ? ` in the <strong>${data.community_name}</strong> community` : ' across the entire Ongera platform'}!
      </div>
      
      <!-- Status Badge -->
      <span style="display: inline-block; background: #28a745; color: white; padding: 5px 15px; border-radius: 15px; font-size: 11px; font-weight: 600; margin: 8px 0;">
        OFFICIALLY APPROVED
      </span>
      
      <!-- Badge Image -->
      ${data.badge_image_url ? `
      <div style="text-align: center; margin: 15px 0;">
        <img src="${data.badge_image_url}" alt="Monthly Star Badge" style="max-width: 150px; height: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(1, 88, 183, 0.2);" />
      </div>
      ` : ''}
      
      <!-- Admin Description -->
      <div style="background: #E3F2FD; border-left: 4px solid #0158B7; padding: 12px; border-radius: 4px; margin: 15px 0;">
        <div style="color: #0158B7; font-weight: 600; font-size: 12px; margin-bottom: 5px;">Recognition</div>
        <div style="color: #495057; font-size: 13px; line-height: 1.4;">${data.description}</div>
      </div>
      
      <!-- Statistics Section -->
      <div style="margin: 15px 0;">
        <div style="color: #2c3e50; font-size: 14px; font-weight: 600; margin-bottom: 10px;">
          Your Outstanding Performance
        </div>
        
        <!-- Compact Stats Row -->
<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
  
  <div style="flex: 1; min-width: 100px; background: #0158B7; padding: 10px 5px; border-radius: 4px; text-align: center; margin-right: 5px;">
    <div style="color: white; font-size: 20px; font-weight: bold; line-height: 1;">
      ${data.statistics.projects_count}
    </div>
    <div style="color: white; font-size: 9px; margin-top: 3px; opacity: 0.9;">
      Projects Uploaded
    </div>
  </div>

  <div style="flex: 1; min-width: 100px; background: #0158B7; padding: 10px 5px; border-radius: 4px; text-align: center; margin-right: 5px;">
    <div style="color: white; font-size: 20px; font-weight: bold; line-height: 1;">
      ${data.statistics.blogs_count}
    </div>
    <div style="color: white; font-size: 9px; margin-top: 3px; opacity: 0.9;">
      Blog Posts
    </div>
  </div>

  <div style="flex: 1; min-width: 100px; background: #0158B7; padding: 10px 5px; border-radius: 4px; text-align: center; margin-right: 5px;">
    <div style="color: white; font-size: 20px; font-weight: bold; line-height: 1;">
      ${data.statistics.events_count}
    </div>
    <div style="color: white; font-size: 9px; margin-top: 3px; opacity: 0.9;">
      Events Attended
    </div>
  </div>

  <div style="flex: 1; min-width: 100px; background: #0158B7; padding: 10px 5px; border-radius: 4px; text-align: center; margin-right: 5px;">
    <div style="color: white; font-size: 20px; font-weight: bold; line-height: 1;">
      ${data.statistics.followers_count}
    </div>
    <div style="color: white; font-size: 9px; margin-top: 3px; opacity: 0.9;">
      New Followers
    </div>
  </div>

</div>

        
        <!-- Total Score Button -->
        <div style="text-align: center;">
          <div style="display: inline-block; background: #0158B7; padding: 6px 18px; border-radius: 15px;">
            <span style="color: white; font-size: 10px; opacity: 0.9;">Total Score</span>
            <span style="color: white; font-size: 16px; font-weight: bold; margin-left: 5px;">${data.statistics.total_score} Points</span>
          </div>
        </div>
      </div>
      
      <!-- Rewards Section -->
      ${data.rewards ? `
      <div style="background: #E8F5E9; border-left: 4px solid #4CAF50; padding: 12px; border-radius: 4px; margin: 15px 0;">
        <div style="color: #2E7D32; font-weight: 600; font-size: 12px; margin-bottom: 5px;">Your Rewards</div>
        <div style="color: #1B5E20; font-size: 13px; line-height: 1.4;">${data.rewards}</div>
      </div>
      ` : ''}
      
      <!-- Motivational Message -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0; text-align: center; border: 1px solid #e9ecef;">
        <div style="color: #495057; font-size: 13px; line-height: 1.5; margin: 0;">
          Your dedication to advancing research and fostering collaboration is truly inspiring. Keep up the excellent work and continue to shine as a beacon of excellence in our community!
        </div>
      </div>
      
      <!-- Action Button -->
      <div style="text-align: center; margin: 20px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" 
           style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">
          Visit Your Dashboard
        </a>
      </div>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <div style="color: #6c757d; font-size: 12px; text-align: center; line-height: 1.4;">
        Thank you for being an outstanding member of the Ongera community!
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 20px 25px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 12px; line-height: 1.4; margin-bottom: 6px;">
        <strong>Ongera Research Platform</strong><br>
        Empowering Rwanda's Research Community
      </div>
      <div style="color: #6c757d; font-size: 11px; margin-bottom: 6px;">
        Connecting Researchers • Advancing Knowledge • Building the Future
      </div>
      <div style="color: #6c757d; font-size: 11px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
    `;
  }
}