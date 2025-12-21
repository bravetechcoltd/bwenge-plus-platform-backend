interface ProjectData {
  title: string;
  abstract: string;
  research_type: string;
  status: string;
  created_at: Date;
  author: {
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
  tags?: Array<{ name: string }>;
  view_count?: number;
  download_count?: number;
  project_id: string;
}

interface MemberData {
  first_name: string;
}

export class NewsProjectCreatedTemplate {
  static getProjectCreatedTemplate(projectData: ProjectData, memberData: MemberData): string {
    const publishDate = new Date(projectData.created_at).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    const category = projectData.research_type.replace('_', ' ').toUpperCase();
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Research Project: ${projectData.title}</title>
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
        Great news! A new research project has been published in <strong style="color: #0158B7;">${projectData.community.name}</strong>. Check it out below!
      </div>
      
      <span style="display: inline-block; background: #0158B7; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        NEW RESEARCH
      </span>
      
      <!-- Highlight Box -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">${category}</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600; line-height: 1.4;">${projectData.title}</div>
      </div>
      
      <!-- Project Abstract -->
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${projectData.abstract.substring(0, 250)}${projectData.abstract.length > 250 ? '...' : ''}
      </div>
      
      <!-- Project Stats -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          PROJECT INFO
        </div>
        <div style="color: #212529; font-size: 15px; line-height: 1.8;">
          <div style="margin: 8px 0;">
            <strong>Published:</strong> ${publishDate}
          </div>
          <div style="margin: 8px 0;">
            <strong>Status:</strong> ${projectData.status}
          </div>
          <div style="margin: 8px 0;">
            <strong>Views:</strong> ${projectData.view_count || 0}
          </div>
          <div style="margin: 8px 0;">
            <strong>Downloads:</strong> ${projectData.download_count || 0}
          </div>
        </div>
      </div>

      ${projectData.tags && projectData.tags.length > 0 ? `
      <!-- Tags -->
      <div style="margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          TAGS
        </div>
        <div>
          ${projectData.tags.map(tag => `<span style="display: inline-block; background: #E3F2FD; color: #0158B7; padding: 4px 10px; border-radius: 15px; font-size: 12px; margin: 4px 4px 4px 0;">${tag.name}</span>`).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Author Info -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          AUTHOR
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>${projectData.author.first_name} ${projectData.author.last_name}</strong><br>
          ${projectData.author.profile?.institution_name || 'Research Institution'}
        </div>
      </div>

      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${projectData.project_id}" 
         style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 20px 0;">
        View Full Project
      </a>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <!-- Community Info -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">${projectData.community.name}</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          ${projectData.community.member_count} members • A collaborative space for advancing knowledge and innovation
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
        You're receiving this because you're a member of <strong>${projectData.community.name}</strong>
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