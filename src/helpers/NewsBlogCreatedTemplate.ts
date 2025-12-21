interface BlogData {
  title: string;
  excerpt: string;
  content: string;
  category: string;
  status: string;
  created_at: Date;
  cover_image_url?: string;
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
  view_count?: number;
  reading_time_minutes?: number;
  blog_id: string;
}

interface MemberData {
  first_name: string;
}

export class NewsBlogCreatedTemplate {
  static getBlogCreatedTemplate(blogData: BlogData, memberData: MemberData): string {
    const publishDate = new Date(blogData.created_at).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    const readingTime = blogData.reading_time_minutes || Math.ceil(blogData.content.length / 1000);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Blog Post: ${blogData.title}</title>
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
        Great news! A new blog post has been published in <strong style="color: #0158B7;">${blogData.community.name}</strong>. Check it out below!
      </div>
      
      <span style="display: inline-block; background: #0158B7; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        NEW BLOG POST
      </span>
      
      ${blogData.cover_image_url ? `
      <!-- Cover Image -->
      <div style="margin: 20px 0;">
        <img src="${blogData.cover_image_url}" alt="${blogData.title}" style="width: 100%; height: auto; border-radius: 8px; display: block;">
      </div>
      ` : ''}
      
      <!-- Highlight Box -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">${blogData.category.toUpperCase()}</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600; line-height: 1.4;">${blogData.title}</div>
      </div>
      
      <!-- Blog Excerpt -->
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${blogData.excerpt}
      </div>
      
      <!-- Blog Stats -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          ARTICLE INFO
        </div>
        <div style="color: #212529; font-size: 15px; line-height: 1.8;">
          <div style="margin: 8px 0;">
            <strong>Published:</strong> ${publishDate}
          </div>
          <div style="margin: 8px 0;">
            <strong>Reading Time:</strong> ${readingTime} min
          </div>
          <div style="margin: 8px 0;">
            <strong>Views:</strong> ${blogData.view_count || 0}
          </div>
        </div>
      </div>

      <!-- Author Info -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          AUTHOR
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>${blogData.author.first_name} ${blogData.author.last_name}</strong><br>
          ${blogData.author.profile?.institution_name || 'Research Institution'}
        </div>
      </div>

      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/blogs/${blogData.blog_id}" 
         style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 20px 0;">
        Read Full Article
      </a>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <!-- Community Info -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">${blogData.community.name}</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          ${blogData.community.member_count} members • A collaborative space for researchers and academics
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
        You're receiving this because you're a member of <strong>${blogData.community.name}</strong>
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